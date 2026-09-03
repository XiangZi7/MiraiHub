//! SSH 能力模块。
//!
//! 分层（自下而上）：
//! - `models`   数据结构，无 IO
//! - `error`    模块内错误，跨 IPC 时收敛成 `crate::error::AppError`
//! - `events`   推送给前端的事件负载与发送辅助
//! - `session`  单条连接：认证、PTY shell、exec
//! - `keys`     本地 `~/.ssh` 密钥的扫描 / 生成 / 删除
//! - `manager`  会话注册表，作为 Tauri 托管状态
//! - `commands` `#[tauri::command]` 薄封装，只做转调与错误转换
//!
//! 后续的数据库模块按同样的分层放在 `crate::db`，两边互不引用。

pub mod commands;
pub mod error;
pub mod events;
pub mod keys;
pub mod manager;
pub mod models;
pub mod session;

pub use manager::SessionManager;
