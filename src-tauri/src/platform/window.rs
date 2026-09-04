//! 平台相关的窗口处理。
//!
//! 主窗是无边框 + 透明的，各平台补齐原生观感的手段不同，
//! 集中放在这里，避免 `lib.rs` 里堆 `#[cfg]` 分支。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

#[cfg(windows)]
use tauri::window::{Effect, EffectsBuilder};

/// 连接配置窗口的 label。
const CONNECTION_WINDOW: &str = "connection";
/// 设置窗口的 label。
const SETTINGS_WINDOW: &str = "settings";

/// 启动画面的 label。
pub const SPLASH_WINDOW: &str = "splash";

/// Windows 11 的首个正式版 build。
#[cfg(windows)]
const WINDOWS_11_MIN_BUILD: u32 = 22_000;

/// 按 Windows 版本选择与系统匹配的窗口材质。
///
/// Windows 10 使用传统 Blur；Windows 11 及后续版本使用 Acrylic。
/// `windows-version` 通过 RtlGetVersion 读取真实 build，不受应用清单和兼容模式影响。
#[cfg(windows)]
fn windows_window_effect() -> Effect {
    let version = windows_version::OsVersion::current();
    window_effect_for_version(version.major, version.build)
}

#[cfg(windows)]
fn window_effect_for_version(major: u32, build: u32) -> Effect {
    if major > 10 || (major == 10 && build >= WINDOWS_11_MIN_BUILD) {
        Effect::Acrylic
    } else {
        Effect::Blur
    }
}

#[cfg(windows)]
fn windows_window_effects() -> tauri::utils::config::WindowEffectsConfig {
    EffectsBuilder::new()
        .effect(windows_window_effect())
        .build()
}

/// 给主窗口应用与 Rust 子窗口相同的原生材质。
#[cfg(windows)]
pub fn enable_window_material(window: &WebviewWindow) {
    if let Err(error) = window.set_effects(windows_window_effects()) {
        log::warn!("应用 Windows 窗口材质失败: {error}");
    }
}

/// 按用户设置切换窗口材质。
#[cfg(windows)]
pub fn set_window_material(window: &WebviewWindow, material: &str) -> AppResult<()> {
    let effects = match material {
        "solid" => None,
        "mica" => Some(EffectsBuilder::new().effect(Effect::Mica).build()),
        "acrylic" => Some(
            EffectsBuilder::new()
                .effect(windows_window_effect())
                .build(),
        ),
        other => {
            return Err(AppError::invalid_input(format!(
                "不支持的窗口材质：{other}"
            )))
        }
    };

    window.set_effects(effects).map_err(to_app_error)
}

/// 非 Windows 平台没有对应材质，保留命令为安全的空操作。
#[cfg(not(windows))]
pub fn set_window_material(_window: &WebviewWindow, _material: &str) -> AppResult<()> {
    Ok(())
}

/// 非 Windows 平台不应用 Windows 专属材质。
#[cfg(not(windows))]
pub fn enable_window_material(_window: &WebviewWindow) {}

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
///
/// `kind` 决定打开 SSH 配置还是数据库配置，作为 query 参数传给前端。
pub fn open_connection_window(
    app: &AppHandle,
    kind: Option<&str>,
    connection_id: Option<&str>,
) -> AppResult<()> {
    if let Some(dialog) = app.get_webview_window(CONNECTION_WINDOW) {
        dialog.show().map_err(to_app_error)?;
        dialog.set_focus().map_err(to_app_error)?;

        if let Some(main) = app.get_webview_window("main") {
            main.set_enabled(false).map_err(to_app_error)?;
        }

        return Ok(());
    }

    let main = app.get_webview_window("main");

    // kind 只允许固定值：它会拼进 URL，不校验的话
    // 前端传来的任意字符串都能注入 query 参数
    let kind = match kind {
        Some(kind @ ("ssh" | "local" | "database")) => kind,
        _ => "ssh",
    };
    let safe_connection_id = connection_id.filter(|id| {
        !id.is_empty()
            && id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
    });
    let url = match safe_connection_id {
        Some(id) => format!("index.html?window=connection&type={kind}&connectionId={id}"),
        None => format!("index.html?window=connection&type={kind}"),
    };

    let mut builder =
        WebviewWindowBuilder::new(app, CONNECTION_WINDOW, WebviewUrl::App(url.into()))
            .title("Add Connection")
            .inner_size(620.0, 640.0)
            .min_inner_size(620.0, 640.0)
            .max_inner_size(620.0, 640.0)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .decorations(false)
            // 原生材质需要窗口层和 WebView 都透明，内容区再用半透明 UI 分层保证可读性。
            .transparent(true)
            .background_color(tauri::webview::Color(0, 0, 0, 0))
            // 与主窗口一致：关闭 Tauri 自带阴影，构建后统一交给
            // enable_window_shadow() 用 DWM 绘制，避免无边框窗口出现亮色描边。
            .shadow(false)
            .skip_taskbar(true)
            .center();

    if let Some(parent) = main.as_ref() {
        builder = builder.parent(parent).map_err(to_app_error)?;
    }

    #[cfg(windows)]
    {
        builder = builder.effects(windows_window_effects());
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

/// 打开原生设置窗口。
///
/// 与连接配置窗口一样，它是独立的 WebviewWindow，而不是主页面里的 HTML 遮罩。
/// 固定尺寸和原生父子关系让它保持设置对话框的行为：显示时禁用主窗，关闭后恢复。
pub fn open_settings_window(app: &AppHandle) -> AppResult<()> {
    if let Some(dialog) = app.get_webview_window(SETTINGS_WINDOW) {
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
        SETTINGS_WINDOW,
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("设置")
    .inner_size(620.0, 480.0)
    .min_inner_size(620.0, 480.0)
    .max_inner_size(620.0, 480.0)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .decorations(false)
    // 与主窗口一致：透明 WebView 透出 Windows Blur / Acrylic。
    .transparent(true)
    .background_color(tauri::webview::Color(0, 0, 0, 0))
    .shadow(false)
    .skip_taskbar(true)
    .center();

    if let Some(parent) = main.as_ref() {
        builder = builder.parent(parent).map_err(to_app_error)?;
    }

    #[cfg(windows)]
    {
        builder = builder.effects(windows_window_effects());
    }

    let dialog = builder.build().map_err(to_app_error)?;
    enable_window_shadow(&dialog);

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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_10_uses_blur() {
        assert_eq!(window_effect_for_version(10, 19_045), Effect::Blur);
    }

    #[test]
    fn windows_11_uses_acrylic() {
        assert_eq!(
            window_effect_for_version(10, WINDOWS_11_MIN_BUILD),
            Effect::Acrylic
        );
        assert_eq!(window_effect_for_version(11, 0), Effect::Acrylic);
    }
}
