//! SQL 执行与动态结果解码。
//!
//! 提交的脚本先在 `sql::split_statements` 里按方言切分，再逐条在同一条
//! 连接上执行 —— 这样 `USE`、`SET`、临时表这类带会话状态的语句对后续语句
//! 依然生效。执行走简单查询协议（`raw_sql`），预处理协议撑不住 `USE` /
//! `SHOW` 这类语句；列信息在结果为空时才补一次 `describe`，正常路径没有额外往返。

use std::time::Duration;
use std::time::Instant;

use base64::Engine;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::TryStreamExt;
use rust_decimal::Decimal;
use sqlx::mysql::MySqlRow;
use sqlx::postgres::PgRow;
use sqlx::{Column, Either, Executor, Row, TypeInfo, ValueRef};
use uuid::Uuid;

use super::error::{DatabaseError, DatabaseResult};
use super::manager::{DatabaseConnection, DatabaseManager, RunningQuery};
use super::models::{DatabaseExecution, DatabaseQueryColumn, DatabaseStatementResult};
use super::sql;

/// 单次请求能带回的最大行数上限，防止前端被撑爆。
pub const MAX_RESULT_ROWS: usize = 200_000;
pub const DEFAULT_RESULT_ROWS: usize = 500;

/// 一条语句跑完后的原始产出，还没包装成对前端的模型。
struct StatementOutcome {
    columns: Vec<DatabaseQueryColumn>,
    rows: Vec<Vec<Option<String>>>,
    rows_affected: u64,
    truncated: bool,
}

impl StatementOutcome {
    fn empty() -> Self {
        Self {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: 0,
            truncated: false,
        }
    }
}

/// 执行一段可能包含多条语句的 SQL。
///
/// 任意一条报错就停下并把错误挂在那条语句上，前面已经成功的结果照常返回 ——
/// 脚本跑到一半失败时，用户需要看到失败点之前发生了什么。
pub async fn execute(
    manager: &DatabaseManager,
    session_id: &str,
    sql_text: &str,
    max_rows: usize,
    timeout_secs: u64,
) -> DatabaseResult<DatabaseExecution> {
    let pool = manager.pool(session_id).await?;
    let kind = pool.kind();
    let statements = sql::split_statements(sql_text, kind);

    if statements.is_empty() {
        return Err(DatabaseError::InvalidInput(
            "没有可执行的 SQL 语句".to_owned(),
        ));
    }

    let max_rows = max_rows.clamp(1, MAX_RESULT_ROWS);
    let started = Instant::now();
    let mut connection = pool.acquire().await?;
    let backend_id = connection.backend_id().await?;
    let running = manager.begin_query(session_id, backend_id).await;

    let mut results = Vec::with_capacity(statements.len());
    let mut cancelled = false;

    for statement in statements {
        let statement_started = Instant::now();
        let outcome = match tokio::time::timeout(
            Duration::from_secs(timeout_secs.clamp(1, 86_400)),
            run_statement(&mut connection, &statement.text, max_rows, &running),
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(_) => {
                let _ = manager.cancel(session_id).await;
                Err(DatabaseError::StatementTimeout { secs: timeout_secs })
            }
        };
        let elapsed_ms = elapsed_millis(statement_started);

        match outcome {
            Ok(outcome) => results.push(finish_statement(&statement, outcome, elapsed_ms)),
            Err(DatabaseError::Cancelled) => {
                cancelled = true;
                results.push(cancelled_statement(&statement, elapsed_ms));
                break;
            }
            Err(error @ DatabaseError::StatementTimeout { .. }) => {
                results.push(failed_statement(&statement, error, elapsed_ms));
                break;
            }
            Err(_) if running.is_cancelled() => {
                // 服务端取消和本地通知存在竞速：即使先收到驱动错误，也应向前端报告为取消。
                cancelled = true;
                results.push(cancelled_statement(&statement, elapsed_ms));
                break;
            }
            Err(error) => {
                results.push(failed_statement(&statement, error, elapsed_ms));
                break;
            }
        }
    }

    manager.end_query(session_id).await;

    Ok(DatabaseExecution {
        statements: results,
        elapsed_ms: elapsed_millis(started),
        cancelled,
    })
}

fn finish_statement(
    statement: &sql::Statement,
    outcome: StatementOutcome,
    elapsed_ms: u64,
) -> DatabaseStatementResult {
    let returns_rows = !outcome.columns.is_empty();
    let message = if returns_rows {
        if outcome.truncated {
            format!("已返回前 {} 行（结果被截断）", outcome.rows.len())
        } else {
            format!("返回 {} 行", outcome.rows.len())
        }
    } else {
        format!("执行成功，影响 {} 行", outcome.rows_affected)
    };

    DatabaseStatementResult {
        statement: statement.text.clone(),
        offset: statement.offset,
        columns: outcome.columns,
        rows: outcome.rows,
        rows_affected: outcome.rows_affected,
        elapsed_ms,
        truncated: outcome.truncated,
        message,
        error: None,
    }
}

fn failed_statement(
    statement: &sql::Statement,
    error: DatabaseError,
    elapsed_ms: u64,
) -> DatabaseStatementResult {
    let message = error.to_string();
    DatabaseStatementResult {
        statement: statement.text.clone(),
        offset: statement.offset,
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: 0,
        elapsed_ms,
        truncated: false,
        message: message.clone(),
        error: Some(message),
    }
}

fn cancelled_statement(statement: &sql::Statement, elapsed_ms: u64) -> DatabaseStatementResult {
    DatabaseStatementResult {
        statement: statement.text.clone(),
        offset: statement.offset,
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: 0,
        elapsed_ms,
        truncated: false,
        message: "已取消".to_owned(),
        error: Some("查询已被取消".to_owned()),
    }
}

async fn run_statement(
    connection: &mut DatabaseConnection,
    statement: &str,
    max_rows: usize,
    running: &RunningQuery,
) -> DatabaseResult<StatementOutcome> {
    if running.is_cancelled() {
        return Err(DatabaseError::Cancelled);
    }

    match connection {
        DatabaseConnection::Mysql(conn) => run_mysql(conn, statement, max_rows, running).await,
        DatabaseConnection::Postgresql(conn) => {
            run_postgresql(conn, statement, max_rows, running).await
        }
    }
}

/// 结果集为空时列信息也拿不到，这里按首关键字判断是否值得再问一次表头。
fn returns_rows(statement: &str) -> bool {
    matches!(
        sql::leading_keyword(statement).as_str(),
        "SELECT" | "WITH" | "SHOW" | "EXPLAIN" | "DESC" | "DESCRIBE" | "TABLE" | "VALUES"
    )
}

macro_rules! run_dialect {
    ($conn:expr, $statement:expr, $max_rows:expr, $running:expr, $columns_of:path, $decode_row:path) => {{
        let conn = $conn;
        let mut outcome = StatementOutcome::empty();
        let mut stream = sqlx::raw_sql($statement).fetch_many(&mut **conn);

        loop {
            let next = tokio::select! {
                biased;
                _ = $running.wait_cancelled() => return Err(DatabaseError::Cancelled),
                item = stream.try_next() => item,
            };

            let Some(item) = next.map_err(DatabaseError::Query)? else {
                break;
            };

            match item {
                Either::Left(result) => outcome.rows_affected += result.rows_affected(),
                Either::Right(row) => {
                    if outcome.columns.is_empty() {
                        outcome.columns = $columns_of(&row);
                    }
                    if outcome.rows.len() >= $max_rows {
                        outcome.truncated = true;
                        break;
                    }
                    outcome.rows.push($decode_row(&row));
                }
            }
        }

        drop(stream);

        if outcome.columns.is_empty() && outcome.rows_affected == 0 && returns_rows($statement) {
            // 空结果集补一次预处理，只为拿到表头 —— 失败就算了，不影响执行结果。
            if let Ok(described) = (&mut **conn).describe($statement).await {
                outcome.columns = described
                    .columns()
                    .iter()
                    .map(|column| DatabaseQueryColumn {
                        name: column.name().to_owned(),
                        data_type: column.type_info().name().to_owned(),
                    })
                    .collect();
            }
        }

        Ok(outcome)
    }};
}

async fn run_mysql(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    statement: &str,
    max_rows: usize,
    running: &RunningQuery,
) -> DatabaseResult<StatementOutcome> {
    run_dialect!(
        conn,
        statement,
        max_rows,
        running,
        mysql_columns,
        decode_mysql_row
    )
}

async fn run_postgresql(
    conn: &mut sqlx::pool::PoolConnection<sqlx::Postgres>,
    statement: &str,
    max_rows: usize,
    running: &RunningQuery,
) -> DatabaseResult<StatementOutcome> {
    run_dialect!(
        conn,
        statement,
        max_rows,
        running,
        postgresql_columns,
        decode_postgresql_row
    )
}

pub(crate) fn elapsed_millis(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

// ---------------------------------------------------------------------------
// 结果解码
// ---------------------------------------------------------------------------

pub(super) fn mysql_columns(row: &MySqlRow) -> Vec<DatabaseQueryColumn> {
    row.columns()
        .iter()
        .map(|column| DatabaseQueryColumn {
            name: column.name().to_owned(),
            data_type: column.type_info().name().to_owned(),
        })
        .collect()
}

pub(super) fn postgresql_columns(row: &PgRow) -> Vec<DatabaseQueryColumn> {
    row.columns()
        .iter()
        .map(|column| DatabaseQueryColumn {
            name: column.name().to_owned(),
            data_type: column.type_info().name().to_owned(),
        })
        .collect()
}

pub(super) fn decode_mysql_row(row: &MySqlRow) -> Vec<Option<String>> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| decode_mysql_value(row, index, column.type_info().name()))
        .collect()
}

fn decode_mysql_value(row: &MySqlRow, index: usize, type_name: &str) -> Option<String> {
    if is_null(row.try_get_raw(index).ok()) {
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
        "DECIMAL" | "NUMERIC" => row
            .try_get::<Decimal, _>(index)
            .map(|value| value.to_string()),
        "DATE" => row
            .try_get::<NaiveDate, _>(index)
            .map(|value| value.to_string()),
        "TIME" => row
            .try_get::<NaiveTime, _>(index)
            .map(|value| value.to_string()),
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(index)
            .map(|value| value.to_string()),
        "JSON" => row
            .try_get::<serde_json::Value, _>(index)
            .map(|value| value.to_string()),
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BIT" => {
            row.try_get::<Vec<u8>, _>(index).map(format_binary)
        }
        _ => row.try_get::<String, _>(index),
    };

    decoded
        .ok()
        // 类型映射没覆盖到时退回文本，再退回字节 —— 好过给用户一个 `<TYPE>` 占位符。
        .or_else(|| row.try_get::<String, _>(index).ok())
        .or_else(|| row.try_get::<Vec<u8>, _>(index).ok().map(format_binary))
        .or_else(|| Some(format!("<{type_name}>")))
}

pub(super) fn decode_postgresql_row(row: &PgRow) -> Vec<Option<String>> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| decode_postgresql_value(row, index, column.type_info().name()))
        .collect()
}

fn decode_postgresql_value(row: &PgRow, index: usize, type_name: &str) -> Option<String> {
    if is_null(row.try_get_raw(index).ok()) {
        return None;
    }

    let decoded = match type_name.to_ascii_uppercase().as_str() {
        "BOOL" => row.try_get::<bool, _>(index).map(|value| value.to_string()),
        "INT2" => row.try_get::<i16, _>(index).map(|value| value.to_string()),
        "INT4" => row.try_get::<i32, _>(index).map(|value| value.to_string()),
        "INT8" => row.try_get::<i64, _>(index).map(|value| value.to_string()),
        "FLOAT4" => row.try_get::<f32, _>(index).map(|value| value.to_string()),
        "FLOAT8" => row.try_get::<f64, _>(index).map(|value| value.to_string()),
        "NUMERIC" => row
            .try_get::<Decimal, _>(index)
            .map(|value| value.to_string()),
        "DATE" => row
            .try_get::<NaiveDate, _>(index)
            .map(|value| value.to_string()),
        "TIME" => row
            .try_get::<NaiveTime, _>(index)
            .map(|value| value.to_string()),
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

    decoded
        .ok()
        .or_else(|| row.try_get::<String, _>(index).ok())
        .or_else(|| row.try_get::<Vec<u8>, _>(index).ok().map(format_binary))
        .or_else(|| Some(format!("<{type_name}>")))
}

fn is_null<'r, V: ValueRef<'r>>(value: Option<V>) -> bool {
    value.map(|value| value.is_null()).unwrap_or(false)
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

    #[test]
    fn detects_row_returning_statements() {
        assert!(returns_rows("select 1"));
        assert!(returns_rows("  WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(returns_rows("SHOW TABLES"));
        assert!(!returns_rows("INSERT INTO t VALUES (1)"));
        assert!(!returns_rows("CREATE TABLE t (id int)"));
    }
}
