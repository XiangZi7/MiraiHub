//! SSH 会话推送到前端的事件。
//!
//! 会话状态与传输进度用 Tauri 事件往前端推；
//! 终端输出量大，走 shell 打开时传入的 Channel（见 session::pump_output）。
//!
//! 事件名带 `ssh://` 前缀做命名空间，避免和后续数据库模块的事件撞名。

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// 渲染终端、订阅会话状态和传输进度的窗口 label。
/// 传输进度每 40ms 一条，其他窗口用不到，不必逐条接收。
pub const TERMINAL_WINDOW: &str = "main";
/// 会话状态变化（连上、断开）。
pub const EVENT_STATUS: &str = "ssh://status";
/// 文件传输进度与状态变化。
pub const EVENT_TRANSFER: &str = "ssh://transfer";

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processed_rows: Option<u64>,
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
            processed_rows: None,
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
            processed_rows: None,
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
pub fn emit_status(app: &AppHandle, payload: StatusEvent) {
    if let Err(err) = app.emit_to(TERMINAL_WINDOW, EVENT_STATUS, payload) {
        log::warn!("推送会话状态失败：{err}");
    }
}

pub fn emit_transfer<R: tauri::Runtime>(app: &AppHandle<R>, payload: TransferEvent) {
    if let Err(err) = app.emit_to(TERMINAL_WINDOW, EVENT_TRANSFER, payload) {
        log::warn!("推送文件传输状态失败：{err}");
    }
}
