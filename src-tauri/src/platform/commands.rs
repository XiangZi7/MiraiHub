//! 平台能力的 Tauri 命令层。

use tauri::AppHandle;

use crate::error::AppResult;

use super::window;

/// 打开连接配置窗口。
#[tauri::command]
pub async fn open_connection_window(app: AppHandle) -> AppResult<()> {
    window::open_connection_window(&app)
}
