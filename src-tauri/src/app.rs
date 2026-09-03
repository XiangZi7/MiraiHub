//! 应用装配：插件、托管状态、生命周期钩子。
//!
//! 每一块都是独立的小函数，新增模块时在对应的函数里加一行即可，
//! 不必读懂整条 builder 链。命令清单在 `crate::ipc`。

use tauri::{App, AppHandle, Builder, RunEvent, Wry};

use crate::{ipc, platform, ssh};

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
/// 每个业务模块一个容器：SSH 有会话表，数据库模块以后会加连接池。
fn register_state(builder: Builder<Wry>) -> Builder<Wry> {
    builder.manage(ssh::SessionManager::new())
}

/// 启动后的一次性初始化。
fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;

    if let Some(main) = app.get_webview_window("main") {
        platform::window::enable_window_shadow(&main);
    }

    Ok(())
}

/// 应用级事件。
fn on_run_event(app: &AppHandle, event: RunEvent) {
    use tauri::Manager;

    // 退出前给每条连接发一个正常的 disconnect，
    // 否则远端要等 TCP 超时才回收 session
    if let RunEvent::Exit = event {
        let manager = app.state::<ssh::SessionManager>();
        tauri::async_runtime::block_on(manager.shutdown());
    }
}
