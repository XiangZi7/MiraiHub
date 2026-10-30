//! 数据导入的预检与事务写入。表与字段来自目标库元数据，单元格值始终绑定参数。
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::error::{DatabaseError, DatabaseResult};
use super::manager::{DatabaseManager, DatabasePool};
use super::models::{
    CellValue, DatabaseColumn, DatabaseImportResult, DatabaseObjectKind, RowMutation,
};
use super::{metadata, mutation, query};
use crate::ssh::transfers::TransferControl;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTarget {
    pub schema: String,
    pub name: String,
    pub columns: Vec<DatabaseColumn>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRowsTable {
    pub schema: String,
    pub table: String,
    pub rows: Vec<Vec<CellValue>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMapping {
    pub source_id: String,
    pub target_schema: String,
    pub target_table: String,
    pub columns: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub id: String,
    pub schema: String,
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub statement_count: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlImportPreview {
    pub sources: Vec<ImportSource>,
    pub skipped_statements: usize,
}

/// 执行前重新检查目标元数据和全部字段，映射错误在第一条写入之前报告。
pub async fn validate_mappings(
    manager: &DatabaseManager,
    session_id: &str,
    mappings: &[ImportMapping],
) -> DatabaseResult<()> {
    let targets = catalog(manager, session_id).await?;
    let mut sources = std::collections::BTreeSet::new();
    for mapping in mappings {
        if !sources.insert(&mapping.source_id) {
            return Err(DatabaseError::InvalidInput("源表映射重复".into()));
        }
        let target = targets
            .iter()
            .find(|t| t.schema == mapping.target_schema && t.name == mapping.target_table)
            .ok_or_else(|| {
                DatabaseError::InvalidInput(format!(
                    "目标表 {}.{} 不存在",
                    mapping.target_schema, mapping.target_table
                ))
            })?;
        let mut seen = std::collections::BTreeSet::new();
        for column in mapping.columns.values() {
            if !target.columns.iter().any(|c| c.name == *column) || !seen.insert(column) {
                return Err(DatabaseError::InvalidInput(format!(
                    "字段 {column} 不存在或重复映射"
                )));
            }
        }
        for column in &target.columns {
            if !column.nullable
                && column.default_value.is_none()
                && !column.auto_increment
                && !seen.contains(&column.name)
            {
                return Err(DatabaseError::InvalidInput(format!(
                    "缺少必填字段 {}",
                    column.name
                )));
            }
        }
    }
    Ok(())
}

/// 读取用户选择的 Excel/SQL 文件；保持与 SQL 导入相同的文件大小边界。
pub async fn read_file(path: &str) -> DatabaseResult<Vec<u8>> {
    let io = |source| DatabaseError::Io {
        operation: "读取",
        path: path.into(),
        source,
    };
    let metadata = tokio::fs::metadata(path).await.map_err(io)?;
    if metadata.len() > 128 * 1024 * 1024 {
        return Err(DatabaseError::InvalidInput(
            "导入文件超过 128 MB，请拆分后再导入".into(),
        ));
    }
    tokio::fs::read(path).await.map_err(io)
}

/// 列出当前数据库的可写表结构，供模板生成与字段匹配共用；视图和计算列不参与导入。
pub async fn catalog(
    manager: &DatabaseManager,
    session_id: &str,
) -> DatabaseResult<Vec<ImportTarget>> {
    let pool = manager.pool(session_id).await?;
    let mut targets = Vec::new();
    for object in metadata::list_objects(&pool).await? {
        if object.kind != DatabaseObjectKind::Table {
            continue;
        }
        let mut columns = metadata::describe_object(&pool, &object.schema, &object.name).await?;
        let generated: Vec<String> = match &pool {
            DatabasePool::Mysql(pool) => sqlx::query_scalar("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND (EXTRA LIKE '%VIRTUAL GENERATED%' OR EXTRA LIKE '%STORED GENERATED%')")
                .bind(&object.schema).bind(&object.name).fetch_all(pool).await.map_err(DatabaseError::Query)?,
            DatabasePool::Postgresql(pool) => sqlx::query_scalar("SELECT a.attname::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2 AND a.attgenerated <> '' AND NOT a.attisdropped")
                .bind(&object.schema).bind(&object.name).fetch_all(pool).await.map_err(DatabaseError::Query)?,
        };
        columns.retain(|column| !generated.contains(&column.name));
        targets.push(ImportTarget {
            schema: object.schema,
            name: object.name,
            columns,
        });
    }
    Ok(targets)
}

/// 在一个事务内写入工作簿全部工作表；任一行失败或用户取消都会回滚，不留下半份导入。
pub async fn import_rows(
    manager: &DatabaseManager,
    session_id: &str,
    tables: &[ImportRowsTable],
    app: &tauri::AppHandle,
    task_id: &str,
    control: Arc<TransferControl>,
) -> DatabaseResult<DatabaseImportResult> {
    let started = std::time::Instant::now();
    let pool = manager.pool(session_id).await?;
    let kind = pool.kind();
    let targets = catalog(manager, session_id).await?;
    let mut prepared = Vec::new();
    for table in tables {
        control
            .checkpoint()
            .await
            .map_err(|_| DatabaseError::Cancelled)?;
        let target = targets
            .iter()
            .find(|target| target.schema == table.schema && target.name == table.table)
            .ok_or_else(|| {
                DatabaseError::InvalidInput(format!(
                    "目标表 {}.{} 不存在",
                    table.schema, table.table
                ))
            })?;
        if let DatabasePool::Mysql(pool) = &pool {
            let engine: Option<String> = sqlx::query_scalar("SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?")
                .bind(&table.schema).bind(&table.table).fetch_optional(pool).await.map_err(DatabaseError::Query)?;
            if !engine.is_some_and(|engine| {
                engine.eq_ignore_ascii_case("innodb") || engine.eq_ignore_ascii_case("xtradb")
            }) {
                return Err(DatabaseError::InvalidInput(format!(
                    "{}.{} 不支持事务，无法保证导入失败后回滚，请先使用 InnoDB 表",
                    table.schema, table.table
                )));
            }
        }
        let casts = metadata::column_cast_types(&pool, &table.schema, &table.table).await?;
        for (index, values) in table.rows.iter().enumerate() {
            let mut seen = std::collections::BTreeSet::new();
            for value in values {
                if !target
                    .columns
                    .iter()
                    .any(|column| column.name == value.column)
                    || !seen.insert(&value.column)
                {
                    return Err(DatabaseError::InvalidInput(format!(
                        "{}.{} 第 {} 行存在未知或重复字段 {}",
                        table.schema,
                        table.table,
                        index + 2,
                        value.column
                    )));
                }
            }
            let mutation = RowMutation::Insert {
                values: values.clone(),
            };
            prepared.push(mutation::prepare(
                &table.schema,
                &table.table,
                &mutation,
                kind,
                &casts,
            )?);
        }
    }
    if prepared.is_empty() {
        return Err(DatabaseError::InvalidInput(
            "工作簿没有可导入的数据行".into(),
        ));
    }
    let rows_affected =
        mutation::execute_prepared(&pool, &prepared, Some((&control, app, task_id))).await?;
    Ok(DatabaseImportResult {
        path: String::new(),
        statements: prepared.len(),
        rows_affected,
        skipped_statements: 0,
        elapsed_ms: query::elapsed_millis(started),
    })
}
