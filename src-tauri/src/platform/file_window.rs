//! SSH 远端文件与 Docker 日志共用的非模态文件窗口。
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::window::{enable_window_shadow, to_app_error};
use crate::error::AppResult;

/// 加载中的窗口由首次 window_ready 显示，已显示的窗口恢复并聚焦。
pub(super) fn focus_existing(app: &AppHandle, label: &str) -> AppResult<bool> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(false);
    };
    if window.is_visible().map_err(to_app_error)? {
        window.unminimize().map_err(to_app_error)?;
        window.set_focus().map_err(to_app_error)?;
    }
    Ok(true)
}

/// 新窗口沿用远端文件编辑器的尺寸和透明标题栏，材质由 window_ready 按用户设置应用。
pub(super) fn create(
    app: &AppHandle,
    label: &str,
    url: &str,
    title: &str,
    owner: Option<&WebviewWindow>,
) -> AppResult<WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(1040.0, 720.0)
        .min_inner_size(640.0, 420.0)
        .decorations(false)
        .resizable(true)
        .minimizable(true)
        .maximizable(true)
        .transparent(!cfg!(target_os = "linux"))
        .background_color(tauri::webview::Color(0, 0, 0, 0))
        .theme(Some(tauri::Theme::Dark))
        .shadow(!cfg!(windows))
        .visible(false)
        .center();
    if let Some(owner) = owner {
        builder = builder.parent(owner).map_err(to_app_error)?;
    }
    let window = builder.build().map_err(to_app_error)?;
    enable_window_shadow(&window);
    Ok(window)
}
