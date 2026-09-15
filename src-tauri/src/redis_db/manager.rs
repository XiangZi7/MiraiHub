use super::{models::*, protocol::*};
use crate::{
    db::models::DatabaseSslMode,
    error::{AppError, AppResult, ErrorKind},
};
use redis::{
    aio::MultiplexedConnection, AsyncConnectionConfig, Client, ConnectionAddr, ConnectionInfo,
    RedisConnectionInfo, Value,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

pub struct Session {
    connection: Option<MultiplexedConnection>,
    info: RedisSession,
    config: RedisConfig,
    revision: u64,
}

impl Session {
    async fn query<T: redis::FromRedisValue>(&mut self, command: &redis::Cmd) -> AppResult<T> {
        let connection = self
            .connection
            .as_mut()
            .ok_or_else(|| AppError::not_found("Redis 连接已断开，请重新连接"))?;
        match command.query_async(connection).await {
            Ok(value) => Ok(value),
            Err(error) => {
                // 超时后不自动重放命令，写入是否成功由用户刷新确认。
                if error.is_io_error() || error.is_timeout() {
                    self.connection = None;
                }
                Err(redis_error(error))
            }
        }
    }
}

#[derive(Default)]
pub struct RedisManager {
    sessions: RwLock<HashMap<String, Arc<Mutex<Session>>>>,
}

fn redis_error(error: redis::RedisError) -> AppError {
    let kind = if error.kind() == redis::ErrorKind::AuthenticationFailed
        || matches!(error.code(), Some("NOAUTH" | "WRONGPASS"))
    {
        ErrorKind::Auth
    } else if error.is_io_error() || error.is_timeout() {
        ErrorKind::Network
    } else {
        ErrorKind::InvalidInput
    };
    AppError::new(kind, error.to_string())
}

async fn certificate(path: &str) -> AppResult<Option<Vec<u8>>> {
    if path.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(tokio::fs::read(path.trim()).await?))
}

async fn open(config: RedisConfig) -> AppResult<Session> {
    let db = database_index(&config.database)?;
    if config.host.trim().is_empty() || config.host.contains('\0') || config.port == 0 {
        return Err(AppError::invalid_input("Invalid Redis host or port"));
    }
    let tls = match config.ssl_mode {
        DatabaseSslMode::Disable => false,
        DatabaseSslMode::VerifyFull => true,
        _ => {
            return Err(AppError::invalid_input(
                "Redis TLS 请选择 Disable 或 Verify Full",
            ))
        }
    };
    if tls && (config.client_certificate.trim().is_empty() != config.client_key.trim().is_empty()) {
        return Err(AppError::invalid_input(
            "客户端证书和客户端私钥需要同时选择",
        ));
    }
    let host = config.host.trim().to_owned();
    let info = ConnectionInfo {
        addr: if tls {
            ConnectionAddr::TcpTls {
                host: host.clone(),
                port: config.port,
                insecure: false,
                tls_params: None,
            }
        } else {
            ConnectionAddr::Tcp(host.clone(), config.port)
        },
        redis: RedisConnectionInfo {
            db,
            username: (!config.username.trim().is_empty())
                .then(|| config.username.trim().to_owned()),
            password: (!config.password.is_empty()).then(|| config.password.clone()),
            protocol: redis::ProtocolVersion::RESP2,
        },
    };
    let client = if tls {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client_tls = match (
            certificate(&config.client_certificate).await?,
            certificate(&config.client_key).await?,
        ) {
            (Some(client_cert), Some(client_key)) => Some(redis::ClientTlsConfig {
                client_cert,
                client_key,
            }),
            _ => None,
        };
        Client::build_with_tls(
            info,
            redis::TlsCertificates {
                client_tls,
                root_cert: certificate(&config.ca_certificate).await?,
            },
        )
    } else {
        Client::open(info)
    }
    .map_err(redis_error)?;
    let timeout = Duration::from_secs(config.timeout_secs.clamp(1, 300));
    let connection = client
        .get_multiplexed_async_connection_with_config(
            &AsyncConnectionConfig::new()
                .set_connection_timeout(timeout)
                .set_response_timeout(timeout),
        )
        .await
        .map_err(redis_error)?;
    let mut session = Session {
        connection: Some(connection),
        info: RedisSession {
            session_id: String::new(),
            database: db.to_string(),
            endpoint: format!("{host}:{}", config.port),
        },
        config,
        revision: 0,
    };
    let _: String = session.query(&redis::cmd("PING")).await?;
    Ok(session)
}

impl RedisManager {
    pub async fn test(&self, config: RedisConfig) -> AppResult<()> {
        open(config).await?;
        Ok(())
    }

    pub async fn connect(&self, config: RedisConfig) -> AppResult<RedisSession> {
        let mut session = open(config).await?;
        session.info.session_id = format!("redis-{}", NEXT_SESSION.fetch_add(1, Ordering::Relaxed));
        let info = session.info.clone();
        self.sessions
            .write()
            .await
            .insert(info.session_id.clone(), Arc::new(Mutex::new(session)));
        Ok(info)
    }

    async fn session(&self, id: &str) -> AppResult<Arc<Mutex<Session>>> {
        self.sessions
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::not_found("Redis 连接已断开，请重新连接"))
    }

    pub async fn disconnect(&self, id: &str) {
        let session = self.sessions.write().await.remove(id);
        if let Some(session) = session {
            session.lock().await.connection = None;
        }
    }

    pub async fn shutdown(&self) {
        self.sessions.write().await.clear();
    }

    pub async fn use_database(&self, id: &str, database: &str) -> AppResult<RedisSession> {
        let db = database_index(database)?;
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let _: () = session.query(redis::cmd("SELECT").arg(db)).await?;
        session.info.database = db.to_string();
        // 切走再切回也会使旧审批失效。
        session.revision += 1;
        Ok(session.info.clone())
    }

    /// 快照只在后端流转；AI 用独立连接，避免手动命令污染其连接状态。
    pub(crate) async fn agent_config(
        &self,
        id: &str,
        database: &str,
    ) -> AppResult<(RedisConfig, u64)> {
        let session = self.session(id).await?;
        let session = session.lock().await;
        if session.connection.is_none() {
            return Err(AppError::not_found("Redis 连接已断开，请重新连接"));
        }
        if session.info.database != database {
            return Err(AppError::invalid_input("活动数据库已改变，请重新发起 AI 请求"));
        }
        let mut config = session.config.clone();
        config.database = session.info.database.clone();
        config.timeout_secs = 10;
        Ok((config, session.revision))
    }

    pub async fn scan(&self, id: &str, cursor: &str, pattern: &str) -> AppResult<RedisKeyPage> {
        let cursor = cursor
            .parse::<u64>()
            .map_err(|_| AppError::invalid_input("Invalid Redis scan cursor"))?;
        if pattern.len() > 4096 {
            return Err(AppError::invalid_input("Redis scan pattern is too long"));
        }
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let (cursor, keys): (u64, Vec<Vec<u8>>) = session
            .query(
                redis::cmd("SCAN")
                    .arg(cursor)
                    .arg("MATCH")
                    .arg(if pattern.is_empty() { "*" } else { pattern })
                    .arg("COUNT")
                    .arg(100),
            )
            .await?;
        // COUNT 是提示，不能截断服务器返回的键，否则会丢失本次游标覆盖的键。
        Ok(RedisKeyPage {
            cursor: cursor.to_string(),
            keys: keys.iter().map(|key| key_info(key)).collect(),
        })
    }

    pub async fn inspect(&self, id: &str, encoded_key: &str) -> AppResult<RedisKeyDetail> {
        let key = decode_key(encoded_key)?;
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let key_type: String = session.query(redis::cmd("TYPE").arg(&key)).await?;
        if key_type == "none" {
            return Err(AppError::not_found("Redis 键不存在或已过期"));
        }
        let ttl_ms = session.query(redis::cmd("PTTL").arg(&key)).await?;
        if ttl_ms == -2 {
            return Err(AppError::not_found("Redis 键不存在或已过期"));
        }
        let (length_cmd, value_cmd) = match key_type.as_str() {
            "string" => ("STRLEN", "GETRANGE"),
            "hash" => ("HLEN", "HSCAN"),
            "list" => ("LLEN", "LRANGE"),
            "set" => ("SCARD", "SSCAN"),
            "zset" => ("ZCARD", "ZRANGE"),
            "stream" => ("XLEN", "XRANGE"),
            _ => {
                return Ok(RedisKeyDetail {
                    key: key_info(&key),
                    key_type,
                    ttl_ms,
                    length: 0,
                    value: serde_json::json!("此类型请使用 Redis 命令读取"),
                    truncated: false,
                    editable: false,
                })
            }
        };
        let length: u64 = session.query(redis::cmd(length_cmd).arg(&key)).await?;
        let mut command = redis::cmd(value_cmd);
        command.arg(&key);
        match key_type.as_str() {
            "string" => {
                // 多读一个字节作为截断标记，防止并发增长后将不完整值开放编辑。
                command.arg(0).arg(PREVIEW_BYTES);
            }
            "hash" | "set" => {
                command.arg(0).arg("COUNT").arg(PREVIEW_ITEMS);
            }
            "stream" => {
                command.arg("-").arg("+").arg("COUNT").arg(PREVIEW_ITEMS);
            }
            "zset" => {
                command.arg(0).arg(PREVIEW_ITEMS - 1).arg("WITHSCORES");
            }
            _ => {
                command.arg(0).arg(PREVIEW_ITEMS - 1);
            }
        }
        let result: Value = session.query(&command).await?;
        let editable = key_type == "string"
            && length <= PREVIEW_BYTES as u64
            && matches!(&result, Value::BulkString(bytes) if bytes.len() as u64 == length && std::str::from_utf8(bytes).is_ok());
        let scan_has_more = matches!(key_type.as_str(), "hash" | "set")
            && matches!(&result, Value::Array(items) if items.first().is_some_and(|cursor| !matches!(cursor, Value::BulkString(value) if value == b"0")));
        let (value, cut) = preview(&result);
        let limit = if key_type == "string" {
            PREVIEW_BYTES
        } else {
            PREVIEW_ITEMS
        };
        Ok(RedisKeyDetail {
            key: key_info(&key),
            key_type,
            ttl_ms,
            length,
            value,
            truncated: cut || scan_has_more || length > limit as u64,
            editable,
        })
    }

    pub async fn execute(&self, id: &str, input: &str) -> AppResult<RedisCommandResult> {
        let args = parse_command(input)?;
        let name = validate_command(&args)?;
        let mut command = redis::cmd(&name);
        for arg in args.iter().skip(1) {
            command.arg(arg);
        }
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let started = Instant::now();
        let result: Value = session.query(&command).await?;
        let (value, truncated) = preview(&result);
        Ok(RedisCommandResult {
            value,
            truncated,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    pub async fn save_string(&self, id: &str, encoded_key: &str, value: &str) -> AppResult<()> {
        if value.len() > PREVIEW_BYTES {
            return Err(AppError::invalid_input(
                "Redis value exceeds the editor limit (64 KiB)",
            ));
        }
        let key = decode_key(encoded_key)?;
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        // TYPE 与 SET 原子检查，避免键被并发改成集合后被编辑器覆盖。保留现有 TTL。
        let result: Option<String> = session.query(redis::cmd("EVAL")
            .arg("if redis.call('TYPE', KEYS[1]).ok ~= 'string' then return false end; return redis.call('SET', KEYS[1], ARGV[1], 'XX', 'KEEPTTL')")
            .arg(1).arg(&key).arg(value)).await?;
        if result.is_none() {
            return Err(AppError::not_found("Redis 键不存在或类型已变化，请刷新"));
        }
        Ok(())
    }

    pub async fn delete_key(&self, id: &str, encoded_key: &str) -> AppResult<()> {
        let key = decode_key(encoded_key)?;
        let session = self.session(id).await?;
        let _: u64 = session
            .lock()
            .await
            .query(redis::cmd("UNLINK").arg(key))
            .await?;
        Ok(())
    }

    pub async fn expire_key(&self, id: &str, encoded_key: &str, ttl_secs: i64) -> AppResult<()> {
        if ttl_secs != -1 && !(1..=2_147_483_647).contains(&ttl_secs) {
            return Err(AppError::invalid_input("TTL 必须为正整数，-1 表示永不过期"));
        }
        let key = decode_key(encoded_key)?;
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let mut command = redis::cmd(if ttl_secs == -1 { "PERSIST" } else { "EXPIRE" });
        command.arg(&key);
        if ttl_secs != -1 {
            command.arg(ttl_secs);
        }
        let _: u64 = session.query(&command).await?;
        Ok(())
    }
}
