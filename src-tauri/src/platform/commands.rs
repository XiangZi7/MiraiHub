//! 平台能力的 Tauri 命令层。

use std::{
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use tauri::{AppHandle, Manager};

use crate::error::AppResult;

use super::window;

/// 会被窗口事件处理器读取的运行时偏好。
#[derive(Clone, Default)]
pub struct WindowPreferences {
    minimize_to_tray: Arc<AtomicBool>,
}

impl WindowPreferences {
    pub fn minimize_to_tray(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.minimize_to_tray)
    }
}

/// 打开连接配置窗口。
///
/// `kind` 指定连接窗口类型（ssh / local / database），
/// 为空则用前端的默认值。
#[tauri::command]
pub async fn open_connection_window(
    app: AppHandle,
    kind: Option<String>,
    connection_id: Option<String>,
) -> AppResult<()> {
    window::open_connection_window(&app, kind.as_deref(), connection_id.as_deref())
}

/// 打开原生设置子窗口。
#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> AppResult<()> {
    window::open_settings_window(&app)
}

/// 首屏挂载完成后再显示主窗口，避免初始化期间闪出未渲染页面。
#[tauri::command]
pub async fn app_ready(app: AppHandle) -> AppResult<()> {
    if let Some(main) = app.get_webview_window("main") {
        main.show()
            .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
        main.set_focus()
            .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
    }

    if let Some(splash) = app.get_webview_window(window::SPLASH_WINDOW) {
        splash
            .close()
            .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
    }

    Ok(())
}

/// 切换所有业务窗口的原生材质（启动画面始终保持纯色）。
#[tauri::command]
pub async fn set_window_material(app: AppHandle, material: String) -> AppResult<()> {
    for (label, webview) in app.webview_windows() {
        if label != window::SPLASH_WINDOW {
            window::set_window_material(&webview, &material)?;
        }
    }
    Ok(())
}

/// 显示或隐藏系统托盘图标。
#[tauri::command]
pub async fn set_tray_visible(app: AppHandle, visible: bool) -> AppResult<()> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| crate::error::AppError::not_found("系统托盘尚未初始化"))?;
    tray.set_visible(visible)
        .map_err(|error| crate::error::AppError::internal(error.to_string()))
}

/// 设置关闭主窗口时是否隐藏到托盘。
#[tauri::command]
pub async fn set_minimize_to_tray(
    preferences: tauri::State<'_, WindowPreferences>,
    enabled: bool,
) -> AppResult<()> {
    preferences
        .minimize_to_tray
        .store(enabled, Ordering::Relaxed);
    Ok(())
}

#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_VALUE: &str = "MiraiHub";

/// 写入或移除当前用户的 Windows 开机启动项。
#[tauri::command]
pub async fn set_launch_at_startup(enabled: bool) -> AppResult<()> {
    #[cfg(windows)]
    {
        let status = if enabled {
            let executable = std::env::current_exe()?;
            let value = format!("\"{}\"", executable.display());
            Command::new("reg")
                .args([
                    "ADD", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &value, "/f",
                ])
                .status()?
        } else {
            let exists = Command::new("reg")
                .args(["QUERY", RUN_KEY, "/v", RUN_VALUE])
                .status()?
                .success();
            if !exists {
                return Ok(());
            }
            Command::new("reg")
                .args(["DELETE", RUN_KEY, "/v", RUN_VALUE, "/f"])
                .status()?
        };

        if !status.success() {
            return Err(crate::error::AppError::internal("更新开机启动项失败"));
        }
    }

    #[cfg(not(windows))]
    let _ = enabled;

    Ok(())
}

/// 查询当前用户是否已登记开机启动。
#[tauri::command]
pub async fn launch_at_startup_enabled() -> AppResult<bool> {
    #[cfg(windows)]
    {
        return Ok(Command::new("reg")
            .args(["QUERY", RUN_KEY, "/v", RUN_VALUE])
            .status()?
            .success());
    }

    #[cfg(not(windows))]
    Ok(false)
}
