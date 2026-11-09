//! Native update preflight. Only the main window may drive the installer.
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_updater::UpdaterExt;

const MANIFEST_URL: &str =
    "https://github.com/XiangZi7/MiraiHub/releases/latest/download/latest.json";

/// 将清单与安装包统一交给 HTTPS 转发源，限制为本项目的公开 Release 文件。
fn forwarded_url(prefix: &str, original: &str) -> Result<tauri::Url, String> {
    let target = tauri::Url::parse(original).map_err(|error| error.to_string())?;
    if prefix.is_empty() {
        return Ok(target);
    }
    let base =
        tauri::Url::parse(prefix).map_err(|_| "下载加速地址必须是有效的 HTTPS 地址".to_owned())?;
    if base.scheme() != "https"
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("下载加速地址必须是无凭据、查询参数和片段的 HTTPS 地址".to_owned());
    }
    if target.scheme() != "https"
        || target.host_str() != Some("github.com")
        || !target.path().starts_with("/XiangZi7/MiraiHub/releases/")
    {
        return Err("仅支持转发 MiraiHub 的 GitHub Release 文件".to_owned());
    }
    tauri::Url::parse(&format!("{}/{}", prefix.trim_end_matches('/'), target))
        .map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// 主窗口按所选线路检查更新；仍交由原生 updater 下载、校验签名和执行安装。
#[tauri::command]
pub async fn updater_check_source(
    window: WebviewWindow,
    prefix: String,
) -> Result<Option<UpdateMetadata>, String> {
    if window.label() != "main" || !updater_environment().supported {
        return Err("当前窗口或安装方式不支持应用更新".to_owned());
    }
    let endpoint = forwarded_url(prefix.trim(), MANIFEST_URL)?;
    let updater = window
        .updater_builder()
        .configure_client(|client| client.connect_timeout(std::time::Duration::from_secs(12)))
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let Some(mut update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    update.download_url = forwarded_url(prefix.trim(), update.download_url.as_str())?;
    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update
            .raw_json
            .get("pub_date")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: window.resources_table().add(update),
    };
    Ok(Some(metadata))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    supported: bool,
    reason: &'static str,
}

/// 仅为已发布的桌面目标启用更新，Linux DEB 与 Windows 便携版继续手动更新。
#[tauri::command]
pub fn updater_environment() -> Environment {
    let executable = std::env::current_exe().ok();
    let installed_windows = executable
        .as_ref()
        .and_then(|exe| exe.parent())
        .is_some_and(|dir| dir.join("uninstall.exe").is_file());
    let installed_macos = executable.as_ref().is_some_and(|exe| {
        exe.parent()
            .is_some_and(|dir| dir.ends_with("Contents/MacOS"))
            && !exe.starts_with("/Volumes")
    });
    let appimage =
        std::env::var_os("APPIMAGE").is_some_and(|path| std::path::Path::new(&path).is_file());
    let reason = if cfg!(debug_assertions) {
        "development"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        if installed_windows {
            ""
        } else {
            "portable"
        }
    } else if cfg!(all(
        target_os = "macos",
        any(target_arch = "x86_64", target_arch = "aarch64")
    )) {
        if installed_macos {
            ""
        } else {
            "package"
        }
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        if appimage {
            ""
        } else {
            "package"
        }
    } else {
        "platform"
    };
    Environment {
        supported: reason.is_empty(),
        reason,
    }
}

/// macOS/Linux 替换完程序后重启；Windows 的安装器自行退出并重启应用。
#[tauri::command]
pub fn updater_restart(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || !updater_environment().supported {
        return Err("当前窗口或安装方式不支持应用更新".to_owned());
    }
    #[cfg(not(windows))]
    app.request_restart();
    #[cfg(windows)]
    let _ = app;
    Ok(())
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
    #[test]
    fn forwarding_covers_manifest_and_installer_without_changing_signatures() {
        let prefix = "https://proxy.example/";
        for original in [super::MANIFEST_URL, "https://github.com/XiangZi7/MiraiHub/releases/download/v3.0.14/MiraiHub_3.0.14_windows_x64_setup.exe"] {
            assert_eq!(super::forwarded_url(prefix, original).unwrap().as_str(), format!("{prefix}{original}"));
            assert_eq!(super::forwarded_url("", original).unwrap().as_str(), original);
        }
        for prefix in [
            "http://proxy.example",
            "https://user:pass@proxy.example",
            "https://proxy.example/?target=",
            "https://proxy.example/#target",
        ] {
            assert!(super::forwarded_url(prefix, super::MANIFEST_URL).is_err());
        }
        assert!(super::forwarded_url(prefix, "https://example.com/installer.exe").is_err());
        assert!(
            super::forwarded_url(prefix, "https://github.com/other/project/releases/latest")
                .is_err()
        );
    }
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
