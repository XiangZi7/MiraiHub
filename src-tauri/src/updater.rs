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

#[cfg(test)]
mod tests {
    /// Opt-in network smoke test: use the same HTTP stack and release parser as
    /// the updater. This checks availability only; it never runs an installer.
    #[tokio::test]
    #[ignore = "requires access to GitHub Releases"]
    async fn published_update_manifest_is_accessible() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let endpoint = config["plugins"]["updater"]["endpoints"][0]
            .as_str()
            .unwrap();
        let client = reqwest::Client::builder()
            .user_agent("tauri-plugin-updater/2.10.1")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap();
        let release = client
            .get(endpoint)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .expect("update manifest request")
            .error_for_status()
            .expect("update manifest HTTP status")
            .json::<tauri_plugin_updater::RemoteRelease>()
            .await
            .expect("Tauri-compatible release manifest");
        let installer = release.download_url("windows-x86_64").unwrap();
        assert!(!release.signature("windows-x86_64").unwrap().is_empty());
        assert_eq!(installer.scheme(), "https");
        client
            .head(installer.clone())
            .send()
            .await
            .expect("installer availability request")
            .error_for_status()
            .expect("installer HTTP status");
    }
}
