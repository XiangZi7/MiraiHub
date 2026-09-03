//! SSH 模块的错误类型。
//!
//! 业务错误在这里保持细粒度（便于内部匹配处理），
//! 只在跨越 IPC 边界时通过 `From<SshError> for AppError` 收敛成前端可消费的形状。

use crate::error::{AppError, ErrorKind};

#[derive(Debug, thiserror::Error)]
pub enum SshError {
    #[error("连接 {endpoint} 失败：{source}")]
    Connect {
        endpoint: String,
        #[source]
        source: russh::Error,
    },

    #[error("连接 {endpoint} 超时（{secs}s）")]
    Timeout { endpoint: String, secs: u64 },

    #[error("认证失败：服务器拒绝了 {method} 方式")]
    AuthRejected { method: &'static str },

    #[error("会话 {0} 不存在或已断开")]
    SessionNotFound(String),

    #[error("私钥 {path} 解析失败：{source}")]
    KeyParse {
        path: String,
        #[source]
        source: russh::keys::Error,
    },

    #[error("密钥文件 {0} 不存在")]
    KeyNotFound(String),

    #[error("密钥 {0} 已存在，换个名字或先删除旧的")]
    KeyExists(String),

    #[error("找不到 ~/.ssh 目录：无法定位用户主目录")]
    NoHomeDir,

    #[error("参数不合法：{0}")]
    InvalidInput(String),

    #[error("SSH 协议错误：{0}")]
    Protocol(#[from] russh::Error),

    #[error("密钥操作失败：{0}")]
    Key(#[from] russh::keys::Error),

    #[error("文件读写失败：{0}")]
    Io(#[from] std::io::Error),
}

impl From<SshError> for AppError {
    fn from(err: SshError) -> Self {
        let kind = match &err {
            SshError::Connect { .. } | SshError::Timeout { .. } => ErrorKind::Network,
            SshError::AuthRejected { .. } | SshError::KeyParse { .. } => ErrorKind::Auth,
            SshError::SessionNotFound(_) | SshError::KeyNotFound(_) => ErrorKind::NotFound,
            SshError::InvalidInput(_) | SshError::KeyExists(_) => ErrorKind::InvalidInput,
            SshError::Io(_) | SshError::NoHomeDir => ErrorKind::Io,
            SshError::Protocol(_) | SshError::Key(_) => ErrorKind::Internal,
        };

        // 用 Display 而非 Debug：Display 已带上下文，且不会把 AuthMethod 里的密码打出来
        AppError::new(kind, err.to_string())
    }
}

pub type SshResult<T> = Result<T, SshError>;
