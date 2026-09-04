//! 应用装配：插件、托管状态、生命周期钩子。
//!
//! 每一块都是独立的小函数，新增模块时在对应的函数里加一行即可，
//! 不必读懂整条 builder 链。命令清单在 `crate::ipc`。

use std::sync::atomic::Ordering;

use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Builder, RunEvent, Wry,
};

use crate::{db, ipc, local_terminal, platform, ssh};

/// 组装并启动应用。
pub fn run() {
    let builder = Builder::default();
    let builder = register_plugins(builder);
    let builder = register_state(builder);

    builder
        .setup(setup)
        .invoke_handler(ipc::handler())
        .build(tauri::generate_context!())
        .expect("构建 Tauri 应用失败")
        .run(on_run_event);
}

/// 注册插件。
fn register_plugins(builder: Builder<Wry>) -> Builder<Wry> {
    builder
        // 系统原生文件选择器：SSH 私钥输入框通过它选择一个或多个密钥文件。
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // debug 构建输出到 stdout 与 webview 控制台，release 只写文件
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
}

/// 注册跨命令共享的托管状态。
///
/// 每个业务模块一个容器：SSH 有会话表，数据库有连接池。
fn register_state(builder: Builder<Wry>) -> Builder<Wry> {
    builder
        .manage(ssh::SessionManager::new())
        .manage(ssh::TransferManager::new())
        .manage(db::DatabaseManager::new())
        .manage(local_terminal::LocalTerminalManager::new())
        .manage(platform::commands::WindowPreferences::default())
}

/// 启动后的一次性初始化。
fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;

    if let Some(main) = app.get_webview_window("main") {
        platform::window::enable_window_material(&main);
        platform::window::enable_window_shadow(&main);

        let minimize_to_tray = app
            .state::<platform::commands::WindowPreferences>()
            .minimize_to_tray();
        let main_for_close = main.clone();
        main.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if minimize_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = main_for_close.hide();
                }
            }
        });
    }

    let tray_menu = MenuBuilder::new(app)
        .text("show", "打开 MiraiHub")
        .separator()
        .quit()
        .build()?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("MiraiHub")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "show" {
                show_main_window(app);
            }
        })
        .on_tray_icon_event(|tray, event| {
            let should_show = matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            );
            if should_show {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    Ok(())
}

fn show_main_window(app: &AppHandle) {
    use tauri::Manager;

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

/// 应用级事件。
fn on_run_event(app: &AppHandle, event: RunEvent) {
    use tauri::Manager;

    // 退出前给每条连接发一个正常的 disconnect，
    // 否则远端要等 TCP 超时才回收 session
    if let RunEvent::Exit = event {
        let transfers = app.state::<ssh::TransferManager>();
        tauri::async_runtime::block_on(transfers.cancel_all());
        let manager = app.state::<ssh::SessionManager>();
        tauri::async_runtime::block_on(manager.shutdown());
        let databases = app.state::<db::DatabaseManager>();
        tauri::async_runtime::block_on(databases.shutdown());
        let local_terminals = app.state::<local_terminal::LocalTerminalManager>();
        local_terminals.shutdown();
    }
}
