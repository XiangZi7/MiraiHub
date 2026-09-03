//! 数据库元数据读取与动态 SQL 结果解码。

use std::time::Instant;

use base64::Engine;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::TryStreamExt;
use rust_decimal::Decimal;
use sqlx::mysql::{MySqlPool, MySqlRow};
use sqlx::postgres::{PgPool, PgRow};
use sqlx::{Column, Executor, Row, TypeInfo, ValueRef};
use uuid::Uuid;

use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::models::{
    DatabaseColumn, DatabaseObject, DatabaseObjectKind, DatabaseQueryColumn,
    DatabaseQueryResult,
};

const MAX_RESULT_ROWS: usize = 1_000;

pub async fn list_objects(pool: &DatabasePool) -> DatabaseResult<Vec<DatabaseObject>> {
    match pool {
        DatabasePool::Mysql(pool) => list_mysql_objects(pool).await,
        DatabasePool::Postgresql(pool) => list_postgresql_objects(pool).await,
    }
}

async fn list_mysql_objects(pool: &MySqlPool) -> DatabaseResult<Vec<DatabaseObject>> {
    let rows = sqlx::query(
        r#"
        SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
        FROM information_schema.tables
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    rows.into_iter()
        .map(|row| {
            let table_type: String = row.try_get("TABLE_TYPE").map_err(DatabaseError::Query)?;
            Ok(DatabaseObject {
                schema: row.try_get("TABLE_SCHEMA").map_err(DatabaseError::Query)?,
                name: row.try_get("TABLE_NAME").map_err(DatabaseError::Query)?,
                kind: if table_type.eq_ignore_ascii_case("VIEW") {
                    DatabaseObjectKind::View
                } else {
                    DatabaseObjectKind::Table
                },
            })
        })
        .collect()
}

async fn list_postgresql_objects(pool: &PgPool) -> DatabaseResult<Vec<DatabaseObject>> {
    let rows = sqlx::query(
        r#"
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables
        WHERE table_catalog = current_database()
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_type, table_name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    rows.into_iter()
        .map(|row| {
            let table_type: String = row.try_get("table_type").map_err(DatabaseError::Query)?;
            Ok(DatabaseObject {
                schema: row.try_get("table_schema").map_err(DatabaseError::Query)?,
                name: row.try_get("table_name").map_err(DatabaseError::Query)?,
                kind: if table_type.eq_ignore_ascii_case("VIEW") {
                    DatabaseObjectKind::View
                } else {
                    DatabaseObjectKind::Table
                },
            })
        })
        .collect()
}

pub async fn describe_object(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseColumn>> {
    if schema.trim().is_empty() || name.trim().is_empty() {
        return Err(DatabaseError::InvalidInput(
            "schema 与对象名不能为空".to_owned(),
        ));
    }

    match pool {
        DatabasePool::Mysql(pool) => describe_mysql_object(pool, schema, name).await,
        DatabasePool::Postgresql(pool) => describe_postgresql_object(pool, schema, name).await,
    }
}

async fn describe_mysql_object(
    pool: &MySqlPool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseColumn>> {
    let rows = sqlx::query(
        r#"
        SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    rows.into_iter()
        .map(|row| {
            let nullable: String = row.try_get("IS_NULLABLE").map_err(DatabaseError::Query)?;
            Ok(DatabaseColumn {
                name: row.try_get("COLUMN_NAME").map_err(DatabaseError::Query)?,
                data_type: row.try_get("COLUMN_TYPE").map_err(DatabaseError::Query)?,
                nullable: nullable.eq_ignore_ascii_case("YES"),
                default_value: row.try_get("COLUMN_DEFAULT").map_err(DatabaseError::Query)?,
                ordinal: row
                    .try_get::<u32, _>("ORDINAL_POSITION")
                    .map_err(DatabaseError::Query)? as i32,
            })
        })
        .collect()
}

async fn describe_postgresql_object(
    pool: &PgPool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseColumn>> {
    let rows = sqlx::query(
        r#"
        SELECT column_name, data_type, is_nullable, column_default, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    rows.into_iter()
        .map(|row| {
            let nullable: String = row.try_get("is_nullable").map_err(DatabaseError::Query)?;
            Ok(DatabaseColumn {
                name: row.try_get("column_name").map_err(DatabaseError::Query)?,
                data_type: row.try_get("data_type").map_err(DatabaseError::Query)?,
                nullable: nullable.eq_ignore_ascii_case("YES"),
                default_value: row.try_get("column_default").map_err(DatabaseError::Query)?,
                ordinal: row.try_get("ordinal_position").map_err(DatabaseError::Query)?,
            })
        })
        .collect()
}

pub async fn execute(pool: &DatabasePool, sql: &str) -> DatabaseResult<DatabaseQueryResult> {
    let statement = sql.trim();
    if statement.is_empty() {
        return Err(DatabaseError::InvalidInput("SQL 不能为空".to_owned()));
    }

    match pool {
        DatabasePool::Mysql(pool) => execute_mysql(pool, statement).await,
        DatabasePool::Postgresql(pool) => execute_postgresql(pool, statement).await,
    }
}

async fn execute_mysql(pool: &MySqlPool, statement: &str) -> DatabaseResult<DatabaseQueryResult> {
    let started = Instant::now();
    let description = pool.describe(statement).await.map_err(DatabaseError::Query)?;
    let columns = description
        .columns()
        .iter()
        .map(|column| DatabaseQueryColumn {
            name: column.name().to_owned(),
            data_type: column.type_info().name().to_owned(),
        })
        .collect::<Vec<_>>();

    if columns.is_empty() {
        let result = sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(DatabaseError::Query)?;
        return Ok(write_result(result.rows_affected(), started));
    }

    let mut stream = sqlx::query(statement).fetch(pool);
    let mut rows = Vec::new();
    let mut truncated = false;

    while let Some(row) = stream.try_next().await.map_err(DatabaseError::Query)? {
        if rows.len() == MAX_RESULT_ROWS {
            truncated = true;
            break;
        }
        rows.push(decode_mysql_row(&row));
    }

    Ok(read_result(columns, rows, truncated, started))
}

async fn execute_postgresql(
    pool: &PgPool,
    statement: &str,
) -> DatabaseResult<DatabaseQueryResult> {
    let started = Instant::now();
    let description = pool.describe(statement).await.map_err(DatabaseError::Query)?;
    let columns = description
        .columns()
        .iter()
        .map(|column| DatabaseQueryColumn {
            name: column.name().to_owned(),
            data_type: column.type_info().name().to_owned(),
        })
        .collect::<Vec<_>>();

    if columns.is_empty() {
        let result = sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(DatabaseError::Query)?;
        return Ok(write_result(result.rows_affected(), started));
    }

    let mut stream = sqlx::query(statement).fetch(pool);
    let mut rows = Vec::new();
    let mut truncated = false;

    while let Some(row) = stream.try_next().await.map_err(DatabaseError::Query)? {
        if rows.len() == MAX_RESULT_ROWS {
            truncated = true;
            break;
        }
        rows.push(decode_postgresql_row(&row));
    }

    Ok(read_result(columns, rows, truncated, started))
}

fn write_result(rows_affected: u64, started: Instant) -> DatabaseQueryResult {
    DatabaseQueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected,
        elapsed_ms: elapsed_millis(started),
        truncated: false,
        message: format!("执行成功，影响 {rows_affected} 行"),
    }
}

fn read_result(
    columns: Vec<DatabaseQueryColumn>,
    rows: Vec<Vec<Option<String>>>,
    truncated: bool,
    started: Instant,
) -> DatabaseQueryResult {
    let row_count = rows.len();
    DatabaseQueryResult {
        columns,
        rows,
        rows_affected: row_count as u64,
        elapsed_ms: elapsed_millis(started),
        truncated,
        message: if truncated {
            format!("已显示前 {MAX_RESULT_ROWS} 行")
        } else {
            format!("返回 {row_count} 行")
        },
    }
}

fn elapsed_millis(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn decode_mysql_row(row: &MySqlRow) -> Vec<Option<String>> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| decode_mysql_value(row, index, column.type_info().name()))
        .collect()
}

fn decode_mysql_value(row: &MySqlRow, index: usize, type_name: &str) -> Option<String> {
    if row.try_get_raw(index).map(|value| value.is_null()).unwrap_or(false) {
        return None;
    }

    let normalized = type_name.to_ascii_uppercase();
    let unsigned = normalized.contains("UNSIGNED");
    let decoded = match normalized.split_whitespace().next().unwrap_or("") {
        "BOOLEAN" | "BOOL" => row.try_get::<bool, _>(index).map(|value| value.to_string()),
        "TINYINT" if unsigned => row.try_get::<u8, _>(index).map(|value| value.to_string()),
        "TINYINT" => row.try_get::<i8, _>(index).map(|value| value.to_string()),
        "SMALLINT" if unsigned => row.try_get::<u16, _>(index).map(|value| value.to_string()),
        "SMALLINT" => row.try_get::<i16, _>(index).map(|value| value.to_string()),
        "MEDIUMINT" | "INT" | "INTEGER" if unsigned => {
            row.try_get::<u32, _>(index).map(|value| value.to_string())
        }
        "MEDIUMINT" | "INT" | "INTEGER" => {
            row.try_get::<i32, _>(index).map(|value| value.to_string())
        }
        "BIGINT" if unsigned => row.try_get::<u64, _>(index).map(|value| value.to_string()),
        "BIGINT" => row.try_get::<i64, _>(index).map(|value| value.to_string()),
        "FLOAT" => row.try_get::<f32, _>(index).map(|value| value.to_string()),
        "DOUBLE" | "REAL" => row.try_get::<f64, _>(index).map(|value| value.to_string()),
        "DECIMAL" | "NUMERIC" => row.try_get::<Decimal, _>(index).map(|value| value.to_string()),
        "DATE" => row.try_get::<NaiveDate, _>(index).map(|value| value.to_string()),
        "TIME" => row.try_get::<NaiveTime, _>(index).map(|value| value.to_string()),
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(index)
            .map(|value| value.to_string()),
        "JSON" => row
            .try_get::<serde_json::Value, _>(index)
            .map(|value| value.to_string()),
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB"
        | "BIT" => row.try_get::<Vec<u8>, _>(index).map(format_binary),
        _ => row.try_get::<String, _>(index),
    };

    decoded.ok().or_else(|| Some(format!("<{type_name}>")))
}

fn decode_postgresql_row(row: &PgRow) -> Vec<Option<String>> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| decode_postgresql_value(row, index, column.type_info().name()))
        .collect()
}

fn decode_postgresql_value(row: &PgRow, index: usize, type_name: &str) -> Option<String> {
    if row.try_get_raw(index).map(|value| value.is_null()).unwrap_or(false) {
        return None;
    }

    let decoded = match type_name.to_ascii_uppercase().as_str() {
        "BOOL" => row.try_get::<bool, _>(index).map(|value| value.to_string()),
        "INT2" => row.try_get::<i16, _>(index).map(|value| value.to_string()),
        "INT4" => row.try_get::<i32, _>(index).map(|value| value.to_string()),
        "INT8" => row.try_get::<i64, _>(index).map(|value| value.to_string()),
        "FLOAT4" => row.try_get::<f32, _>(index).map(|value| value.to_string()),
        "FLOAT8" => row.try_get::<f64, _>(index).map(|value| value.to_string()),
        "NUMERIC" => row.try_get::<Decimal, _>(index).map(|value| value.to_string()),
        "DATE" => row.try_get::<NaiveDate, _>(index).map(|value| value.to_string()),
        "TIME" => row.try_get::<NaiveTime, _>(index).map(|value| value.to_string()),
        "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(index)
            .map(|value| value.to_string()),
        "TIMESTAMPTZ" => row
            .try_get::<DateTime<Utc>, _>(index)
            .map(|value| value.to_rfc3339()),
        "UUID" => row.try_get::<Uuid, _>(index).map(|value| value.to_string()),
        "JSON" | "JSONB" => row
            .try_get::<serde_json::Value, _>(index)
            .map(|value| value.to_string()),
        "BYTEA" => row.try_get::<Vec<u8>, _>(index).map(format_binary),
        _ => row.try_get::<String, _>(index),
    };

    decoded.ok().or_else(|| Some(format!("<{type_name}>")))
}

fn format_binary(bytes: Vec<u8>) -> String {
    format!(
        "base64:{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_values_are_labeled() {
        assert_eq!(format_binary(vec![0, 1, 2]), "base64:AAEC");
    }
}
