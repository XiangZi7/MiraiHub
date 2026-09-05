//! MiraiHub 桌面端。
//!
//! 目录约定：
//! - `app`       应用装配：插件、托管状态、生命周期
//! - `ipc`       IPC 命令注册表，新增命令只改这里
//! - `error`     跨 IPC 的统一错误类型
//! - `platform`  平台相关的窗口处理
//! - `ssh`       SSH 连接、终端会话、密钥管理
//! - `db`        数据库连接池、对象结构与查询
//!
//! 每个业务模块内部自下而上分层：`models` → `error` → 业务实现 → `commands`，
//! 其中 `commands.rs` 只做转调与错误转换，逻辑写在下层以便 `cargo test` 覆盖。

pub mod agent;
pub mod app;
pub mod db;
pub mod error;
pub mod ipc;
pub mod local_terminal;
pub mod platform;
pub mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}
