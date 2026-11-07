//! 会话与锁监控：列出服务端会话、阻塞关系，并支持取消查询/终止会话。
//!
//! MySQL 读 information_schema.PROCESSLIST 与 InnoDB 锁等待；PostgreSQL 读
//! pg_stat_activity 与 pg_blocking_pids。权限不足时尽量返回能看到的部分，
//! 并在 `notice` 里说明降级原因，而不是直接报错。

use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::metadata::mysql_optional_metadata_text;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSession {
    pub id: i64,
    pub user: String,
    pub host: String,
    pub database: String,
    /// MySQL 的 COMMAND / PostgreSQL 的 backend_type。
    pub command: String,
    pub state: String,
    /// 当前语句已执行的毫秒数；空闲会话为 None。
    pub duration_ms: Option<i64>,
    /// 当前事务已持续的毫秒数；无事务为 None。
    pub transaction_ms: Option<i64>,
    pub wait_event: String,
    pub application: String,
    pub query: String,
    /// 阻塞当前会话的会话 id。
    pub blocked_by: Vec<i64>,
    /// 是否为监控面板自己使用的连接。
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub sessions: Vec<ServerSession>,
    /// 权限不足等降级说明；为空表示信息完整。
    pub notice: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KillMode {
    /// 只取消正在执行的语句，连接保留。
    Query,
    /// 断开整个会话。
    Connection,
}

pub async fn list_sessions(pool: &DatabasePool) -> DatabaseResult<SessionSnapshot> {
    match pool {
        DatabasePool::Mysql(pool) => mysql_sessions(pool).await,
        DatabasePool::Postgresql(pool) => postgresql_sessions(pool).await,
        DatabasePool::Sqlite(_) => Err(DatabaseError::InvalidInput(
            "SQLite 是本地文件库，没有服务端会话".to_owned(),
        )),
    }
}

pub async fn kill_session(pool: &DatabasePool, id: i64, mode: KillMode) -> DatabaseResult<bool> {
    if id <= 0 {
        return Err(DatabaseError::InvalidInput("会话 id 不合法".to_owned()));
    }
    match pool {
        DatabasePool::Mysql(pool) => {
            // KILL 不支持参数绑定；id 已是整数，直接拼接是安全的。
            let sql = match mode {
                KillMode::Query => format!("KILL QUERY {id}"),
                KillMode::Connection => format!("KILL {id}"),
            };
            sqlx::query(&sql)
                .execute(pool)
                .await
                .map_err(DatabaseError::Query)?;
            Ok(true)
        }
        DatabasePool::Postgresql(pool) => {
            let sql = match mode {
                KillMode::Query => "SELECT pg_cancel_backend($1)",
                KillMode::Connection => "SELECT pg_terminate_backend($1)",
            };
            let pid = i32::try_from(id)
                .map_err(|_| DatabaseError::InvalidInput("会话 id 不合法".to_owned()))?;
            let done: bool = sqlx::query_scalar(sql)
                .bind(pid)
                .fetch_one(pool)
                .await
                .map_err(DatabaseError::Query)?;
            Ok(done)
        }
        DatabasePool::Sqlite(_) => Err(DatabaseError::InvalidInput(
            "SQLite 是本地文件库，没有服务端会话".to_owned(),
        )),
    }
}

async fn mysql_sessions(pool: &sqlx::MySqlPool) -> DatabaseResult<SessionSnapshot> {
    let mut conn = pool.acquire().await.map_err(DatabaseError::Query)?;
    let self_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)")
        .fetch_one(&mut *conn)
        .await
        .map_err(DatabaseError::Query)?;

    let rows = sqlx::query(
        r#"
        SELECT CAST(p.ID AS SIGNED) AS ID,
               CAST(p.USER AS CHAR) AS USER,
               CAST(p.HOST AS CHAR) AS HOST,
               CAST(p.DB AS CHAR) AS DB,
               CAST(p.COMMAND AS CHAR) AS COMMAND,
               CAST(p.STATE AS CHAR) AS STATE,
               CAST(p.TIME AS SIGNED) AS TIME,
               CAST(p.INFO AS CHAR) AS INFO
        FROM information_schema.PROCESSLIST p
        ORDER BY p.ID
        "#,
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(DatabaseError::Query)?;

    let mut notice = Vec::new();

    // 事务开始时间：没有 PROCESS 权限时 INNODB_TRX 读不出来，静默降级。
    let transactions: Vec<(i64, i64)> = match sqlx::query(
        r#"
        SELECT CAST(trx_mysql_thread_id AS SIGNED) AS THREAD_ID,
               CAST(TIMESTAMPDIFF(MICROSECOND, trx_started, NOW()) DIV 1000 AS SIGNED) AS MS
        FROM information_schema.INNODB_TRX
        "#,
    )
    .fetch_all(&mut *conn)
    .await
    {
        Ok(rows) => rows
            .iter()
            .filter_map(|row| {
                Some((
                    row.try_get::<i64, _>("THREAD_ID").ok()?,
                    row.try_get::<i64, _>("MS").ok()?,
                ))
            })
            .collect(),
        Err(_) => Vec::new(),
    };

    // 锁等待：MySQL 8 用 sys.innodb_lock_waits，5.7 退回 information_schema 的旧表。
    let waits = match mysql_lock_waits(&mut conn, true).await {
        Ok(waits) => waits,
        Err(_) => match mysql_lock_waits(&mut conn, false).await {
            Ok(waits) => waits,
            Err(_) => {
                notice.push("无法读取 InnoDB 锁等待信息（需要 PROCESS 权限或 sys 库），阻塞链不可用");
                Vec::new()
            }
        },
    };

    let mut sessions = Vec::with_capacity(rows.len());
    for row in &rows {
        let id: i64 = row.try_get("ID").map_err(DatabaseError::Query)?;
        let command = mysql_optional_metadata_text(row, "COMMAND")?.unwrap_or_default();
        let time: Option<i64> = row.try_get("TIME").ok();
        let idle = command.eq_ignore_ascii_case("Sleep") || command.eq_ignore_ascii_case("Daemon");
        let mut blocked_by: Vec<i64> = waits
            .iter()
            .filter(|(waiting, _)| *waiting == id)
            .map(|(_, blocking)| *blocking)
            .collect();
        blocked_by.sort_unstable();
        blocked_by.dedup();
        sessions.push(ServerSession {
            id,
            user: mysql_optional_metadata_text(row, "USER")?.unwrap_or_default(),
            host: mysql_optional_metadata_text(row, "HOST")?.unwrap_or_default(),
            database: mysql_optional_metadata_text(row, "DB")?.unwrap_or_default(),
            state: mysql_optional_metadata_text(row, "STATE")?.unwrap_or_default(),
            duration_ms: if idle { None } else { time.map(|secs| secs * 1000) },
            transaction_ms: transactions
                .iter()
                .find(|(thread, _)| *thread == id)
                .map(|(_, ms)| *ms),
            wait_event: if blocked_by.is_empty() {
                String::new()
            } else {
                "Lock wait".to_owned()
            },
            application: String::new(),
            query: mysql_optional_metadata_text(row, "INFO")?.unwrap_or_default(),
            blocked_by,
            is_self: id == self_id,
            command,
        });
    }

    // 没有 PROCESS 权限时 PROCESSLIST 只返回当前账号自己的会话。
    let users: std::collections::HashSet<&str> =
        sessions.iter().map(|session| session.user.as_str()).collect();
    if users.len() <= 1 && !mysql_has_process_privilege(&mut conn).await {
        notice.push("当前账号没有 PROCESS 权限，只能看到自己的会话");
    }

    Ok(SessionSnapshot {
        sessions,
        notice: (!notice.is_empty()).then(|| notice.join("；")),
    })
}

async fn mysql_lock_waits(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    modern: bool,
) -> Result<Vec<(i64, i64)>, sqlx::Error> {
    let sql = if modern {
        r#"
        SELECT CAST(waiting_pid AS SIGNED) AS WAITING, CAST(blocking_pid AS SIGNED) AS BLOCKING
        FROM sys.innodb_lock_waits
        "#
    } else {
        r#"
        SELECT CAST(r.trx_mysql_thread_id AS SIGNED) AS WAITING,
               CAST(b.trx_mysql_thread_id AS SIGNED) AS BLOCKING
        FROM information_schema.INNODB_LOCK_WAITS w
        JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_trx_id
        JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
        "#
    };
    let rows = sqlx::query(sql).fetch_all(&mut **conn).await?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            Some((
                row.try_get::<Option<i64>, _>("WAITING").ok()??,
                row.try_get::<Option<i64>, _>("BLOCKING").ok()??,
            ))
        })
        .collect())
}

async fn mysql_has_process_privilege(conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>) -> bool {
    let grants: Vec<String> = match sqlx::query("SHOW GRANTS").fetch_all(&mut **conn).await {
        Ok(rows) => rows
            .iter()
            .filter_map(|row| first_column_text(row))
            .collect(),
        Err(_) => return false,
    };
    grants.iter().any(|grant| {
        let upper = grant.to_ascii_uppercase();
        upper.starts_with("GRANT ALL PRIVILEGES ON *.*")
            || (upper.contains(" ON *.*") && upper.contains("PROCESS"))
    })
}

/// SHOW GRANTS 的列名带账号，按位置读第一列。
fn first_column_text(row: &sqlx::mysql::MySqlRow) -> Option<String> {
    row.try_get::<String, _>(0)
        .ok()
        .or_else(|| row.try_get::<Vec<u8>, _>(0).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
}

async fn postgresql_sessions(pool: &sqlx::PgPool) -> DatabaseResult<SessionSnapshot> {
    let rows = sqlx::query(
        r#"
        SELECT pid::int8 AS pid,
               COALESCE(usename::text, '') AS usename,
               COALESCE(host(client_addr), CASE WHEN client_port = -1 THEN 'local socket' ELSE '' END) AS client,
               COALESCE(datname::text, '') AS datname,
               COALESCE(backend_type, '') AS backend_type,
               COALESCE(state, '') AS state,
               CASE WHEN state = 'active' AND query_start IS NOT NULL
                    THEN (EXTRACT(EPOCH FROM (clock_timestamp() - query_start)) * 1000)::int8 END AS duration_ms,
               CASE WHEN xact_start IS NOT NULL
                    THEN (EXTRACT(EPOCH FROM (clock_timestamp() - xact_start)) * 1000)::int8 END AS transaction_ms,
               COALESCE(wait_event_type || ': ' || wait_event, '') AS wait_event,
               COALESCE(application_name, '') AS application_name,
               COALESCE(query, '') AS query,
               COALESCE(ARRAY(SELECT unnest(pg_blocking_pids(pid))::int8), ARRAY[]::int8[]) AS blocked_by,
               pid = pg_backend_pid() AS is_self
        FROM pg_stat_activity
        WHERE backend_type IS NULL OR backend_type = 'client backend'
        ORDER BY pid
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    let mut sessions = Vec::with_capacity(rows.len());
    let mut hidden = false;
    for row in &rows {
        let query: String = row.try_get("query").map_err(DatabaseError::Query)?;
        if query == "<insufficient privilege>" {
            hidden = true;
        }
        sessions.push(ServerSession {
            id: row.try_get("pid").map_err(DatabaseError::Query)?,
            user: row.try_get("usename").map_err(DatabaseError::Query)?,
            host: row.try_get("client").map_err(DatabaseError::Query)?,
            database: row.try_get("datname").map_err(DatabaseError::Query)?,
            command: row.try_get("backend_type").map_err(DatabaseError::Query)?,
            state: row.try_get("state").map_err(DatabaseError::Query)?,
            duration_ms: row.try_get("duration_ms").map_err(DatabaseError::Query)?,
            transaction_ms: row.try_get("transaction_ms").map_err(DatabaseError::Query)?,
            wait_event: row.try_get("wait_event").map_err(DatabaseError::Query)?,
            application: row.try_get("application_name").map_err(DatabaseError::Query)?,
            query,
            blocked_by: row.try_get("blocked_by").map_err(DatabaseError::Query)?,
            is_self: row.try_get("is_self").map_err(DatabaseError::Query)?,
        });
    }

    Ok(SessionSnapshot {
        sessions,
        notice: hidden.then(|| {
            "当前角色不是超级用户也不属于 pg_read_all_stats，其他角色会话的语句与状态不可见".to_owned()
        }),
    })
}
