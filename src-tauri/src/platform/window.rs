//! 平台相关的窗口处理。
//!
//! 主窗是无边框 + 透明的，各平台补齐原生观感的手段不同，
//! 集中放在这里，避免 `lib.rs` 里堆 `#[cfg]` 分支。

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
pub(super) fn windows_window_effects() -> tauri::utils::config::WindowEffectsConfig {
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

/// 启动页独立使用桌面 Blur，不受尚未加载的用户设置影响。
pub fn enable_splash_material(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        let effects = EffectsBuilder::new()
            .effect(Effect::Blur)
            .color(tauri::webview::Color(20, 18, 30, 80))
            .build();
        if let Err(error) = window.set_effects(effects) {
            log::warn!("启用启动页 Blur 失败，使用深色背景: {error}");
            let _ = window.set_background_color(Some(tauri::webview::Color(23, 22, 31, 255)));
        }
    }
    #[cfg(not(windows))]
    let _ = window.set_background_color(Some(tauri::webview::Color(23, 22, 31, 255)));
}

/// 按用户设置切换窗口材质。
///
/// `light` 来自前端实际生效的明暗（含皮肤自带的配色），不是设置项原值。
/// Mica 有独立的明暗变体；Acrylic / Blur 则靠 tint 色 —— 不给 tint 时系统默认偏深，
/// 浅色界面下会从边缘透出一圈灰。深色保持不传 color，维持现有观感。
#[cfg(windows)]
pub fn set_window_material(window: &WebviewWindow, material: &str, light: bool) -> AppResult<()> {
    let effects = match material {
        "solid" => None,
        "mica" => Some(
            EffectsBuilder::new()
                .effect(if light {
                    Effect::MicaLight
                } else {
                    Effect::MicaDark
                })
                .build(),
        ),
        "acrylic" => {
            let mut builder = EffectsBuilder::new().effect(windows_window_effect());
            if light {
                builder = builder.color(tauri::webview::Color(252, 250, 254, 120));
            }
            Some(builder.build())
        }
        other => {
            return Err(AppError::invalid_input(format!(
                "不支持的窗口材质：{other}"
            )))
        }
    };

    // WebView2 的默认滚动条与原生控件跟着窗口主题走，CSS 的 color-scheme 管不到。
    let _ = window.set_theme(Some(if light {
        tauri::Theme::Light
    } else {
        tauri::Theme::Dark
    }));
    window.set_effects(effects).map_err(to_app_error)
}

/// macOS 同步窗口主题，Linux 使用不透明背景以兼容 WebKitGTK 与不同窗口管理器。
#[cfg(not(windows))]
pub fn set_window_material(window: &WebviewWindow, _material: &str, light: bool) -> AppResult<()> {
    #[cfg(target_os = "linux")]
    window
        .set_background_color(Some(if light {
            tauri::webview::Color(252, 250, 254, 255)
        } else {
            tauri::webview::Color(23, 22, 31, 255)
        }))
        .map_err(to_app_error)?;
    let _ = window.set_theme(Some(if light {
        tauri::Theme::Light
    } else {
        tauri::Theme::Dark
    }));
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

/// macOS 恢复原生窗口阴影；Linux 不支持的窗口管理器会忽略此设置。
#[cfg(not(windows))]
pub fn enable_window_shadow(window: &WebviewWindow) {
    let _ = window.set_shadow(true);
}

/// 打开连接配置窗口。
///
/// 由 Rust 创建而不是页面内做遮罩层，是为了拿到真正的原生子窗口：
/// 它有独立的窗口阴影与任务栏行为，且能通过禁用父窗实现原生模态。
/// 同一时间只保留一个实例，重复触发把已有窗口带到前台。
///
/// `kind` 决定打开哪种连接配置，作为 query 参数传给前端。
/// `group` 是新建时预选的分组名，从分组右键菜单进来时带上。
pub fn open_connection_window(
    app: &AppHandle,
    kind: Option<&str>,
    connection_id: Option<&str>,
    group: Option<&str>,
) -> AppResult<()> {
    if let Some(dialog) = app.get_webview_window(CONNECTION_WINDOW) {
        if dialog.is_visible().map_err(to_app_error)? {
            dialog.set_focus().map_err(to_app_error)?;
        }
        return Ok(());
    }

    let main = app.get_webview_window("main");

    // kind 只允许固定值：它会拼进 URL，不校验的话
    // 前端传来的任意字符串都能注入 query 参数
    let kind = match kind {
        Some(kind @ ("local" | "database" | "rdp")) => kind,
        _ => "ssh",
    };
    let height = if kind == "rdp" { 560.0 } else { 640.0 };
    let safe_connection_id = connection_id.filter(|id| {
        !id.is_empty()
            && id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
    });
    let url = match safe_connection_id {
        Some(id) => format!("index.html?window=connection&type={kind}&connectionId={id}"),
        None => {
            // 编辑已有连接时不预选分组：归属以存档为准。
            let group = group
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(percent_encode_component)
                .unwrap_or_default();
            match group.is_empty() {
                true => format!("index.html?window=connection&type={kind}"),
                false => format!("index.html?window=connection&type={kind}&group={group}"),
            }
        }
    };

    let mut builder =
        WebviewWindowBuilder::new(app, CONNECTION_WINDOW, WebviewUrl::App(url.into()))
            .title("Add Connection")
            .inner_size(620.0, height)
            .min_inner_size(620.0, height)
            .max_inner_size(620.0, height)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .decorations(false)
            // 原生材质需要窗口层和 WebView 都透明，内容区再用半透明 UI 分层保证可读性。
            .transparent(!cfg!(target_os = "linux"))
            .background_color(tauri::webview::Color(0, 0, 0, 0))
            // 与主窗口一致：关闭 Tauri 自带阴影，构建后统一交给
            // enable_window_shadow() 用 DWM 绘制，避免无边框窗口出现亮色描边。
            .shadow(!cfg!(windows))
            .skip_taskbar(true)
            .visible(false)
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

    install_modal_close_handler(&dialog, false);

    Ok(())
}

/// 打开原生设置窗口。
///
/// 与连接配置窗口一样，它是独立的 WebviewWindow，而不是主页面里的 HTML 遮罩。
/// 固定尺寸和原生父子关系让它保持设置对话框的行为：显示时禁用主窗，关闭后恢复。
pub fn open_settings_window(app: &AppHandle) -> AppResult<()> {
    if let Some(dialog) = app.get_webview_window(SETTINGS_WINDOW) {
        if dialog.is_visible().map_err(to_app_error)? {
            dialog.set_focus().map_err(to_app_error)?;
        } else {
            // The existing WebView resets drafts and acknowledges with window_ready.
            dialog.emit("settings-reopen", ()).map_err(to_app_error)?;
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
    .inner_size(1000.0, 760.0)
    .min_inner_size(740.0, 560.0)
    .resizable(true)
    .minimizable(false)
    .maximizable(true)
    .decorations(false)
    // 与主窗口一致：透明 WebView 透出 Windows Blur / Acrylic。
    .transparent(!cfg!(target_os = "linux"))
    .background_color(tauri::webview::Color(0, 0, 0, 0))
    .shadow(!cfg!(windows))
    .skip_taskbar(true)
    .visible(false)
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
    install_modal_close_handler(&dialog, true);

    if let Some(parent) = main.as_ref() {
        // A cached, hidden settings WebView must not keep the application alive.
        let cached_dialog = dialog.clone();
        parent.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = cached_dialog.destroy();
            }
        });
    }
    Ok(())
}

/// 模态窗口离场前恢复主窗口交互，避免 Windows 把焦点交给其他应用后再抢回来。
pub(super) fn install_modal_close_handler(window: &WebviewWindow, keep_settings: bool) {
    let dialog = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } if cfg!(windows) || keep_settings => {
            api.prevent_close();
            restore_modal_owner(&dialog, false);
            let hidden = dialog.hide().is_ok();
            if keep_settings && hidden {
                let _ = dialog.emit("settings-hidden", ());
                if !cfg!(windows) {
                    restore_modal_owner(&dialog, true);
                }
            } else {
                let _ = dialog.destroy();
            }
        }
        tauri::WindowEvent::Destroyed => restore_modal_owner(&dialog, true),
        _ => {}
    });
}

/// 还有其他可见模态窗时保持主窗口禁用，异常销毁时补回交互和焦点。
fn restore_modal_owner(dialog: &WebviewWindow, recover_focus: bool) {
    let app = dialog.app_handle();
    if [
        SETTINGS_WINDOW,
        CONNECTION_WINDOW,
        super::column_tags::WINDOW,
    ]
    .into_iter()
    .filter(|label| *label != dialog.label())
    .filter_map(|label| app.get_webview_window(label))
    .any(|window| window.is_visible().unwrap_or(false))
    {
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let was_disabled = !main.is_enabled().unwrap_or(false);
        let _ = main.set_enabled(true);
        if recover_focus && (was_disabled || !cfg!(windows)) && main.is_visible().unwrap_or(false) {
            let _ = main.set_focus();
        }
    }
}

pub fn show_child_window(window: &WebviewWindow) -> AppResult<()> {
    window.show().map_err(to_app_error)?;
    window.set_focus().map_err(to_app_error)?;
    if matches!(
        window.label(),
        SETTINGS_WINDOW | CONNECTION_WINDOW | super::column_tags::WINDOW
    ) {
        if let Some(main) = window.app_handle().get_webview_window("main") {
            main.set_enabled(false).map_err(to_app_error)?;
        }
    }
    Ok(())
}

pub(super) fn to_app_error(err: tauri::Error) -> AppError {
    AppError::internal(err.to_string())
}

/// 按 RFC 3986 的 unreserved 集合做百分号编码。
///
/// 分组名是用户自己起的：中文、空格、`&`、`#` 都可能出现，
/// 原样拼进 query 轻则把名字截断，重则多塞出一个参数。
/// 只保留 `A-Z a-z 0-9 - _ . ~`，其余一律按 UTF-8 字节转义 ——
/// 与前端 `encodeURIComponent` 的行为一致。
fn percent_encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());

    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }

    out
}

#[cfg(test)]
mod encode_tests {
    use super::percent_encode_component;

    #[test]
    fn keeps_unreserved_characters() {
        assert_eq!(percent_encode_component("prod-db_1.a~b"), "prod-db_1.a~b");
    }

    #[test]
    fn escapes_separators_and_non_ascii() {
        assert_eq!(percent_encode_component("a&b=c#d"), "a%26b%3Dc%23d");
        assert_eq!(percent_encode_component("a b"), "a%20b");
        assert_eq!(percent_encode_component("玄武"), "%E7%8E%84%E6%AD%A6");
    }
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
