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

use crate::{agent, db, ipc, local_terminal, platform, redis_db, ssh};

/// 组装并启动应用。
pub fn run() {
    let mut context = tauri::generate_context!();
    configure_environment(context.config_mut(), cfg!(dev));
    let builder = Builder::default();
    let builder = register_plugins(builder);
    let builder = register_state(builder);

    builder
        .setup(setup)
        .invoke_handler(ipc::handler())
        .build(context)
        .expect("构建 Tauri 应用失败")
        .run(on_run_event);
}

/// 开发模式使用独立的应用标识和窗口标题，单实例插件按环境分别复用窗口。
/// 采用 Tauri 的 dev 标记，确保 tauri dev --release 也属于开发环境。
fn configure_environment(config: &mut tauri::Config, development: bool) {
    if !development {
        return;
    }
    config.identifier.push_str(".dev");
    for window in &mut config.app.windows {
        window.title.push_str(" (Dev)");
    }
}

/// 注册插件。
fn register_plugins(builder: Builder<Wry>) -> Builder<Wry> {
    // 单例插件最先注册，避免重复启动时初始化其他插件。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_main_window(app);
    }));

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let builder = {
        let startup = tauri_plugin_autostart::Builder::new().app_name(if cfg!(dev) {
            "MiraiHub Dev"
        } else {
            "MiraiHub"
        });
        #[cfg(target_os = "macos")]
        let startup = startup.macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
        builder.plugin(startup.build())
    };

    builder
        // 系统原生文件选择器：SSH 私钥输入框通过它选择一个或多个密钥文件。
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        .manage(agent::AgentManager::default())
        .manage(agent::mcp::Pool::default())
        .manage(ssh::editor::EditorManager::default())
        .manage(platform::remote_editor::RemoteEditorWindows::default())
        .manage(platform::column_tags::ColumnTagsWindow::default())
        .manage(ssh::tunnels::TunnelManager::default())
        .manage(ssh::batch::BatchManager::default())
        .manage(ssh::SessionManager::new())
        .manage(ssh::TransferManager::new())
        .manage(db::DatabaseManager::new())
        .manage(redis_db::RedisManager::default())
        .manage(local_terminal::LocalTerminalManager::new())
        .manage(platform::commands::WindowPreferences::default())
}

/// 启动后的一次性初始化。
fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;

    // 材质就绪后再显示启动窗，避免先闪出不透明底色。
    if let Some(splash) = app.get_webview_window(platform::window::SPLASH_WINDOW) {
        platform::window::enable_splash_material(&splash);
        platform::window::enable_window_shadow(&splash);
        splash.show()?;
    }

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

    let chinese = crate::platform::locale::get_system_locale().starts_with("zh");
    let tray_menu = MenuBuilder::new(app)
        .text(
            "show",
            if chinese {
                "打开 MiraiHub"
            } else {
                "Open MiraiHub"
            },
        )
        .separator()
        .text("quit", if chinese { "退出" } else { "Quit" })
        .build()?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(if cfg!(dev) {
            "MiraiHub (Dev)"
        } else {
            "MiraiHub"
        })
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "show" {
                show_main_window(app);
            } else if event.id().as_ref() == "quit" {
                app.exit(0);
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

/// 托盘打开或重复启动时，恢复并聚焦已有主窗口。
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

    // macOS 点击 Dock 图标时重新显示已隐藏的主窗口。
    #[cfg(target_os = "macos")]
    if matches!(event, RunEvent::Reopen { .. }) {
        show_main_window(app);
    }

    // Native editor drafts outlive the main webview. Tray quit must also respect them.
    if let RunEvent::ExitRequested { ref api, .. } = event {
        if let Some(label) = app
            .state::<platform::remote_editor::RemoteEditorWindows>()
            .needs_attention()
        {
            api.prevent_exit();
            if let Some(editor) = app.get_webview_window(&label) {
                let _ = editor.show();
                let _ = editor.unminimize();
                let _ = editor.set_focus();
                let _ = platform::remote_editor::request_close(&editor);
            }
            return;
        }
    }
    // 退出前给每条连接发一个正常的 disconnect，
    // 否则远端要等 TCP 超时才回收 session
    if let RunEvent::Exit = event {
        let tunnels = app.state::<ssh::tunnels::TunnelManager>();
        let batches = app.state::<ssh::batch::BatchManager>();
        let transfers = app.state::<ssh::TransferManager>();
        let sessions = app.state::<ssh::SessionManager>();
        let databases = app.state::<db::DatabaseManager>();
        let redis = app.state::<redis_db::RedisManager>();
        tauri::async_runtime::block_on(async {
            // 隧道、批量任务和传输都跑在 SSH 会话上，先收尾它们再断会话；
            // 数据库与 Redis 互不相关，和第一批一起并行关闭。
            tokio::join!(
                bounded_shutdown("隧道", tunnels.shutdown()),
                bounded_shutdown("批量任务", batches.shutdown()),
                bounded_shutdown("文件传输", transfers.cancel_all()),
                bounded_shutdown("数据库连接", databases.shutdown()),
                bounded_shutdown("Redis 连接", redis.shutdown()),
            );
            bounded_shutdown("SSH 会话", sessions.shutdown()).await;
        });
        app.state::<local_terminal::LocalTerminalManager>()
            .shutdown();
    }
}

/// 退出时每项清理的最长等待。
///
/// sqlx 关闭连接池要等借出的连接归还，长查询还在跑时会一直挂着；
/// 网络已断的 SSH 也可能卡在 disconnect。超时就放弃，进程退出后系统会回收。
const SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

async fn bounded_shutdown(name: &str, task: impl std::future::Future<Output = ()>) {
    if tokio::time::timeout(SHUTDOWN_TIMEOUT, task).await.is_err() {
        log::warn!("退出时关闭{name}超时，已跳过");
    }
}

#[cfg(test)]
mod tests {
    use super::configure_environment;
    use tauri::{
        test::{mock_builder, mock_context, noop_assets},
        Manager,
    };

    /// 验证正式版配置不变，开发版在真实路径解析中使用独立的应用身份。
    #[test]
    fn development_and_production_have_independent_app_identities() {
        let original: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut production = mock_context(noop_assets());
        *production.config_mut() = original.clone();
        configure_environment(production.config_mut(), false);
        assert_eq!(
            serde_json::to_value(production.config()).unwrap(),
            serde_json::to_value(&original).unwrap()
        );

        let mut development = mock_context(noop_assets());
        *development.config_mut() = original.clone();
        configure_environment(development.config_mut(), true);
        assert_ne!(
            development.config().identifier,
            production.config().identifier
        );
        assert!(development
            .config()
            .app
            .windows
            .iter()
            .all(|window| window.title.ends_with(" (Dev)")));

        let development = mock_builder().build(development).unwrap();
        let production = mock_builder().build(production).unwrap();
        assert_ne!(
            development.path().app_data_dir().unwrap(),
            production.path().app_data_dir().unwrap()
        );
    }
}
