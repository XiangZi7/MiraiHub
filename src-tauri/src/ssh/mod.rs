//! SSH 能力模块。
//!
//! 分层（自下而上）：
//! - `models`   数据结构，无 IO
//! - `error`    模块内错误，跨 IPC 时收敛成 `crate::error::AppError`
//! - `events`   推送给前端的事件负载与发送辅助
//! - `shell`    远端命令的转义与输出切分，被 stats / files 复用
//! - `session`  单条连接：认证、PTY shell、exec
//! - `stats`    远端系统指标采集（走 exec，不装 agent）
//! - `files`    远端目录浏览（解析 ls 输出）
//! - `keys`     本地 `~/.ssh` 密钥的扫描 / 生成 / 删除
//! - `manager`  会话注册表，作为 Tauri 托管状态
//! - `commands` `#[tauri::command]` 薄封装，只做转调与错误转换
//!
//! 后续的数据库模块按同样的分层放在 `crate::db`，两边互不引用。

pub mod commands;
pub mod completion;
pub mod error;
pub mod events;
pub mod files;
pub mod keys;
pub mod manager;
pub mod models;
pub mod session;
pub mod shell;
pub mod stats;
pub mod transfers;

pub use manager::SessionManager;
pub use transfers::TransferManager;
