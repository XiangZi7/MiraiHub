//! 数据库模块错误，以及到应用级结构化错误的映射。

use crate::error::{AppError, ErrorKind};

#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    #[error("参数不合法：{0}")]
    InvalidInput(String),

    #[error("连接 {endpoint} 超时（{secs}s）")]
    Timeout { endpoint: String, secs: u64 },

    #[error("SQL 执行超时（{secs}s）")]
    StatementTimeout { secs: u64 },

    #[error("连接 {endpoint} 失败：{source}")]
    Connect {
        endpoint: String,
        #[source]
        source: sqlx::Error,
    },

    #[error("SQL 执行失败：{0}")]
    Query(#[source] sqlx::Error),

    #[error("{operation}文件 {path} 失败：{source}")]
    Io {
        operation: &'static str,
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("查询已被取消")]
    Cancelled,

    #[error("数据库会话 {0} 不存在或已断开")]
    SessionNotFound(String),
}

impl From<DatabaseError> for AppError {
    fn from(error: DatabaseError) -> Self {
        let kind = match &error {
            DatabaseError::InvalidInput(_) => ErrorKind::InvalidInput,
            DatabaseError::Timeout { .. } | DatabaseError::StatementTimeout { .. } => {
                ErrorKind::Network
            }
            DatabaseError::SessionNotFound(_) => ErrorKind::NotFound,
            DatabaseError::Cancelled => ErrorKind::Internal,
            DatabaseError::Query(_) => ErrorKind::InvalidInput,
            DatabaseError::Io { .. } => ErrorKind::Internal,
            DatabaseError::Connect { source, .. } => connect_error_kind(source),
        };

        AppError::new(kind, error.to_string())
    }
}

fn connect_error_kind(error: &sqlx::Error) -> ErrorKind {
    match error {
        sqlx::Error::Database(database_error) => {
            let code = database_error.code();
            match code.as_deref() {
                // PostgreSQL invalid_password / invalid_authorization_specification,
                // MySQL access denied.
                Some("28P01" | "28000" | "1045") => ErrorKind::Auth,
                // PostgreSQL invalid_catalog_name / MySQL unknown database.
                Some("3D000" | "1049") => ErrorKind::NotFound,
                _ => ErrorKind::Network,
            }
        }
        sqlx::Error::Configuration(_) => ErrorKind::InvalidInput,
        sqlx::Error::Io(_)
        | sqlx::Error::Tls(_)
        | sqlx::Error::PoolTimedOut
        | sqlx::Error::PoolClosed
        | sqlx::Error::WorkerCrashed => ErrorKind::Network,
        _ => ErrorKind::Internal,
    }
}

pub type DatabaseResult<T> = Result<T, DatabaseError>;
