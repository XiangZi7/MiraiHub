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
use sqlx::sqlite::SqliteRow;
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
    execute_with_params(manager, session_id, sql_text, &[], max_rows, timeout_secs).await
}

/// 带绑定参数执行。`params` 为空时与 [`execute`] 完全一致；非空时只接受单条语句，
/// 占位符须已是方言原生写法（MySQL/SQLite 用 `?`，PostgreSQL 用 `$n`），
/// 改走预处理协议把值作为参数绑定，不做任何字符串拼接。
pub async fn execute_with_params(
    manager: &DatabaseManager,
    session_id: &str,
    sql_text: &str,
    params: &[Option<String>],
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
    if !params.is_empty() && statements.len() > 1 {
        return Err(DatabaseError::InvalidInput(
            "参数化查询一次只能执行一条语句".to_owned(),
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
            run_statement(&mut connection, &statement.text, params, max_rows, &running),
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
    params: &[Option<String>],
    max_rows: usize,
    running: &RunningQuery,
) -> DatabaseResult<StatementOutcome> {
    if running.is_cancelled() {
        return Err(DatabaseError::Cancelled);
    }

    match connection {
        DatabaseConnection::Mysql(conn) => {
            run_mysql(conn, statement, params, max_rows, running).await
        }
        DatabaseConnection::Postgresql(conn) => {
            run_postgresql(conn, statement, params, max_rows, running).await
        }
        DatabaseConnection::Sqlite(conn) => {
            run_sqlite(conn, statement, params, max_rows, running).await
        }
    }
}

/// 结果集为空时列信息也拿不到，这里按首关键字判断是否值得再问一次表头。
fn returns_rows(statement: &str) -> bool {
    matches!(
        sql::leading_keyword(statement).as_str(),
        "SELECT"
            | "WITH"
            | "SHOW"
            | "EXPLAIN"
            | "DESC"
            | "DESCRIBE"
            | "TABLE"
            | "VALUES"
            | "PRAGMA"
    )
}

macro_rules! run_dialect {
    ($conn:expr, $statement:expr, $params:expr, $bind:expr, $max_rows:expr, $running:expr, $columns_of:expr, $decode_row:expr) => {{
        let conn = $conn;
        let mut outcome = StatementOutcome::empty();
        // 无参数走简单查询协议（兼容 USE/SHOW 等）；有参数才走预处理并绑定。
        let mut stream = if $params.is_empty() {
            sqlx::raw_sql($statement).fetch_many(&mut **conn)
        } else {
            ($bind)(sqlx::query($statement), $params).fetch_many(&mut **conn)
        };

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
                        outcome.columns = ($columns_of)(&row);
                    }
                    if outcome.rows.len() >= $max_rows {
                        outcome.truncated = true;
                        break;
                    }
                    outcome.rows.push(($decode_row)(&row));
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

#[allow(deprecated)] // 单条语句的预处理流，不涉及被弃用的多语句行为
async fn run_mysql(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    statement: &str,
    params: &[Option<String>],
    max_rows: usize,
    running: &RunningQuery,
) -> DatabaseResult<StatementOutcome> {
    let metadata_text = mysql_returns_text_metadata(statement);
    run_dialect!(
        conn,
        statement,
        params,
        bind_text_params,
        max_rows,
        running,
        |row: &MySqlRow| {
            let mut columns = mysql_columns(row);
            if metadata_text {
                for column in &mut columns {
                    if matches!(
                        column.data_type.as_str(),
                        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB"
                    ) {
                        column.data_type = "TEXT".to_owned();
                    }
                }
            }
            columns
        },
        |row: &MySqlRow| decode_mysql_query_row(row, metadata_text)
    )
}

#[allow(deprecated)]
async fn run_postgresql(
    conn: &mut sqlx::pool::PoolConnection<sqlx::Postgres>,
    statement: &str,
    params: &[Option<String>],
    max_rows: usize,
    running: &RunningQuery,
) -> DatabaseResult<StatementOutcome> {
    // PostgreSQL 按声明类型严格匹配参数：先 describe 拿到服务端推断的类型，再逐个转换。
    let typed = if params.is_empty() {
        Vec::new()
    } else {
        let described = (&mut **conn)
            .describe(statement)
            .await
            .map_err(DatabaseError::Query)?;
        let types: Vec<String> = match described.parameters() {
            Some(Either::Left(types)) => types.iter().map(|t| t.name().to_owned()).collect(),
            Some(Either::Right(count)) => vec!["TEXT".to_owned(); count],
            None => Vec::new(),
        };
        if types.len() != params.len() {
            return Err(DatabaseError::InvalidInput(format!(
                "语句需要 {} 个参数，实际提供了 {} 个",
                types.len(),
                params.len()
            )));
        }
        types
            .iter()
            .zip(params)
            .enumerate()
            .map(|(index, (type_name, value))| {
                pg_param(type_name, value.as_deref()).map_err(|error| {
                    DatabaseError::InvalidInput(format!(
                        "参数 ${} 无法转换为 {type_name}：{error}",
                        index + 1
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    let typed = typed.as_slice();
    run_dialect!(
        conn,
        statement,
        typed,
        bind_pg_params,
        max_rows,
        running,
        postgresql_columns,
        decode_postgresql_row
    )
}

#[allow(deprecated)]
async fn run_sqlite(
    conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    statement: &str,
    params: &[Option<String>],
    max_rows: usize,
    running: &RunningQuery,
) -> DatabaseResult<StatementOutcome> {
    run_dialect!(
        conn,
        statement,
        params,
        bind_text_params,
        max_rows,
        running,
        sqlite_columns,
        decode_sqlite_row
    )
}

/// MySQL / SQLite 对文本参数做隐式转换，统一按可空文本绑定即可。
fn bind_text_params<'q, DB>(
    mut query: sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>,
    params: &'q [Option<String>],
) -> sqlx::query::Query<'q, DB, <DB as sqlx::Database>::Arguments<'q>>
where
    DB: sqlx::Database,
    Option<&'q str>: sqlx::Encode<'q, DB> + sqlx::Type<DB>,
{
    for value in params {
        query = query.bind(value.as_deref());
    }
    query
}

/// 已按 PostgreSQL 参数类型转换好的值；空值也带类型，避免 `NULL` 被声明成 text。
enum PgParam {
    Text(Option<String>),
    I16(Option<i16>),
    I32(Option<i32>),
    I64(Option<i64>),
    F32(Option<f32>),
    F64(Option<f64>),
    Bool(Option<bool>),
    Numeric(Option<Decimal>),
    Uuid(Option<Uuid>),
    Date(Option<NaiveDate>),
    Time(Option<NaiveTime>),
    Timestamp(Option<NaiveDateTime>),
    Timestamptz(Option<DateTime<Utc>>),
    Json(Option<serde_json::Value>),
}

fn parse_param<T>(
    value: Option<&str>,
    parse: impl Fn(&str) -> Result<T, String>,
) -> Result<Option<T>, String> {
    value.map(|text| parse(text.trim())).transpose()
}

fn parse_with<T: std::str::FromStr>(value: Option<&str>) -> Result<Option<T>, String>
where
    T::Err: std::fmt::Display,
{
    parse_param(value, |text| text.parse().map_err(|error: T::Err| error.to_string()))
}

fn pg_param(type_name: &str, value: Option<&str>) -> Result<PgParam, String> {
    Ok(match type_name {
        "INT2" => PgParam::I16(parse_with(value)?),
        "INT4" => PgParam::I32(parse_with(value)?),
        "INT8" => PgParam::I64(parse_with(value)?),
        "FLOAT4" => PgParam::F32(parse_with(value)?),
        "FLOAT8" => PgParam::F64(parse_with(value)?),
        "NUMERIC" => PgParam::Numeric(parse_with(value)?),
        "UUID" => PgParam::Uuid(parse_with(value)?),
        "BOOL" => PgParam::Bool(parse_param(value, |text| {
            match text.to_ascii_lowercase().as_str() {
                "true" | "t" | "1" | "yes" | "y" | "on" => Ok(true),
                "false" | "f" | "0" | "no" | "n" | "off" => Ok(false),
                _ => Err("应为 true / false".to_owned()),
            }
        })?),
        "DATE" => PgParam::Date(parse_param(value, |text| {
            NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|error| error.to_string())
        })?),
        "TIME" => PgParam::Time(parse_param(value, |text| {
            NaiveTime::parse_from_str(text, "%H:%M:%S%.f")
                .or_else(|_| NaiveTime::parse_from_str(text, "%H:%M"))
                .map_err(|error| error.to_string())
        })?),
        "TIMESTAMP" => PgParam::Timestamp(parse_param(value, parse_naive_datetime)?),
        "TIMESTAMPTZ" => PgParam::Timestamptz(parse_param(value, |text| {
            DateTime::parse_from_rfc3339(text)
                .or_else(|_| DateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S%.f%#z"))
                .map(|time| time.with_timezone(&Utc))
                .or_else(|_| parse_naive_datetime(text).map(|time| time.and_utc()))
        })?),
        "JSON" | "JSONB" => PgParam::Json(parse_param(value, |text| {
            serde_json::from_str(text).map_err(|error| error.to_string())
        })?),
        // 其余类型（文本、枚举等）按文本交给服务端转换。
        _ => PgParam::Text(value.map(str::to_owned)),
    })
}

fn parse_naive_datetime(value: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f")
        .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f"))
        .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M"))
        .map_err(|error| error.to_string())
}

fn bind_pg_params<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    params: &'q [PgParam],
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    for value in params {
        query = match value {
            PgParam::Text(v) => query.bind(v.as_deref()),
            PgParam::I16(v) => query.bind(*v),
            PgParam::I32(v) => query.bind(*v),
            PgParam::I64(v) => query.bind(*v),
            PgParam::F32(v) => query.bind(*v),
            PgParam::F64(v) => query.bind(*v),
            PgParam::Bool(v) => query.bind(*v),
            PgParam::Numeric(v) => query.bind(*v),
            PgParam::Uuid(v) => query.bind(*v),
            PgParam::Date(v) => query.bind(*v),
            PgParam::Time(v) => query.bind(*v),
            PgParam::Timestamp(v) => query.bind(*v),
            PgParam::Timestamptz(v) => query.bind(*v),
            PgParam::Json(v) => query.bind(v.clone()),
        };
    }
    query
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
    decode_mysql_query_row(row, false)
}

/// 系统元数据结果按文本解释二进制标记；普通表浏览仍保留原始二进制表示。
fn decode_mysql_query_row(row: &MySqlRow, metadata_text: bool) -> Vec<Option<String>> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| {
            decode_mysql_value(row, index, column.type_info().name(), metadata_text)
        })
        .collect()
}

/// 根据结果类型解码单元格，仅对已知文本元数据放宽驱动的二进制类型标记。
fn decode_mysql_value(
    row: &MySqlRow,
    index: usize,
    type_name: &str,
    metadata_text: bool,
) -> Option<String> {
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
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BIT" => row
            .try_get::<Vec<u8>, _>(index)
            .map(|bytes| format_mysql_binary(bytes, metadata_text)),
        _ => row.try_get::<String, _>(index),
    };

    decoded
        .ok()
        // 类型映射没覆盖到时退回文本，再退回字节 —— 好过给用户一个 `<TYPE>` 占位符。
        .or_else(|| row.try_get::<String, _>(index).ok())
        .or_else(|| {
            row.try_get::<Vec<u8>, _>(index)
                .ok()
                .map(|bytes| format_mysql_binary(bytes, metadata_text))
        })
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

pub(super) fn sqlite_columns(row: &SqliteRow) -> Vec<DatabaseQueryColumn> {
    row.columns()
        .iter()
        .map(|column| DatabaseQueryColumn {
            name: column.name().to_owned(),
            data_type: column.type_info().name().to_owned(),
        })
        .collect()
}

/// SQLite 是动态类型：按存储类别依次尝试整数、浮点、文本、字节。
pub(super) fn decode_sqlite_row(row: &SqliteRow) -> Vec<Option<String>> {
    (0..row.columns().len())
        .map(|index| {
            if is_null(row.try_get_raw(index).ok()) {
                return None;
            }
            row.try_get::<i64, _>(index)
                .map(|value| value.to_string())
                .or_else(|_| row.try_get::<f64, _>(index).map(|value| value.to_string()))
                .or_else(|_| row.try_get::<String, _>(index))
                .ok()
                .or_else(|| row.try_get::<Vec<u8>, _>(index).ok().map(format_binary))
                .or_else(|| Some("<?>".to_owned()))
        })
        .collect()
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

/// SHOW、DESC 和 EXPLAIN 返回服务端生成的元数据；不按版本号或列名猜测用户字段。
fn mysql_returns_text_metadata(statement: &str) -> bool {
    let mut source = statement.trim_start();
    loop {
        if source.starts_with("--") || source.starts_with('#') {
            source = source
                .split_once('\n')
                .map(|(_, rest)| rest.trim_start())
                .unwrap_or("");
        } else if let Some(comment) = source.strip_prefix("/*") {
            let Some((_, rest)) = comment.split_once("*/") else {
                return false;
            };
            source = rest.trim_start();
        } else {
            break;
        }
    }
    matches!(
        sql::leading_keyword(source).as_str(),
        "SHOW" | "DESC" | "DESCRIBE" | "EXPLAIN"
    )
}

/// 元数据标记为 VARBINARY 时尝试严格 UTF-8 解码；真实二进制与无效文本保持无损 Base64。
fn format_mysql_binary(bytes: Vec<u8>, metadata_text: bool) -> String {
    if metadata_text {
        if let Ok(text) = std::str::from_utf8(&bytes) {
            return text.to_owned();
        }
    }
    format_binary(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_values_are_labeled() {
        assert_eq!(format_binary(vec![0, 1, 2]), "base64:AAEC");
    }

    #[test]
    fn mysql_text_metadata_is_not_displayed_as_base64() {
        for text in [
            "information_schema",
            "mysql",
            "performance_schema",
            "中文库名",
            "",
        ] {
            assert_eq!(format_mysql_binary(text.as_bytes().to_vec(), true), text);
        }
        assert_eq!(format_mysql_binary(vec![0xff, 0xfe], true), "base64://4=");
        assert_eq!(
            format_mysql_binary(b"mysql".to_vec(), false),
            "base64:bXlzcWw="
        );
        assert_eq!(format_mysql_binary(vec![0, 1, 2], false), "base64:AAEC");
    }

    #[test]
    fn mysql_metadata_decoding_does_not_affect_user_queries() {
        for query in [
            "show databases;",
            "SHOW FULL TABLES",
            "DESC users",
            "EXPLAIN SELECT 1",
            "-- comment\n/* context */ SHOW DATABASES",
            "# comment\n SHOW TABLES",
        ] {
            assert!(mysql_returns_text_metadata(query), "{query}");
        }
        for query in [
            "SELECT binary_column FROM users",
            "SELECT 'SHOW DATABASES'",
            "/* comment */ SELECT 1",
            "WITH q AS (SELECT 1) SELECT * FROM q",
            "/* unterminated",
        ] {
            assert!(!mysql_returns_text_metadata(query), "{query}");
        }
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

/// 把单条查询包装成该方言输出 JSON 执行计划的 EXPLAIN 语句。
///
/// 只接受一条语句：多条语句拼进 EXPLAIN 会让第二条在无保护的情况下真正执行。
pub fn explain_statement(
    kind: super::models::DatabaseKind,
    sql_text: &str,
) -> DatabaseResult<String> {
    let statements = sql::split_statements(sql_text, kind);
    let [statement] = statements.as_slice() else {
        return Err(DatabaseError::InvalidInput(
            "执行计划一次只能分析一条语句".into(),
        ));
    };
    let body = statement.text.trim().trim_end_matches(';').trim();
    if body.is_empty() {
        return Err(DatabaseError::InvalidInput("没有可分析的语句".into()));
    }
    Ok(match kind {
        super::models::DatabaseKind::Mysql => format!("EXPLAIN FORMAT=JSON {body}"),
        // 不带 ANALYZE：只估算不执行，写语句也不会落地。
        super::models::DatabaseKind::Postgresql => format!("EXPLAIN (FORMAT JSON, VERBOSE) {body}"),
        super::models::DatabaseKind::Sqlite => format!("EXPLAIN QUERY PLAN {body}"),
    })
}

/// 读取单条语句的执行计划，返回方言原生的 JSON 文本。前端与 Agent 工具共用。
pub async fn explain(
    manager: &DatabaseManager,
    session_id: &str,
    sql_text: &str,
    timeout_secs: u64,
) -> DatabaseResult<String> {
    let kind = manager.pool(session_id).await?.kind();
    let wrapped = explain_statement(kind, sql_text)?;
    let max_rows = if kind == super::models::DatabaseKind::Sqlite {
        500
    } else {
        10
    };
    let execution = execute(manager, session_id, &wrapped, max_rows, timeout_secs).await?;
    let statement = execution
        .statements
        .into_iter()
        .next()
        .ok_or_else(|| DatabaseError::InvalidInput("没有返回执行计划".into()))?;
    if let Some(error) = statement.error {
        return Err(DatabaseError::InvalidInput(error));
    }
    // SQLite 的 QUERY PLAN 是 (id, parent, notused, detail) 行集，转成 JSON 数组交给前端组树
    if kind == super::models::DatabaseKind::Sqlite {
        let nodes: Vec<serde_json::Value> = statement
            .rows
            .iter()
            .map(|row| {
                let cell = |i: usize| row.get(i).cloned().flatten().unwrap_or_default();
                serde_json::json!({
                    "id": cell(0).parse::<i64>().unwrap_or_default(),
                    "parent": cell(1).parse::<i64>().unwrap_or_default(),
                    "detail": cell(3),
                })
            })
            .collect();
        return Ok(serde_json::Value::Array(nodes).to_string());
    }
    statement
        .rows
        .into_iter()
        .next()
        .and_then(|row| row.into_iter().next().flatten())
        .ok_or_else(|| DatabaseError::InvalidInput("没有返回执行计划".into()))
}

#[cfg(test)]
mod explain_tests {
    use super::*;
    use crate::db::models::DatabaseKind;

    #[test]
    fn wraps_single_statement_per_dialect() {
        assert_eq!(
            explain_statement(DatabaseKind::Mysql, "SELECT 1;").unwrap(),
            "EXPLAIN FORMAT=JSON SELECT 1"
        );
        assert!(explain_statement(DatabaseKind::Postgresql, "select 1")
            .unwrap()
            .starts_with("EXPLAIN (FORMAT JSON"));
    }

    #[test]
    fn rejects_multiple_statements() {
        assert!(explain_statement(DatabaseKind::Mysql, "SELECT 1; DELETE FROM t").is_err());
    }
}
