//! 同类窗口按 Docker 连接与完整容器 ID 复用，统一使用文件编辑器的原生窗口。
use sha2::{Digest, Sha256};
use tauri::{Manager, WebviewWindow};

use super::{file_window, window::percent_encode_component};
use crate::error::{AppError, AppResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Logs,
    Details,
}

impl Kind {
    /// 该类型的固定路由名也用于原生窗口标签。
    fn surface(self) -> &'static str {
        match self {
            Self::Logs => "docker-logs",
            Self::Details => "docker-details",
        }
    }

    /// 识别受限的 Docker 子窗口。
    pub(crate) fn from_label(label: &str) -> Option<Self> {
        [Self::Logs, Self::Details].into_iter().find(|kind| {
            label
                .strip_prefix(kind.surface())
                .is_some_and(|suffix| suffix.starts_with('-'))
        })
    }

    /// 名称可变，同一连接和容器的标识在改名后仍保持稳定。
    pub(crate) fn label(self, connection_id: &str, container_id: &str) -> AppResult<String> {
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
        Ok(format!("{}-{:x}", self.surface(), hash.finalize()))
    }

    /// 只放行对应窗口的数据读取以及显示窗口所需的命令。
    pub(crate) fn allows(self, command: &str) -> bool {
        if matches!(
            command,
            "window_ready" | "get_system_locale" | "skin_directory"
        ) {
            return true;
        }
        match self {
            Self::Logs => matches!(
                command,
                "docker_container_logs"
                    | "docker_logs_follow"
                    | "docker_logs_follow_stop"
                    | "docker_logs_follow_ack"
            ),
            Self::Details => command == "docker_container_details",
        }
    }
}

fn location(
    kind: Kind,
    connection_id: &str,
    container_id: &str,
    name: Option<&str>,
) -> (String, String) {
    let mut url = format!(
        "index.html?window={}&connectionId={}&containerId={}",
        kind.surface(),
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
    let title = match kind {
        Kind::Logs => "Docker logs",
        Kind::Details => "Docker details",
    };
    (url, format!("{display} · {title} · MiraiHub"))
}

/// 调用方已持有窗口创建锁，加载中的同一窗口等待首次 window_ready。
pub(super) fn open(
    kind: Kind,
    main: &WebviewWindow,
    connection_id: &str,
    container_id: &str,
    container_name: Option<&str>,
) -> AppResult<()> {
    crate::ssh::tunnels::main_window(main)?;
    let label = kind.label(connection_id, container_id)?;
    let app = main.app_handle();
    if file_window::focus_existing(app, &label)? {
        return Ok(());
    }
    let (url, title) = location(
        kind,
        connection_id,
        &container_id.to_ascii_lowercase(),
        container_name,
    );
    if kind == Kind::Details {
        file_window::create(app, &label, &url, &title, Some(main))?;
        return Ok(());
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

    #[test]
    fn window_identity_and_title_use_separate_inputs() {
        assert_eq!(
            Kind::Logs.label("one", ID).unwrap(),
            Kind::Logs.label("one", &ID.to_uppercase()).unwrap()
        );
        assert_ne!(
            Kind::Logs.label("one", ID).unwrap(),
            Kind::Logs.label("two", ID).unwrap()
        );
        assert_ne!(
            Kind::Logs.label("one", ID).unwrap(),
            Kind::Details.label("one", ID).unwrap()
        );
        for kind in [Kind::Logs, Kind::Details] {
            assert_eq!(
                Kind::from_label(&kind.label("one", ID).unwrap()),
                Some(kind)
            );
            assert!(kind.label("one", "short").is_err());
            assert!(kind.label("\n", ID).is_err());
        }
        let (url, title) = location(Kind::Details, "db & machines", ID, Some(" web & #1\n"));
        let parsed = reqwest::Url::parse(&format!("http://localhost/{url}")).unwrap();
        let params: std::collections::HashMap<_, _> = parsed.query_pairs().collect();
        assert_eq!(params["connectionId"], "db & machines");
        assert_eq!(params["window"], "docker-details");
        assert_eq!(params["containerId"], ID);
        assert_eq!(params["containerName"], "web & #1");
        assert!(title.starts_with("web & #1"));
    }

    #[test]
    fn log_windows_cannot_invoke_lifecycle_commands_or_generic_ssh() {
        assert!(Kind::Logs.allows("docker_container_logs") && Kind::Logs.allows("window_ready"));
        assert!(
            Kind::Details.allows("docker_container_details")
                && Kind::Details.allows("window_ready")
        );
        assert!(!Kind::Details.allows("docker_logs_follow"));
        assert!(!Kind::Logs.allows("docker_container_details"));
        for command in [
            "docker_container_action",
            "ssh_connect",
            "ssh_exec",
            "app_ready",
        ] {
            assert!(!Kind::Logs.allows(command) && !Kind::Details.allows(command));
        }
    }
}
