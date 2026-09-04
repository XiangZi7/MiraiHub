//! 数据库 SQL 文件导入 / 导出。
//!
//! 导出使用当前会话的元数据与分页数据读取，不依赖用户另外安装
//! mysqldump / pg_dump。导入与 SQL 编辑器共用方言感知的语句切分器，
//! 并登记为可取消任务，避免大脚本把会话永久占住。

use std::collections::BTreeSet;
use std::time::Instant;

use tokio::io::{AsyncWriteExt, BufWriter};

use super::browse;
use super::error::{DatabaseError, DatabaseResult};
use super::manager::{DatabaseManager, DatabasePool};
use super::metadata;
use super::models::{
    DatabaseExportResult, DatabaseImportResult, DatabaseKind, DatabaseObjectKind,
    DatabaseQueryColumn, DatabaseRoutineDetail, DatabaseTableDetail, RowPageRequest, RowSort,
};
use super::{query, sql};

const EXPORT_PAGE_SIZE: u32 = 1_000;
const INSERT_BATCH_SIZE: usize = 100;
const MAX_IMPORT_BYTES: u64 = 128 * 1024 * 1024;

pub async fn export_sql(
    manager: &DatabaseManager,
    session_id: &str,
    path: &str,
    include_data: bool,
    drop_existing: bool,
) -> DatabaseResult<DatabaseExportResult> {
    let path = validate_path(path)?;
    let started = Instant::now();
    let pool = manager.pool(session_id).await?;
    let kind = pool.kind();
    let objects = metadata::list_objects(&pool).await?;

    if objects.is_empty() {
        return Err(DatabaseError::InvalidInput(
            "当前数据库没有可导出的对象".to_owned(),
        ));
    }

    // 先把结构取齐，后续既要按依赖排列表，也要先删除视图再删除表。
    let mut tables = Vec::new();
    let mut views = Vec::new();
    let mut routines = Vec::new();
    for object in objects {
        if matches!(
            object.kind,
            DatabaseObjectKind::Procedure | DatabaseObjectKind::Function
        ) {
            let detail = metadata::routine_detail(
                &pool,
                &object.schema,
                &object.name,
                object.kind,
                &object.identity,
            )
            .await?;
            if detail.ddl.trim().is_empty() {
                return Err(DatabaseError::InvalidInput(format!(
                    "无法读取 {}.{} 的例程定义",
                    object.schema, object.name
                )));
            }
            routines.push(detail);
            continue;
        }
        let detail =
            metadata::table_detail(&pool, &object.schema, &object.name, object.kind).await?;
        if detail.ddl.trim().is_empty() {
            return Err(DatabaseError::InvalidInput(format!(
                "无法读取 {}.{} 的建表语句",
                object.schema, object.name
            )));
        }
        match object.kind {
            DatabaseObjectKind::Table => tables.push(detail),
            DatabaseObjectKind::View => views.push(detail),
            DatabaseObjectKind::Procedure | DatabaseObjectKind::Function => unreachable!(),
        }
    }
    tables = order_tables_by_dependencies(tables);

    let file = tokio::fs::File::create(path)
        .await
        .map_err(|source| io_error("创建", path, source))?;
    let mut writer = BufWriter::new(file);
    let mut bytes = 0u64;
    let mut exported_rows = 0u64;

    write_dump(
        &mut writer,
        path,
        &mut bytes,
        &format!(
            "-- MiraiHub SQL export\n-- Generated at {}\n-- Dialect: {}\n\n",
            chrono::Utc::now().to_rfc3339(),
            match kind {
                DatabaseKind::Mysql => "MySQL",
                DatabaseKind::Postgresql => "PostgreSQL",
            }
        ),
    )
    .await?;

    write_schema_setup(
        &mut writer,
        path,
        &mut bytes,
        kind,
        &tables,
        &views,
        &routines,
    )
    .await?;

    if kind == DatabaseKind::Mysql {
        write_dump(
            &mut writer,
            path,
            &mut bytes,
            "SET FOREIGN_KEY_CHECKS = 0;\n\n",
        )
        .await?;
    }

    if drop_existing {
        // 视图可能调用函数，例程也可能依赖表：先删视图，再删例程，最后删表。
        for detail in views.iter().rev() {
            write_statement(
                &mut writer,
                path,
                &mut bytes,
                &format!(
                    "DROP VIEW IF EXISTS {}{}",
                    sql::qualified_name(&detail.schema, &detail.name, kind),
                    if kind == DatabaseKind::Postgresql {
                        " CASCADE"
                    } else {
                        ""
                    }
                ),
            )
            .await?;
        }
        for detail in routines.iter().rev() {
            write_mysql_use_database(&mut writer, path, &mut bytes, kind, &detail.schema).await?;
            let object_type = if detail.kind == DatabaseObjectKind::Procedure {
                "PROCEDURE"
            } else {
                "FUNCTION"
            };
            let signature = if kind == DatabaseKind::Postgresql {
                format!(
                    "{}({})",
                    sql::qualified_name(&detail.schema, &detail.name, kind),
                    detail.identity
                )
            } else {
                sql::qualified_name(&detail.schema, &detail.name, kind)
            };
            write_statement(
                &mut writer,
                path,
                &mut bytes,
                &format!(
                    "DROP {object_type} IF EXISTS {signature}{}",
                    if kind == DatabaseKind::Postgresql {
                        " CASCADE"
                    } else {
                        ""
                    }
                ),
            )
            .await?;
        }
        for detail in tables.iter().rev() {
            write_statement(
                &mut writer,
                path,
                &mut bytes,
                &format!(
                    "DROP TABLE IF EXISTS {}{}",
                    sql::qualified_name(&detail.schema, &detail.name, kind),
                    if kind == DatabaseKind::Postgresql {
                        " CASCADE"
                    } else {
                        ""
                    }
                ),
            )
            .await?;
        }
    }

    for detail in &tables {
        write_mysql_use_database(&mut writer, path, &mut bytes, kind, &detail.schema).await?;
        write_statement(&mut writer, path, &mut bytes, &detail.ddl).await?;

        if include_data {
            exported_rows +=
                export_table_rows(&pool, detail, &mut writer, path, &mut bytes).await?;
        }
    }

    // 例程放到表与数据之后、视图之前；视图定义经常会调用用户函数。
    for detail in &routines {
        write_mysql_use_database(&mut writer, path, &mut bytes, kind, &detail.schema).await?;
        write_routine(&mut writer, path, &mut bytes, kind, detail).await?;
    }

    // 视图最后创建，确保基础表与常用函数已经存在。
    for detail in &views {
        write_mysql_use_database(&mut writer, path, &mut bytes, kind, &detail.schema).await?;
        write_statement(&mut writer, path, &mut bytes, &detail.ddl).await?;
    }

    if kind == DatabaseKind::Mysql {
        write_dump(
            &mut writer,
            path,
            &mut bytes,
            "SET FOREIGN_KEY_CHECKS = 1;\n",
        )
        .await?;
    }

    writer
        .flush()
        .await
        .map_err(|source| io_error("写入", path, source))?;

    Ok(DatabaseExportResult {
        path: path.to_owned(),
        objects: tables.len() + views.len() + routines.len(),
        rows: exported_rows,
        bytes,
        elapsed_ms: query::elapsed_millis(started),
    })
}

pub async fn import_sql(
    manager: &DatabaseManager,
    session_id: &str,
    path: &str,
) -> DatabaseResult<DatabaseImportResult> {
    let path = validate_path(path)?;
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|source| io_error("读取", path, source))?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err(DatabaseError::InvalidInput(format!(
            "SQL 文件超过 {} MB，请拆分后再导入",
            MAX_IMPORT_BYTES / 1024 / 1024
        )));
    }

    let contents = tokio::fs::read_to_string(path)
        .await
        .map_err(|source| io_error("读取", path, source))?;
    let started = Instant::now();
    // 与编辑器复用完全相同的串行执行器：USE / SET 等会话状态能传给后续语句，
    // 取消信号和服务端 KILL 也只维护一套实现。结果行最多保留一行，避免导入文件
    // 中意外夹带 SELECT 时把大量数据经 IPC 返回。
    let execution = query::execute(manager, session_id, &contents, 1, 300).await?;
    if execution.cancelled {
        return Err(DatabaseError::Cancelled);
    }
    if let Some((index, statement)) = execution
        .statements
        .iter()
        .enumerate()
        .find(|(_, statement)| statement.error.is_some())
    {
        return Err(DatabaseError::InvalidInput(format!(
            "导入第 {} 条 SQL 失败：{}",
            index + 1,
            statement.error.as_deref().unwrap_or("未知错误")
        )));
    }

    let statement_count = execution.statements.len();
    let rows_affected = execution
        .statements
        .iter()
        .map(|statement| statement.rows_affected)
        .sum();

    Ok(DatabaseImportResult {
        path: path.to_owned(),
        statements: statement_count,
        rows_affected,
        elapsed_ms: query::elapsed_millis(started),
    })
}

async fn export_table_rows(
    pool: &DatabasePool,
    detail: &DatabaseTableDetail,
    writer: &mut BufWriter<tokio::fs::File>,
    path: &str,
    bytes: &mut u64,
) -> DatabaseResult<u64> {
    let mut offset = 0u64;
    let mut total = 0u64;

    loop {
        let page = browse::fetch_rows(
            pool,
            &RowPageRequest {
                schema: detail.schema.clone(),
                table: detail.name.clone(),
                offset,
                limit: EXPORT_PAGE_SIZE,
                // OFFSET 分页至少按首个主键列稳定排序；无主键表只能使用服务端顺序。
                sort: detail.primary_key.first().map(|column| RowSort {
                    column: column.clone(),
                    descending: false,
                }),
                filters: Vec::new(),
            },
        )
        .await?;

        if page.rows.is_empty() {
            break;
        }

        for batch in page.rows.chunks(INSERT_BATCH_SIZE) {
            let statement = insert_statement(
                &detail.schema,
                &detail.name,
                pool.kind(),
                &page.columns,
                batch,
            );
            write_statement(writer, path, bytes, &statement).await?;
        }

        let fetched = page.rows.len() as u64;
        total += fetched;
        offset += fetched;
        if !page.has_more {
            break;
        }
    }

    Ok(total)
}

fn insert_statement(
    schema: &str,
    table: &str,
    kind: DatabaseKind,
    columns: &[DatabaseQueryColumn],
    rows: &[Vec<Option<String>>],
) -> String {
    let column_list = columns
        .iter()
        .map(|column| sql::quote_identifier(&column.name, kind))
        .collect::<Vec<_>>()
        .join(", ");
    let values = rows
        .iter()
        .map(|row| {
            let values = row
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    sql_value(
                        value.as_deref(),
                        columns.get(index).map(|column| column.data_type.as_str()),
                        kind,
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!("({values})")
        })
        .collect::<Vec<_>>()
        .join(",\n");
    let override_identity = if kind == DatabaseKind::Postgresql {
        " OVERRIDING SYSTEM VALUE"
    } else {
        ""
    };

    format!(
        "INSERT INTO {} ({column_list}){override_identity} VALUES\n{values}",
        sql::qualified_name(schema, table, kind)
    )
}

fn sql_value(value: Option<&str>, data_type: Option<&str>, kind: DatabaseKind) -> String {
    let Some(value) = value else {
        return "NULL".to_owned();
    };

    let data_type = data_type.unwrap_or_default().to_ascii_uppercase();
    let binary = match kind {
        DatabaseKind::Mysql => {
            data_type.contains("BINARY") || data_type.contains("BLOB") || data_type == "BIT"
        }
        DatabaseKind::Postgresql => data_type == "BYTEA",
    };
    if binary {
        if let Some(encoded) = value.strip_prefix("base64:") {
            return match kind {
                DatabaseKind::Mysql => format!("FROM_BASE64({})", mysql_literal(encoded)),
                DatabaseKind::Postgresql => {
                    format!("decode({}, 'base64')", sql::quote_literal(encoded))
                }
            };
        }
    }

    match kind {
        DatabaseKind::Mysql => mysql_literal(value),
        DatabaseKind::Postgresql => sql::quote_literal(value),
    }
}

fn mysql_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

async fn write_schema_setup(
    writer: &mut BufWriter<tokio::fs::File>,
    path: &str,
    bytes: &mut u64,
    kind: DatabaseKind,
    tables: &[DatabaseTableDetail],
    views: &[DatabaseTableDetail],
    routines: &[DatabaseRoutineDetail],
) -> DatabaseResult<()> {
    let schemas = tables
        .iter()
        .chain(views)
        .map(|detail| detail.schema.as_str())
        .chain(routines.iter().map(|detail| detail.schema.as_str()))
        .filter(|schema| !schema.trim().is_empty())
        .collect::<BTreeSet<_>>();

    for schema in schemas {
        let statement = match kind {
            DatabaseKind::Mysql => format!(
                "CREATE DATABASE IF NOT EXISTS {}",
                sql::quote_identifier(schema, kind)
            ),
            DatabaseKind::Postgresql => format!(
                "CREATE SCHEMA IF NOT EXISTS {}",
                sql::quote_identifier(schema, kind)
            ),
        };
        write_statement(writer, path, bytes, &statement).await?;
    }
    Ok(())
}

async fn write_routine(
    writer: &mut BufWriter<tokio::fs::File>,
    path: &str,
    bytes: &mut u64,
    kind: DatabaseKind,
    detail: &DatabaseRoutineDetail,
) -> DatabaseResult<()> {
    if kind == DatabaseKind::Postgresql {
        return write_statement(writer, path, bytes, &detail.ddl).await;
    }

    // MySQL 存储例程允许主体内出现分号，必须用客户端 DELIMITER 包住。
    // MiraiHub 的导入切分器识别该指令，但不会把指令本身发送给数据库。
    write_dump(writer, path, bytes, "DELIMITER $$\n").await?;
    write_dump(
        writer,
        path,
        bytes,
        &format!("{}$$\n", detail.ddl.trim().trim_end_matches(';')),
    )
    .await?;
    write_dump(writer, path, bytes, "DELIMITER ;\n\n").await
}

/// SHOW CREATE 在 MySQL 返回的对象名通常不带 schema；没有默认库或一次导出
/// 多个库时必须显式 USE，才能把 DDL 落到它原本所属的数据库。
async fn write_mysql_use_database(
    writer: &mut BufWriter<tokio::fs::File>,
    path: &str,
    bytes: &mut u64,
    kind: DatabaseKind,
    schema: &str,
) -> DatabaseResult<()> {
    if kind == DatabaseKind::Mysql && !schema.trim().is_empty() {
        write_statement(
            writer,
            path,
            bytes,
            &format!("USE {}", sql::quote_identifier(schema, kind)),
        )
        .await?;
    }
    Ok(())
}

/// 外键依赖先建被引用表；遇到循环依赖时保留原顺序，导入时会给出准确失败语句。
fn order_tables_by_dependencies(mut tables: Vec<DatabaseTableDetail>) -> Vec<DatabaseTableDetail> {
    let all = tables
        .iter()
        .map(|table| (table.schema.clone(), table.name.clone()))
        .collect::<BTreeSet<_>>();
    let mut emitted = BTreeSet::new();
    let mut ordered = Vec::with_capacity(tables.len());

    while !tables.is_empty() {
        let position = tables.iter().position(|table| {
            table.foreign_keys.iter().all(|foreign_key| {
                let dependency = (
                    foreign_key.referenced_schema.clone(),
                    foreign_key.referenced_table.clone(),
                );
                dependency == (table.schema.clone(), table.name.clone())
                    || !all.contains(&dependency)
                    || emitted.contains(&dependency)
            })
        });
        // 循环外键没有拓扑序；至少保持元数据原顺序，使导出文件仍可人工调整。
        let index = position.unwrap_or(0);
        let table = tables.remove(index);
        emitted.insert((table.schema.clone(), table.name.clone()));
        ordered.push(table);
    }

    ordered
}

async fn write_statement(
    writer: &mut BufWriter<tokio::fs::File>,
    path: &str,
    bytes: &mut u64,
    statement: &str,
) -> DatabaseResult<()> {
    let statement = statement.trim().trim_end_matches(';');
    write_dump(writer, path, bytes, &format!("{statement};\n\n")).await
}

async fn write_dump(
    writer: &mut BufWriter<tokio::fs::File>,
    path: &str,
    bytes: &mut u64,
    contents: &str,
) -> DatabaseResult<()> {
    writer
        .write_all(contents.as_bytes())
        .await
        .map_err(|source| io_error("写入", path, source))?;
    *bytes += contents.len() as u64;
    Ok(())
}

fn validate_path(path: &str) -> DatabaseResult<&str> {
    let path = path.trim();
    if path.is_empty() {
        return Err(DatabaseError::InvalidInput("文件路径不能为空".to_owned()));
    }
    Ok(path)
}

fn io_error(operation: &'static str, path: &str, source: std::io::Error) -> DatabaseError {
    DatabaseError::Io {
        operation,
        path: path.to_owned(),
        source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mysql_literals_escape_quotes_and_backslashes() {
        assert_eq!(mysql_literal("C:\\O'Reilly"), "'C:\\\\O''Reilly'");
    }

    #[test]
    fn binary_values_use_dialect_decoder() {
        assert_eq!(
            sql_value(Some("base64:AAEC"), Some("BLOB"), DatabaseKind::Mysql),
            "FROM_BASE64('AAEC')"
        );
        assert_eq!(
            sql_value(Some("base64:AAEC"), Some("BYTEA"), DatabaseKind::Postgresql),
            "decode('AAEC', 'base64')"
        );
    }
}
