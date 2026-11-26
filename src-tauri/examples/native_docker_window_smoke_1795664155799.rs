use miraihub_lib::{ipc, platform::commands::WindowPreferences, ssh::SessionManager};

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.admin.miraihub.smoke.docker.logs".into();
    let address = std::env::var("MIRAIHUB_SMOKE_UI").unwrap();
    assert!(address.starts_with("http://127.0.0.1:"));
    context.config_mut().build.dev_url = Some(address.parse().unwrap());
    context.config_mut().app.windows.retain(|window| window.label == "main");
    tauri::Builder::default()
        .manage(miraihub_lib::docker::follow::LogWindows::default())
        .manage(SessionManager::new())
        .manage(WindowPreferences::default())
        .invoke_handler(ipc::handler())
        .run(context)
        .expect("Docker log window smoke test");
}
