//! 按 Docker 连接与完整容器 ID 复用的只读日志窗口。
use sha2::{Digest, Sha256};
use tauri::{Manager, WebviewWindow};

use super::{file_window, window::percent_encode_component};
use crate::error::{AppError, AppResult};

pub const PREFIX: &str = "docker-logs-";

pub(crate) fn label(connection_id: &str, container_id: &str) -> AppResult<String> {
    if connection_id.trim().is_empty()
        || connection_id.len() > 256
        || connection_id.chars().any(char::is_control)
    {
        return Err(AppError::invalid_input("无效的 Docker 连接 ID"));
    }
    crate::docker::check_id(container_id)?;
    let mut hash = Sha256::new();
    hash.update(connection_id.as_bytes());
    hash.update([0]);
    hash.update(container_id.to_ascii_lowercase().as_bytes());
    Ok(format!("{PREFIX}{:x}", hash.finalize()))
}

fn location(connection_id: &str, container_id: &str, name: Option<&str>) -> (String, String) {
    let mut url = format!(
        "index.html?window=docker-logs&connectionId={}&containerId={}",
        percent_encode_component(connection_id),
        container_id
    );
    let name: String = name
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(120)
        .collect();
    let display = if name.trim().is_empty() {
        &container_id[..12]
    } else {
        url.push_str("&containerName=");
        url.push_str(&percent_encode_component(name.trim()));
        name.trim()
    };
    (url, format!("{display} · Docker logs · MiraiHub"))
}

/// 调用方已持有窗口创建锁，加载中的同一窗口等待首次 window_ready。
pub(super) fn open(
    main: &WebviewWindow,
    connection_id: &str,
    container_id: &str,
    container_name: Option<&str>,
) -> AppResult<()> {
    crate::ssh::tunnels::main_window(main)?;
    let label = label(connection_id, container_id)?;
    let app = main.app_handle();
    if file_window::focus_existing(app, &label)? {
        return Ok(());
    }
    let (url, title) = location(
        connection_id,
        &container_id.to_ascii_lowercase(),
        container_name,
    );
    let windows = app.state::<crate::docker::follow::LogWindows>();
    let feed = windows.open(&label);
    let window = match file_window::create(app, &label, &url, &title, Some(main)) {
        Ok(window) => window,
        Err(error) => {
            windows.close(&label, &feed);
            return Err(error);
        }
    };
    let app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            app.state::<crate::docker::follow::LogWindows>()
                .close(&label, &feed);
        }
    });
    Ok(())
}

/// 业务 IPC 默认只允许读取这一个日志，以及子窗口启动所需的显示设置。
pub(crate) fn allows(command: &str) -> bool {
    matches!(
        command,
        "docker_container_logs"
            | "docker_logs_follow"
            | "docker_logs_follow_stop"
            | "docker_logs_follow_ack"
            | "window_ready"
            | "get_system_locale"
            | "skin_directory"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

    #[test]
    fn window_identity_and_title_use_separate_inputs() {
        assert_eq!(
            label("one", ID).unwrap(),
            label("one", &ID.to_uppercase()).unwrap()
        );
        assert_ne!(label("one", ID).unwrap(), label("two", ID).unwrap());
        assert!(label("one", "short").is_err());
        assert!(label("\n", ID).is_err());
        let (url, title) = location("db & machines", ID, Some(" web & #1\n"));
        let parsed = reqwest::Url::parse(&format!("http://localhost/{url}")).unwrap();
        let params: std::collections::HashMap<_, _> = parsed.query_pairs().collect();
        assert_eq!(params["connectionId"], "db & machines");
        assert_eq!(params["containerId"], ID);
        assert_eq!(params["containerName"], "web & #1");
        assert!(title.starts_with("web & #1"));
    }

    #[test]
    fn log_windows_cannot_invoke_lifecycle_commands_or_generic_ssh() {
        assert!(allows("docker_container_logs") && allows("window_ready"));
        for command in [
            "docker_container_action",
            "ssh_connect",
            "ssh_exec",
            "app_ready",
        ] {
            assert!(!allows(command));
        }
    }
}
