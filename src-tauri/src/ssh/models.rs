//! SSH 相关的数据模型。
//!
//! 这一层只描述"是什么"，不含任何 IO：
//! 便于命令层、会话层、密钥层共享同一套结构，也让前端 TS 类型有唯一的对照源。
//! 字段一律 camelCase 序列化，与前端 `src/types/ssh.ts` 逐字对应。

use serde::{Deserialize, Serialize};

/// 认证方式。
///
/// 用 tag 化枚举而不是"可选字段的大结构"，
/// 是为了让"用密码就必须有密码、用密钥就必须有路径"由类型保证，
/// 而不是在运行时挨个 unwrap。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthMethod {
    /// 密码认证
    Password { password: String },
    /// 私钥认证。passphrase 仅在私钥加密时需要
    PrivateKey {
        /// 私钥文件绝对路径
        path: String,
        passphrase: Option<String>,
    },
    /// 交给 ssh-agent（Windows 上是 OpenSSH Authentication Agent 命名管道）
    Agent,
}

impl AuthMethod {
    /// 日志用的方式名。
    /// 单独给一个方法，是为了杜绝有人顺手 `{:?}` 整个枚举把密码打进日志。
    pub fn label(&self) -> &'static str {
        match self {
            Self::Password { .. } => "password",
            Self::PrivateKey { .. } => "publickey",
            Self::Agent => "agent",
        }
    }
}

/// 建立连接所需的全部参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    /// TCP 连接与握手的超时秒数，缺省 20s
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
    /// keepalive 间隔秒数，0 表示不发。缺省 30s，
    /// 长时间挂着不动的会话很容易被中间的 NAT/防火墙静默掐掉
    #[serde(default = "default_keepalive_secs")]
    pub keepalive_secs: u64,
    /// 是否按 ~/.ssh/known_hosts 校验主机密钥。
    #[serde(default = "default_verify_host_key")]
    pub verify_host_key: bool,
}

fn default_timeout_secs() -> u64 {
    20
}

fn default_keepalive_secs() -> u64 {
    30
}

fn default_verify_host_key() -> bool {
    true
}

impl SshConfig {
    /// `user@host:port`，用于日志与前端展示。
    pub fn endpoint(&self) -> String {
        format!("{}@{}:{}", self.username, self.host, self.port)
    }
}

/// 打开交互式 shell 时的终端参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOptions {
    /// 终端类型，xterm.js 对应 "xterm-256color"
    #[serde(default = "default_term")]
    pub term: String,
    pub cols: u32,
    pub rows: u32,
}

fn default_term() -> String {
    "xterm-256color".to_owned()
}

impl Default for PtyOptions {
    fn default() -> Self {
        Self {
            term: default_term(),
            cols: 80,
            rows: 24,
        }
    }
}

/// 会话在前端的可见状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Connecting,
    Connected,
    Disconnected,
}

/// 会话摘要。列表、标签页展示用，不含任何凭据。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub status: SessionStatus,
    /// 建立时间，Unix 毫秒。前端自己算"已连接 3 分钟"
    pub connected_at: i64,
}

/// 远端命令的执行结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    /// 退出码。信号杀死等拿不到退出码的情况为 None
    pub exit_code: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFileRequest {
    pub session_id: String,
    pub task_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub overwrite: bool,
    #[serde(default = "default_transfer_buffer_size_kb")]
    pub buffer_size_kb: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFileRequest {
    pub session_id: String,
    pub task_id: String,
    pub remote_path: String,
    pub local_path: String,
    pub overwrite: bool,
    #[serde(default = "default_transfer_buffer_size_kb")]
    pub buffer_size_kb: usize,
}

fn default_transfer_buffer_size_kb() -> usize {
    128
}

/// SSH 密钥算法。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SshKeyKind {
    Ed25519,
    Rsa,
    Ecdsa,
}

/// 扫描到的本地密钥。只含公开信息，私钥内容永远不出 Rust 侧。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    /// 私钥文件绝对路径，同时作为唯一标识
    pub id: String,
    /// 密钥名，即私钥文件名
    pub label: String,
    pub kind: SshKeyKind,
    /// 密钥位数，ed25519 固定 256
    pub bits: u32,
    /// OpenSSH 风格的 SHA256 指纹
    pub fingerprint: String,
    /// 公钥全文（含算法前缀与注释）
    pub public_key: String,
    /// 公钥注释，通常是 user@host
    pub comment: String,
    /// 私钥是否有口令保护
    pub encrypted: bool,
    /// 私钥文件修改时间，Unix 毫秒
    pub modified_at: i64,
}

/// 生成密钥的入参。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyRequest {
    /// 私钥文件名，如 `id_ed25519`。不允许含路径分隔符
    pub label: String,
    pub kind: SshKeyKind,
    /// RSA 位数，仅 kind = rsa 时生效，缺省 4096
    #[serde(default)]
    pub bits: Option<u32>,
    /// 公钥注释，缺省 `user@hostname`
    #[serde(default)]
    pub comment: Option<String>,
    /// 私钥口令，None 或空串表示不加密
    #[serde(default)]
    pub passphrase: Option<String>,
}
