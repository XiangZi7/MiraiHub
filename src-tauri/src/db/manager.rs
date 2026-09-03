//! 数据库会话注册表与连接池生命周期。

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};
use tokio::sync::RwLock;

use super::error::{DatabaseError, DatabaseResult};
use super::models::{DatabaseConfig, DatabaseKind, DatabaseSslMode};

#[derive(Clone)]
pub(crate) enum DatabasePool {
    Mysql(MySqlPool),
    Postgresql(PgPool),
}

impl DatabasePool {
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

    pub(crate) async fn close(&self) {
        match self {
            Self::Mysql(pool) => pool.close().await,
            Self::Postgresql(pool) => pool.close().await,
        }
    }
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
        .max_connections(5)
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
        .max_connections(5)
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

#[derive(Default)]
pub struct DatabaseManager {
    sessions: RwLock<HashMap<String, DatabasePool>>,
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

    pub async fn connect(&self, config: DatabaseConfig) -> DatabaseResult<String> {
        let pool = DatabasePool::connect(&config).await?;
        let id = new_session_id();
        self.sessions.write().await.insert(id.clone(), pool);
        Ok(id)
    }

    pub(crate) async fn get(&self, id: &str) -> DatabaseResult<DatabasePool> {
        self.sessions
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| DatabaseError::SessionNotFound(id.to_owned()))
    }

    pub async fn disconnect(&self, id: &str) -> DatabaseResult<()> {
        let pool = self.sessions.write().await.remove(id);
        match pool {
            Some(pool) => {
                pool.close().await;
                Ok(())
            }
            None => Err(DatabaseError::SessionNotFound(id.to_owned())),
        }
    }

    pub async fn shutdown(&self) {
        let pools: Vec<_> = self
            .sessions
            .write()
            .await
            .drain()
            .map(|(_, pool)| pool)
            .collect();
        for pool in pools {
            pool.close().await;
        }
    }
}

fn new_session_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
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
            kind: DatabaseKind::Mysql,
            host: String::new(),
            port: 3306,
            username: "root".to_owned(),
            password: String::new(),
            database: String::new(),
            ssl_mode: DatabaseSslMode::Disable,
            ca_certificate: String::new(),
            client_certificate: String::new(),
            client_key: String::new(),
            timeout_secs: 20,
        };

        assert!(matches!(
            validate_config(&config),
            Err(DatabaseError::InvalidInput(_))
        ));
    }
}
