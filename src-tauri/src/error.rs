//! 应用级错误。
//!
//! 所有 `#[tauri::command]` 统一返回 `Result<T, AppError>`：
//! 各业务模块（ssh、后续的 db）定义自己的细粒度错误，再收敛到这里。
//! 序列化成前端友好的 `{ kind, message }`，让 TS 侧能按 kind 分支处理，
//! 而不是去匹配错误文案。

use serde::Serialize;

/// 错误分类。前端据此决定交互：
/// 比如 `Auth` 弹重新输入密码，`Network` 提示重试，`Internal` 只记日志。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// 参数不合法（端口越界、路径为空等），调用方的问题
    InvalidInput,
    /// 连接建立失败：DNS、超时、拒绝连接
    Network,
    /// 认证失败：密码错误、密钥不被接受、口令解不开私钥
    Auth,
    /// 目标资源不存在：会话 id 找不到、密钥文件被删了
    NotFound,
    /// 文件系统读写失败
    Io,
    /// 其余未归类的内部错误
    Internal,
}

/// 跨 IPC 边界的错误载荷。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidInput, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotFound, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::new(ErrorKind::Io, err.to_string())
    }
}

/// 命令层统一返回类型。
pub type AppResult<T> = Result<T, AppError>;
