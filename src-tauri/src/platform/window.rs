//! 平台相关的窗口处理。
//!
//! 主窗是无边框 + 透明的，各平台补齐原生观感的手段不同，
//! 集中放在这里，避免 `lib.rs` 里堆 `#[cfg]` 分支。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

/// 连接配置窗口的 label。
const CONNECTION_WINDOW: &str = "connection";

/// 给无边框窗口补上 DWM 原生阴影。
///
/// Windows 的无边框窗口默认没有投影，看起来像一张贴在桌面上的纸。
/// DwmExtendFrameIntoClientArea 把边框区域向客户区扩一点，
/// 足以让 DWM 判定该窗口需要系统阴影。
#[cfg(windows)]
pub fn enable_window_shadow(window: &WebviewWindow) {
    use windows::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea;
    use windows::Win32::UI::Controls::MARGINS;

    let Ok(hwnd) = window.hwnd() else {
        log::warn!("拿不到窗口句柄，跳过原生阴影");
        return;
    };

    // 四边各扩 1px：足以触发系统阴影，又几乎不占客户区
    let margins = MARGINS {
        cxLeftWidth: 1,
        cxRightWidth: 1,
        cyTopHeight: 1,
        cyBottomHeight: 1,
    };

    unsafe {
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
    }
}

/// 非 Windows 平台：系统自带无边框窗口阴影，无需处理。
#[cfg(not(windows))]
pub fn enable_window_shadow(_window: &WebviewWindow) {}

/// 打开连接配置窗口。
///
/// 由 Rust 创建而不是页面内做遮罩层，是为了拿到真正的原生子窗口：
/// 它有独立的窗口阴影与任务栏行为，且能通过禁用父窗实现原生模态。
/// 同一时间只保留一个实例，重复触发把已有窗口带到前台。
pub fn open_connection_window(app: &AppHandle) -> AppResult<()> {
    if let Some(dialog) = app.get_webview_window(CONNECTION_WINDOW) {
        dialog.show().map_err(to_app_error)?;
        dialog.set_focus().map_err(to_app_error)?;

        if let Some(main) = app.get_webview_window("main") {
            main.set_enabled(false).map_err(to_app_error)?;
        }

        return Ok(());
    }

    let main = app.get_webview_window("main");

    let mut builder = WebviewWindowBuilder::new(
        app,
        CONNECTION_WINDOW,
        WebviewUrl::App("index.html?window=connection".into()),
    )
    .title("Add Connection")
    .inner_size(620.0, 640.0)
    .min_inner_size(620.0, 640.0)
    .max_inner_size(620.0, 640.0)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .skip_taskbar(true)
    .center();

    if let Some(parent) = main.as_ref() {
        builder = builder.parent(parent).map_err(to_app_error)?;
    }

    #[cfg(windows)]
    {
        use tauri::window::{Effect, EffectState, EffectsBuilder};

        builder = builder.effects(
            EffectsBuilder::new()
                .effect(Effect::Acrylic)
                .state(EffectState::Active)
                .radius(14.0)
                .build(),
        );
    }

    let dialog = builder.build().map_err(to_app_error)?;

    enable_window_shadow(&dialog);

    // 先注册销毁监听，再禁用父窗：
    // 顺序反过来的话，若构建后到监听注册前窗口被关掉，主窗会永久卡在禁用态
    if let Some(parent) = main.as_ref() {
        let parent_on_destroy = parent.clone();
        dialog.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = parent_on_destroy.set_enabled(true);
                let _ = parent_on_destroy.set_focus();
            }
        });
    }

    dialog.set_focus().map_err(to_app_error)?;

    if let Some(parent) = main {
        parent.set_enabled(false).map_err(to_app_error)?;
    }

    Ok(())
}

fn to_app_error(err: tauri::Error) -> AppError {
    AppError::internal(err.to_string())
}
