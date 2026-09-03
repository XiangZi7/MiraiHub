//! SSH 会话推送到前端的事件。
//!
//! 终端输出是持续流式的，走 `invoke` 请求-响应模型不合适，
//! 所以统一用 Tauri 事件往前端推。
//!
//! 事件名带 `ssh://` 前缀做命名空间，避免和后续数据库模块的事件撞名。

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// 终端有新输出。
pub const EVENT_OUTPUT: &str = "ssh://output";
/// 会话状态变化（连上、断开）。
pub const EVENT_STATUS: &str = "ssh://status";
/// 文件传输进度与状态变化。
pub const EVENT_TRANSFER: &str = "ssh://transfer";

/// 终端输出负载。
///
/// data 是 base64 而非 String —— 远端输出是任意字节流：
/// 多字节 UTF-8 字符会被 SSH 的分包切断，直接按 String 解会得到乱码或丢字符。
/// 交给前端在 xterm.js 侧按字节写入，由它自己处理跨块的不完整字符。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputEvent {
    pub session_id: String,
    /// base64 编码的原始字节
    pub data: String,
    /// 是否来自 stderr（SSH 的扩展数据通道）
    pub is_stderr: bool,
}

/// 会话状态变更负载。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub session_id: String,
    /// 与 models::SessionStatus 的序列化值一致
    pub status: &'static str,
    /// 远端 shell 的退出码，仅正常退出时有值
    pub exit_code: Option<u32>,
    /// 异常断开时的原因文案
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvent {
    pub task_id: String,
    pub status: &'static str,
    pub transferred_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub local_path: Option<String>,
    pub error: Option<String>,
}

impl TransferEvent {
    pub fn progress(task_id: impl Into<String>, transferred: u64, total: u64) -> Self {
        Self {
            task_id: task_id.into(),
            status: "running",
            transferred_bytes: Some(transferred),
            total_bytes: Some(total),
            local_path: None,
            error: None,
        }
    }

    pub fn status(task_id: impl Into<String>, status: &'static str) -> Self {
        Self {
            task_id: task_id.into(),
            status,
            transferred_bytes: None,
            total_bytes: None,
            local_path: None,
            error: None,
        }
    }

    pub fn completed(task_id: impl Into<String>, local_path: Option<String>) -> Self {
        Self {
            local_path,
            ..Self::status(task_id, "completed")
        }
    }

    pub fn failed(task_id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            error: Some(error.into()),
            ..Self::status(task_id, "error")
        }
    }
}

impl StatusEvent {
    pub fn connected(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            status: "connected",
            exit_code: None,
            reason: None,
        }
    }

    pub fn disconnected(session_id: impl Into<String>, exit_code: Option<u32>) -> Self {
        Self {
            session_id: session_id.into(),
            status: "disconnected",
            exit_code,
            reason: None,
        }
    }

    pub fn failed(session_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            status: "disconnected",
            exit_code: None,
            reason: Some(reason.into()),
        }
    }
}

/// 推送事件。
///
/// 发送失败只记日志不上抛：调用方多在后台读取循环里，
/// 前端窗口已关闭属于正常情况，不该让整个会话因此中断。
pub fn emit_output(app: &AppHandle, payload: OutputEvent) {
    if let Err(err) = app.emit(EVENT_OUTPUT, payload) {
        log::warn!("推送终端输出失败：{err}");
    }
}

pub fn emit_status(app: &AppHandle, payload: StatusEvent) {
    if let Err(err) = app.emit(EVENT_STATUS, payload) {
        log::warn!("推送会话状态失败：{err}");
    }
}

pub fn emit_transfer(app: &AppHandle, payload: TransferEvent) {
    if let Err(err) = app.emit(EVENT_TRANSFER, payload) {
        log::warn!("推送文件传输状态失败：{err}");
    }
}
