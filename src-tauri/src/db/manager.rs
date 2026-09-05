//! 数据库会话注册表与连接池生命周期。
//!
//! 会话除了连接池还保存原始配置：切换活动库需要用新的 database 重建池，
//! 而池本身没法改这个参数。正在执行的查询单独登记在 `running` 里，
//! 取消时另开一条连接向服务端发 `pg_cancel_backend` / `KILL QUERY`。

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlSslMode};
use sqlx::pool::PoolConnection;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};
use sqlx::{MySql, Postgres, Row};
use tokio::sync::{Notify, RwLock};

use super::error::{DatabaseError, DatabaseResult};
use super::models::{DatabaseConfig, DatabaseKind, DatabaseSession, DatabaseSslMode};

#[derive(Clone)]
pub(crate) enum DatabasePool {
    Mysql(MySqlPool),
    Postgresql(PgPool),
}

/// 从池里取出的独占连接。查询固定跑在它上面，这样拿到的
/// backend id 与执行查询的确实是同一条连接。
pub(crate) enum DatabaseConnection {
    Mysql(PoolConnection<MySql>),
    Postgresql(PoolConnection<Postgres>),
}

impl DatabasePool {
    pub(crate) fn kind(&self) -> DatabaseKind {
        match self {
            Self::Mysql(_) => DatabaseKind::Mysql,
            Self::Postgresql(_) => DatabaseKind::Postgresql,
        }
    }

    async fn connect(config: &DatabaseConfig) -> DatabaseResult<Self> {
        validate_config(config)?;

        let timeout_secs = config.timeout_secs.max(1);
        let endpoint = config.endpoint();
        let connect = async {
            match config.kind {
                DatabaseKind::Mysql => connect_mysql(config).await.map(Self::Mysql),
                DatabaseKind::Postgresql => connect_postgresql(config).await.map(Self::Postgresql),
            }
        };

        tokio::time::timeout(Duration::from_secs(timeout_secs), connect)
            .await
            .map_err(|_| DatabaseError::Timeout {
                endpoint: endpoint.clone(),
                secs: timeout_secs,
            })?
            .map_err(|source| DatabaseError::Connect { endpoint, source })
    }

    pub(crate) async fn acquire(&self) -> DatabaseResult<DatabaseConnection> {
        match self {
            Self::Mysql(pool) => pool
                .acquire()
                .await
                .map(DatabaseConnection::Mysql)
                .map_err(DatabaseError::Query),
            Self::Postgresql(pool) => pool
                .acquire()
                .await
                .map(DatabaseConnection::Postgresql)
                .map_err(DatabaseError::Query),
        }
    }

    pub(crate) async fn close(&self) {
        match self {
            Self::Mysql(pool) => pool.close().await,
            Self::Postgresql(pool) => pool.close().await,
        }
    }

    /// 向服务端请求中断指定连接上正在跑的语句。
    async fn cancel_backend(&self, backend_id: i64) -> DatabaseResult<()> {
        match self {
            // MySQL 的 KILL 不接受占位符；id 来自服务端自身的 CONNECTION_ID()，拼接安全。
            Self::Mysql(pool) => sqlx::query(&format!("KILL QUERY {backend_id}"))
                .execute(pool)
                .await
                .map(|_| ()),
            Self::Postgresql(pool) => sqlx::query("SELECT pg_cancel_backend($1)")
                .bind(backend_id as i32)
                .execute(pool)
                .await
                .map(|_| ()),
        }
        .map_err(DatabaseError::Query)?;

        Ok(())
    }
}

impl DatabaseConnection {
    /// 当前连接在服务端的标识，取消查询时用它定位目标。
    pub(crate) async fn backend_id(&mut self) -> DatabaseResult<i64> {
        match self {
            Self::Mysql(conn) => sqlx::query("SELECT CONNECTION_ID()")
                .fetch_one(&mut **conn)
                .await
                .and_then(|row| row.try_get::<u64, _>(0).map(|id| id as i64)),
            Self::Postgresql(conn) => sqlx::query("SELECT pg_backend_pid()")
                .fetch_one(&mut **conn)
                .await
                .and_then(|row| row.try_get::<i32, _>(0).map(i64::from)),
        }
        .map_err(DatabaseError::Query)
    }
}

/// 正在执行的查询。取消分两路：服务端中断语句，本地信号唤醒等待中的 future。
#[derive(Clone)]
pub(crate) struct RunningQuery {
    pub backend_id: i64,
    pub cancelled: Arc<AtomicBool>,
    pub notify: Arc<Notify>,
}

impl RunningQuery {
    fn new(backend_id: i64) -> Self {
        Self {
            backend_id,
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub(crate) async fn wait_cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }
}

struct SessionEntry {
    revision: u64,
    pool: DatabasePool,
    config: DatabaseConfig,
    /// 当前活动库。MySQL 允许为空（未选库）。
    database: String,
    server_version: String,
}

async fn connect_mysql(config: &DatabaseConfig) -> Result<MySqlPool, sqlx::Error> {
    let mut options = MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.username)
        .password(&config.password)
        .ssl_mode(mysql_ssl_mode(config.ssl_mode));

    if !config.database.trim().is_empty() {
        options = options.database(config.database.trim());
    }
    if !config.ca_certificate.trim().is_empty() {
        options = options.ssl_ca(Path::new(config.ca_certificate.trim()));
    }
    if !config.client_certificate.trim().is_empty() {
        options = options.ssl_client_cert(Path::new(config.client_certificate.trim()));
    }
    if !config.client_key.trim().is_empty() {
        options = options.ssl_client_key(Path::new(config.client_key.trim()));
    }

    MySqlPoolOptions::new()
        // 至少留一条额外连接给取消查询命令，避免执行连接占满池后无法发 KILL。
        .max_connections(config.max_connections.clamp(2, 50))
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(config.timeout_secs.max(1)))
        .connect_with(options)
        .await
}

async fn connect_postgresql(config: &DatabaseConfig) -> Result<PgPool, sqlx::Error> {
    let mut options = PgConnectOptions::new_without_pgpass()
        .host(&config.host)
        .port(config.port)
        .username(&config.username)
        .password(&config.password)
        .application_name("MiraiHub")
        .ssl_mode(postgresql_ssl_mode(config.ssl_mode));

    if !config.database.trim().is_empty() {
        options = options.database(config.database.trim());
    }
    if !config.ca_certificate.trim().is_empty() {
        options = options.ssl_root_cert(Path::new(config.ca_certificate.trim()));
    }
    if !config.client_certificate.trim().is_empty() {
        options = options.ssl_client_cert(Path::new(config.client_certificate.trim()));
    }
    if !config.client_key.trim().is_empty() {
        options = options.ssl_client_key(Path::new(config.client_key.trim()));
    }

    PgPoolOptions::new()
        .max_connections(config.max_connections.clamp(2, 50))
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(config.timeout_secs.max(1)))
        .connect_with(options)
        .await
}

fn mysql_ssl_mode(mode: DatabaseSslMode) -> MySqlSslMode {
    match mode {
        DatabaseSslMode::Disable => MySqlSslMode::Disabled,
        DatabaseSslMode::Prefer => MySqlSslMode::Preferred,
        DatabaseSslMode::Require => MySqlSslMode::Required,
        DatabaseSslMode::VerifyCa => MySqlSslMode::VerifyCa,
        DatabaseSslMode::VerifyFull => MySqlSslMode::VerifyIdentity,
    }
}

fn postgresql_ssl_mode(mode: DatabaseSslMode) -> PgSslMode {
    match mode {
        DatabaseSslMode::Disable => PgSslMode::Disable,
        DatabaseSslMode::Prefer => PgSslMode::Prefer,
        DatabaseSslMode::Require => PgSslMode::Require,
        DatabaseSslMode::VerifyCa => PgSslMode::VerifyCa,
        DatabaseSslMode::VerifyFull => PgSslMode::VerifyFull,
    }
}

fn validate_config(config: &DatabaseConfig) -> DatabaseResult<()> {
    if config.host.trim().is_empty() {
        return Err(DatabaseError::InvalidInput("主机不能为空".to_owned()));
    }
    if config.username.trim().is_empty() {
        return Err(DatabaseError::InvalidInput("用户名不能为空".to_owned()));
    }
    if config.port == 0 {
        return Err(DatabaseError::InvalidInput(
            "端口必须在 1 到 65535 之间".to_owned(),
        ));
    }

    Ok(())
}

/// 读取服务端版本号。失败不致命，返回空串即可。
async fn read_server_version(pool: &DatabasePool) -> String {
    let query = match pool {
        DatabasePool::Mysql(_) => "SELECT VERSION()",
        DatabasePool::Postgresql(_) => "SHOW server_version",
    };

    let value: Result<String, sqlx::Error> = match pool {
        DatabasePool::Mysql(pool) => sqlx::query_scalar(query).fetch_one(pool).await,
        DatabasePool::Postgresql(pool) => sqlx::query_scalar(query).fetch_one(pool).await,
    };

    value.unwrap_or_default()
}

/// 会话默认库。PostgreSQL 必须连到某个库，配置为空时读回服务端选定的那个。
async fn read_current_database(pool: &DatabasePool, configured: &str) -> String {
    if !configured.trim().is_empty() {
        return configured.trim().to_owned();
    }

    let value: Result<Option<String>, sqlx::Error> = match pool {
        DatabasePool::Mysql(pool) => {
            sqlx::query_scalar("SELECT DATABASE()")
                .fetch_one(pool)
                .await
        }
        DatabasePool::Postgresql(pool) => sqlx::query_scalar("SELECT current_database()")
            .fetch_one(pool)
            .await
            .map(Some),
    };

    value.ok().flatten().unwrap_or_default()
}

#[derive(Default)]
pub struct DatabaseManager {
    sessions: RwLock<HashMap<String, SessionEntry>>,
    running: RwLock<HashMap<String, RunningQuery>>,
}

impl DatabaseManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn test(&self, config: DatabaseConfig) -> DatabaseResult<()> {
        let pool = DatabasePool::connect(&config).await?;
        pool.close().await;
        Ok(())
    }

    pub async fn connect(&self, config: DatabaseConfig) -> DatabaseResult<DatabaseSession> {
        let pool = DatabasePool::connect(&config).await?;
        let server_version = read_server_version(&pool).await;
        let database = read_current_database(&pool, &config.database).await;
        let id = new_session_id();

        let session = DatabaseSession {
            session_id: id.clone(),
            kind: config.kind,
            endpoint: config.endpoint(),
            database: database.clone(),
            server_version: server_version.clone(),
        };

        self.sessions.write().await.insert(
            id,
            SessionEntry {
                revision: 0,
                pool,
                config,
                database,
                server_version,
            },
        );

        Ok(session)
    }

    pub(crate) async fn pool(&self, id: &str) -> DatabaseResult<DatabasePool> {
        self.sessions
            .read()
            .await
            .get(id)
            .map(|entry| entry.pool.clone())
            .ok_or_else(|| DatabaseError::SessionNotFound(id.to_owned()))
    }

    /// Capture AI targets atomically; manual USE/SET cannot alter the isolated AI pool.
    pub(crate) async fn agent_config(
        &self,
        id: &str,
        database: &str,
    ) -> DatabaseResult<(DatabaseConfig, u64)> {
        let sessions = self.sessions.read().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| DatabaseError::SessionNotFound(id.into()))?;
        if entry.database != database {
            return Err(DatabaseError::InvalidInput(
                "活动数据库已改变，请重新发起 AI 请求".into(),
            ));
        }
        let mut config = entry.config.clone();
        config.database = entry.database.clone();
        config.max_connections = 2;
        config.timeout_secs = 10;
        Ok((config, entry.revision))
    }

    pub async fn describe_session(&self, id: &str) -> DatabaseResult<DatabaseSession> {
        let sessions = self.sessions.read().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| DatabaseError::SessionNotFound(id.to_owned()))?;

        Ok(DatabaseSession {
            session_id: id.to_owned(),
            kind: entry.config.kind,
            endpoint: entry.config.endpoint(),
            database: entry.database.clone(),
            server_version: entry.server_version.clone(),
        })
    }

    /// 切换活动库：用新的 database 重建连接池并替换。
    /// `USE` 只作用于单条连接，池化场景下必须换池才可靠。
    pub async fn use_database(&self, id: &str, database: &str) -> DatabaseResult<DatabaseSession> {
        let mut config = {
            let sessions = self.sessions.read().await;
            sessions
                .get(id)
                .map(|entry| entry.config.clone())
                .ok_or_else(|| DatabaseError::SessionNotFound(id.to_owned()))?
        };

        if database.trim().is_empty() {
            return Err(DatabaseError::InvalidInput("库名不能为空".to_owned()));
        }

        config.database = database.trim().to_owned();
        let pool = DatabasePool::connect(&config).await?;
        let server_version = read_server_version(&pool).await;

        let previous = {
            let mut sessions = self.sessions.write().await;
            let entry = sessions
                .get_mut(id)
                .ok_or_else(|| DatabaseError::SessionNotFound(id.to_owned()))?;
            let previous = std::mem::replace(&mut entry.pool, pool);
            entry.revision += 1;
            entry.config = config.clone();
            entry.database = config.database.clone();
            entry.server_version = server_version.clone();
            previous
        };

        previous.close().await;

        Ok(DatabaseSession {
            session_id: id.to_owned(),
            kind: config.kind,
            endpoint: config.endpoint(),
            database: config.database,
            server_version,
        })
    }

    /// 登记一条正在执行的查询。同一会话同时只允许一条，重复调用会顶掉旧记录。
    pub(crate) async fn begin_query(&self, id: &str, backend_id: i64) -> RunningQuery {
        let running = RunningQuery::new(backend_id);
        self.running
            .write()
            .await
            .insert(id.to_owned(), running.clone());
        running
    }

    pub(crate) async fn end_query(&self, id: &str) {
        self.running.write().await.remove(id);
    }

    /// 取消会话上正在跑的查询。没有正在执行的语句时是空操作。
    pub async fn cancel(&self, id: &str) -> DatabaseResult<bool> {
        let Some(running) = self.running.read().await.get(id).cloned() else {
            return Ok(false);
        };

        running.cancelled.store(true, Ordering::Relaxed);
        // notify_one 会在等待 future 尚未完成注册时保留一个 permit，避免取消信号丢失。
        running.notify.notify_one();

        let pool = self.pool(id).await?;
        // 服务端取消失败不算错误：语句可能刚好自己结束了。
        if let Err(error) = pool.cancel_backend(running.backend_id).await {
            log::debug!("请求服务端取消查询失败：{error}");
        }

        Ok(true)
    }

    pub async fn disconnect(&self, id: &str) -> DatabaseResult<()> {
        self.running.write().await.remove(id);
        let entry = self.sessions.write().await.remove(id);
        match entry {
            Some(entry) => {
                entry.pool.close().await;
                Ok(())
            }
            None => Err(DatabaseError::SessionNotFound(id.to_owned())),
        }
    }

    pub async fn shutdown(&self) {
        self.running.write().await.clear();
        let pools: Vec<_> = self
            .sessions
            .write()
            .await
            .drain()
            .map(|(_, entry)| entry.pool)
            .collect();
        for pool in pools {
            pool.close().await;
        }
    }
}

fn new_session_id() -> String {
    use std::sync::atomic::AtomicU64;
    static COUNTER: AtomicU64 = AtomicU64::new(1);

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("db-{millis}-{sequence}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> DatabaseConfig {
        DatabaseConfig {
            kind: DatabaseKind::Mysql,
            host: "localhost".to_owned(),
            port: 3306,
            username: "root".to_owned(),
            password: String::new(),
            database: String::new(),
            ssl_mode: DatabaseSslMode::Disable,
            ca_certificate: String::new(),
            client_certificate: String::new(),
            client_key: String::new(),
            timeout_secs: 20,
            max_connections: 8,
        }
    }

    #[test]
    fn session_ids_are_unique() {
        let first = new_session_id();
        let second = new_session_id();
        assert_ne!(first, second);
        assert!(first.starts_with("db-"));
    }

    #[test]
    fn rejects_empty_host() {
        let config = DatabaseConfig {
            host: String::new(),
            ..sample_config()
        };

        assert!(matches!(
            validate_config(&config),
            Err(DatabaseError::InvalidInput(_))
        ));
    }

    #[test]
    fn accepts_valid_config() {
        assert!(validate_config(&sample_config()).is_ok());
    }

    #[tokio::test]
    async fn cancelling_idle_session_is_a_no_op() {
        let manager = DatabaseManager::new();
        assert_eq!(manager.cancel("db-missing").await.unwrap(), false);
    }

    #[tokio::test]
    async fn running_query_reports_cancellation() {
        let manager = DatabaseManager::new();
        let running = manager.begin_query("db-1", 42).await;
        assert!(!running.is_cancelled());

        running.cancelled.store(true, Ordering::Relaxed);
        assert!(running.is_cancelled());
        // 已经取消时不应再阻塞在通知上。
        running.wait_cancelled().await;

        manager.end_query("db-1").await;
    }
}
