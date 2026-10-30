//! 表数据的事务化增删改。
//!
//! 表名与列名来自结构化请求并统一转义，值始终使用绑定参数。一次请求里的
//! 多个改动在同一个事务内提交，任何一条失败都会整体回滚。

use std::collections::BTreeMap;
use std::time::Instant;

use super::browse::{cast_placeholder, display_sql, ensure_identifier};
use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::metadata;
use super::models::{CellValue, DatabaseKind, MutationRequest, MutationResult, RowMutation};
use super::query::elapsed_millis;
use super::sql;

pub(super) struct PreparedMutation {
    pub statement: String,
    pub values: Vec<Option<String>>,
}

struct Binder {
    kind: DatabaseKind,
    values: Vec<Option<String>>,
}

impl Binder {
    fn new(kind: DatabaseKind) -> Self {
        Self {
            kind,
            values: Vec::new(),
        }
    }

    fn push(&mut self, value: Option<String>) -> String {
        self.values.push(value);
        match self.kind {
            DatabaseKind::Mysql => "?".to_owned(),
            DatabaseKind::Postgresql => format!("${}", self.values.len()),
        }
    }
}

pub async fn mutate(
    pool: &DatabasePool,
    request: &MutationRequest,
) -> DatabaseResult<MutationResult> {
    let schema = request.schema.trim();
    let table = request.table.trim();
    if table.is_empty() {
        return Err(DatabaseError::InvalidInput("表名不能为空".to_owned()));
    }
    if request.mutations.is_empty() {
        return Err(DatabaseError::InvalidInput(
            "没有待提交的数据改动".to_owned(),
        ));
    }

    let kind = pool.kind();
    let casts = metadata::column_cast_types(pool, schema, table)
        .await
        .unwrap_or_default();
    let prepared = request
        .mutations
        .iter()
        .map(|mutation| prepare(schema, table, mutation, kind, &casts))
        .collect::<DatabaseResult<Vec<_>>>()?;
    let started = Instant::now();
    let rows_affected = execute_prepared(pool, &prepared, None).await?;

    Ok(MutationResult {
        rows_affected,
        statements: prepared
            .iter()
            .map(|mutation| display_sql(&mutation.statement, &mutation.values, kind))
            .collect(),
        elapsed_ms: elapsed_millis(started),
    })
}

/// 网格编辑与 Excel 导入共用事务执行；取消发生在提交前时，连接释放会回滚全部行。
pub(super) async fn execute_prepared(
    pool: &DatabasePool,
    prepared: &[PreparedMutation],
    progress: Option<(
        &crate::ssh::transfers::TransferControl,
        &tauri::AppHandle,
        &str,
    )>,
) -> DatabaseResult<u64> {
    let mut rows_affected = 0;

    match pool {
        DatabasePool::Mysql(pool) => {
            let mut transaction = pool.begin().await.map_err(DatabaseError::Query)?;
            for (index, mutation) in prepared.iter().enumerate() {
                if let Some((control, _, _)) = progress {
                    control
                        .checkpoint()
                        .await
                        .map_err(|_| DatabaseError::Cancelled)?;
                }
                let mut query = sqlx::query(&mutation.statement);
                for value in &mutation.values {
                    query = query.bind(value.clone());
                }
                rows_affected += query
                    .execute(&mut *transaction)
                    .await
                    .map_err(DatabaseError::Query)?
                    .rows_affected();
                if let Some((_, app, task_id)) = progress {
                    if index % 100 == 0 || index + 1 == prepared.len() {
                        let mut event = crate::ssh::events::TransferEvent::progress(task_id, 0, 0);
                        event.processed_rows = Some((index + 1) as u64);
                        crate::ssh::events::emit_transfer(app, event);
                    }
                }
            }
            if let Some((control, _, _)) = progress {
                control
                    .checkpoint()
                    .await
                    .map_err(|_| DatabaseError::Cancelled)?;
            }
            transaction.commit().await.map_err(DatabaseError::Query)?;
        }
        DatabasePool::Postgresql(pool) => {
            let mut transaction = pool.begin().await.map_err(DatabaseError::Query)?;
            for (index, mutation) in prepared.iter().enumerate() {
                if let Some((control, _, _)) = progress {
                    control
                        .checkpoint()
                        .await
                        .map_err(|_| DatabaseError::Cancelled)?;
                }
                let mut query = sqlx::query(&mutation.statement);
                for value in &mutation.values {
                    query = query.bind(value.clone());
                }
                rows_affected += query
                    .execute(&mut *transaction)
                    .await
                    .map_err(DatabaseError::Query)?
                    .rows_affected();
                if let Some((_, app, task_id)) = progress {
                    if index % 100 == 0 || index + 1 == prepared.len() {
                        let mut event = crate::ssh::events::TransferEvent::progress(task_id, 0, 0);
                        event.processed_rows = Some((index + 1) as u64);
                        crate::ssh::events::emit_transfer(app, event);
                    }
                }
            }
            if let Some((control, _, _)) = progress {
                control
                    .checkpoint()
                    .await
                    .map_err(|_| DatabaseError::Cancelled)?;
            }
            transaction.commit().await.map_err(DatabaseError::Query)?;
        }
    }

    Ok(rows_affected)
}

/// 将一行新增、修改或删除编译为转义标识符与绑定参数，供网格与 Excel 导入共用。
pub(super) fn prepare(
    schema: &str,
    table: &str,
    mutation: &RowMutation,
    kind: DatabaseKind,
    casts: &BTreeMap<String, String>,
) -> DatabaseResult<PreparedMutation> {
    let target = sql::qualified_name(schema, table, kind);
    let mut binder = Binder::new(kind);

    let statement = match mutation {
        RowMutation::Insert { values } => {
            ensure_values(values, "新增行至少需要一个字段")?;
            let columns = values
                .iter()
                .map(|value| quoted_column(&value.column, kind))
                .collect::<DatabaseResult<Vec<_>>>()?;
            let placeholders = bind_values(values, &mut binder, kind, casts)?;
            format!(
                "INSERT INTO {target} ({}) VALUES ({})",
                columns.join(", "),
                placeholders.join(", ")
            )
        }
        RowMutation::Update { keys, changes } => {
            ensure_values(keys, "更新行必须提供主键条件")?;
            ensure_values(changes, "没有待更新的字段")?;
            let assignments = changes
                .iter()
                .map(|value| {
                    let column = quoted_column(&value.column, kind)?;
                    let placeholder = bind_value(value, &mut binder, kind, casts);
                    Ok(format!("{column} = {placeholder}"))
                })
                .collect::<DatabaseResult<Vec<_>>>()?;
            let conditions = bind_keys(keys, &mut binder, kind, casts)?;
            format!(
                "UPDATE {target} SET {} WHERE {}",
                assignments.join(", "),
                conditions.join(" AND ")
            )
        }
        RowMutation::Delete { keys } => {
            ensure_values(keys, "删除行必须提供主键条件")?;
            let conditions = bind_keys(keys, &mut binder, kind, casts)?;
            format!("DELETE FROM {target} WHERE {}", conditions.join(" AND "))
        }
    };

    Ok(PreparedMutation {
        statement,
        values: binder.values,
    })
}

fn ensure_values(values: &[CellValue], message: &str) -> DatabaseResult<()> {
    if values.is_empty() {
        return Err(DatabaseError::InvalidInput(message.to_owned()));
    }
    Ok(())
}

fn quoted_column(column: &str, kind: DatabaseKind) -> DatabaseResult<String> {
    let column = column.trim();
    ensure_identifier(column)?;
    Ok(sql::quote_identifier(column, kind))
}

fn bind_value(
    value: &CellValue,
    binder: &mut Binder,
    kind: DatabaseKind,
    casts: &BTreeMap<String, String>,
) -> String {
    let placeholder = binder.push(value.value.clone());
    cast_placeholder(&placeholder, value.column.trim(), kind, casts)
}

fn bind_values(
    values: &[CellValue],
    binder: &mut Binder,
    kind: DatabaseKind,
    casts: &BTreeMap<String, String>,
) -> DatabaseResult<Vec<String>> {
    values
        .iter()
        .map(|value| {
            ensure_identifier(value.column.trim())?;
            Ok(bind_value(value, binder, kind, casts))
        })
        .collect()
}

fn bind_keys(
    keys: &[CellValue],
    binder: &mut Binder,
    kind: DatabaseKind,
    casts: &BTreeMap<String, String>,
) -> DatabaseResult<Vec<String>> {
    keys.iter()
        .map(|key| {
            let column = quoted_column(&key.column, kind)?;
            Ok(match &key.value {
                None => format!("{column} IS NULL"),
                Some(_) => format!("{column} = {}", bind_value(key, binder, kind, casts)),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_safe_update() {
        let mutation = RowMutation::Update {
            keys: vec![CellValue {
                column: "id".to_owned(),
                value: Some("7".to_owned()),
            }],
            changes: vec![CellValue {
                column: "display name".to_owned(),
                value: Some("Ada".to_owned()),
            }],
        };
        let prepared = prepare(
            "public",
            "users",
            &mutation,
            DatabaseKind::Postgresql,
            &BTreeMap::from([
                ("id".to_owned(), "int4".to_owned()),
                ("display name".to_owned(), "text".to_owned()),
            ]),
        )
        .unwrap();

        assert_eq!(
            prepared.statement,
            "UPDATE \"public\".\"users\" SET \"display name\" = $1::text WHERE \"id\" = $2::int4"
        );
        assert_eq!(
            prepared.values,
            vec![Some("Ada".to_owned()), Some("7".to_owned())]
        );
    }

    #[test]
    fn refuses_delete_without_keys() {
        assert!(prepare(
            "public",
            "users",
            &RowMutation::Delete { keys: Vec::new() },
            DatabaseKind::Postgresql,
            &BTreeMap::new(),
        )
        .is_err());
    }
}
