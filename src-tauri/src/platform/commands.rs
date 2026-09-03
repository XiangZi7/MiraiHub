//! 平台能力的 Tauri 命令层。

use tauri::AppHandle;

use crate::error::AppResult;

use super::window;

/// 打开连接配置窗口。
///
/// `kind` 指定连接窗口类型（ssh / database），
/// 为空则用前端的默认值。
#[tauri::command]
pub async fn open_connection_window(app: AppHandle, kind: Option<String>) -> AppResult<()> {
    window::open_connection_window(&app, kind.as_deref())
}
