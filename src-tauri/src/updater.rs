//! Native update preflight. Only the main window may drive the installer.
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    supported: bool,
    reason: &'static str,
}

#[tauri::command]
pub fn updater_environment() -> Environment {
    let reason = if cfg!(debug_assertions) {
        "development"
    } else if !cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "platform"
    } else if !std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file()))
        .unwrap_or(false)
    {
        // A portable archive must never silently become an installed copy.
        "portable"
    } else {
        ""
    };
    Environment {
        supported: reason.is_empty(),
        reason,
    }
}

#[tauri::command]
pub fn updater_can_install(app: AppHandle, window: WebviewWindow) -> bool {
    if window.label() != "main" || !updater_environment().supported {
        return false;
    }
    if app
        .state::<crate::platform::remote_editor::RemoteEditorWindows>()
        .needs_attention()
        .is_some()
    {
        return false;
    }
    // Settings and connection dialogs can hold unsaved drafts. Hidden reusable
    // windows are harmless; an editor still loading also blocks installation.
    app.webview_windows()
        .iter()
        .all(|(label, window)| label == "main" || !window.is_visible().unwrap_or(true))
}
