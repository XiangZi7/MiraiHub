//! Docker Engine API：容器清单、只读详情、状态操作和日志。
pub mod details;
pub mod follow;
mod log_stream;
#[cfg(test)]
mod tests;
mod transport;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::platform::docker_window::Kind;
use crate::ssh::SessionManager;
use transport::Engine;
pub use transport::Target;

#[derive(Deserialize)]
struct Version {
    #[serde(rename = "ApiVersion")]
    api: String,
    #[serde(rename = "MinAPIVersion")]
    min: Option<String>,
}

/// 解析服务端与客户端都支持的版本，路径只使用验证过的数字。
fn api_version(data: &[u8]) -> AppResult<String> {
    let version: Version = serde_json::from_slice(data)
        .map_err(|_| AppError::network("端点没有返回有效的 Docker Engine 版本"))?;
    let parse = |text: &str| {
        let (major, minor) = text.split_once('.')?;
        Some((major.parse::<u16>().ok()?, minor.parse::<u16>().ok()?))
    };
    let high = parse(&version.api).ok_or_else(|| AppError::network("无效的 Docker API 版本"))?;
    let low = parse(version.min.as_deref().unwrap_or("1.0"))
        .ok_or_else(|| AppError::network("无效的 Docker API 最低版本"))?;
    let agreed = high.min((1, 57));
    if agreed < low.max((1, 24)) {
        return Err(AppError::network(
            "Docker Engine 与客户端没有兼容的 API 版本",
        ));
    }
    Ok(format!("/v{}.{}", agreed.0, agreed.1))
}

/// 每次操作与同一个端点协商，避免复用不同主机上一次的版本。
async fn connect(target: Target, sessions: &SessionManager) -> AppResult<(Engine, String)> {
    let engine = Engine::connect(target, sessions).await?;
    let response = engine
        .request(Method::GET, "/version", 128 * 1024, false)
        .await?;
    Ok((engine, api_version(&response)?))
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Port {
    #[serde(rename = "IP", default)]
    ip: String,
    private_port: u16,
    public_port: Option<u16>,
    #[serde(rename = "Type")]
    protocol: String,
}

/// 将映射端口和只暴露给容器网络的端口显示为 Docker 常用格式。
fn port_label(port: Port) -> String {
    let dest = format!("{}/{}", port.private_port, port.protocol);
    let Some(public) = port.public_port.filter(|p| *p > 0) else {
        return dest;
    };
    match port.ip.as_str() {
        "" => format!("{public}->{dest}"),
        ip if ip.contains(':') => format!("[{ip}]:{public}->{dest}"),
        ip => format!("{ip}:{public}->{dest}"),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Summary {
    id: String,
    names: Option<Vec<String>>,
    image: String,
    state: String,
    status: String,
    ports: Option<Vec<Port>>,
    labels: Option<ComposeLabels>,
}

/// 仅向列表传递 Compose 的标准分组标签，其他容器标签无需跨 IPC 复制。
#[derive(Default, Deserialize)]
struct ComposeLabels {
    #[serde(rename = "com.docker.compose.project")]
    project: Option<String>,
    #[serde(rename = "com.docker.compose.service")]
    service: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    id: String,
    name: String,
    image: String,
    state: String,
    status: String,
    ports: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    compose_project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    compose_service: Option<String>,
}

/// 操作只接受列表返回的完整不可变容器 ID，不允许以名称指向同名的新容器。
pub(crate) fn check_id(id: &str) -> AppResult<()> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::invalid_input("无效的 Docker 容器 ID"));
    }
    Ok(())
}

fn containers(data: &[u8]) -> AppResult<Vec<Container>> {
    let items: Vec<Summary> = serde_json::from_slice(data)
        .map_err(|e| AppError::network(format!("Docker 容器列表格式无效：{e}")))?;
    items
        .into_iter()
        .map(|item| {
            check_id(&item.id)?;
            let names = item.names.unwrap_or_default();
            let name = names
                .iter()
                .map(|name| name.trim_start_matches('/'))
                .find(|name| !name.is_empty() && !name.contains('/'))
                .unwrap_or(&item.id[..12])
                .to_owned();
            let ports = item
                .ports
                .unwrap_or_default()
                .into_iter()
                .map(port_label)
                .collect::<Vec<_>>()
                .join(", ");
            let labels = item.labels.unwrap_or_default();
            Ok(Container {
                id: item.id,
                name,
                image: item.image,
                state: item.state,
                status: item.status,
                ports,
                compose_project: labels.project.filter(|label| !label.trim().is_empty()),
                compose_service: labels.service.filter(|label| !label.trim().is_empty()),
            })
        })
        .collect()
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Start,
    Stop,
    Restart,
}

impl Action {
    fn path(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
        }
    }
}

/// 纯 TTY 日志以请求的时间戳开头；非 TTY 为标准输出/标准错误的连续 Docker 帧。
/// 先拼字节再解码，以保留跨帧分割的 UTF-8。
fn log_text(bytes: &[u8]) -> AppResult<String> {
    let mut decoder = log_stream::LogDecoder::default();
    let mut output = decoder.push(bytes)?;
    output.push_str(&decoder.finish()?);
    Ok(output)
}

#[tauri::command]
pub async fn docker_test(target: Target, manager: State<'_, SessionManager>) -> AppResult<()> {
    connect(target, &manager).await?;
    Ok(())
}

#[tauri::command]
pub async fn docker_containers(
    target: Target,
    manager: State<'_, SessionManager>,
) -> AppResult<Vec<Container>> {
    let (engine, prefix) = connect(target, &manager).await?;
    let data = engine
        .request(
            Method::GET,
            &format!("{prefix}/containers/json?all=1"),
            16 * 1024 * 1024,
            false,
        )
        .await?;
    containers(&data)
}

#[tauri::command]
pub async fn docker_container_action(
    target: Target,
    manager: State<'_, SessionManager>,
    id: String,
    action: Action,
) -> AppResult<()> {
    check_id(&id)?;
    let (engine, prefix) = connect(target, &manager).await?;
    let path = format!("{prefix}/containers/{id}/{}", action.path());
    engine
        .request(
            Method::POST,
            &path,
            4096,
            matches!(action, Action::Start | Action::Stop),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn docker_container_logs(
    window: tauri::WebviewWindow,
    target: Target,
    manager: State<'_, SessionManager>,
    id: String,
    connection_id: String,
    ssh_config: Option<crate::ssh::models::SshConfig>,
) -> AppResult<String> {
    validate_window(
        Kind::Logs,
        &window,
        &connection_id,
        &id,
        &target,
        ssh_config.as_ref(),
    )?;
    read_window_logs(target, &manager, &id, ssh_config).await
}

/// 验证子窗口类型与绑定的容器；SSH 只能使用本次调用由原生端创建的隧道。
fn validate_window(
    kind: Kind,
    window: &tauri::WebviewWindow,
    connection_id: &str,
    id: &str,
    target: &Target,
    ssh_config: Option<&crate::ssh::models::SshConfig>,
) -> AppResult<()> {
    use tauri::Manager;
    if kind.label(connection_id, id)? != window.label() {
        return Err(AppError::invalid_input("Docker 窗口与所选连接或容器不匹配"));
    }
    if target.ssh_session_id.is_some()
        || (target.transport == transport::Access::Ssh) != ssh_config.is_some()
    {
        return Err(AppError::invalid_input("Docker 窗口的 SSH 隧道配置无效"));
    }
    crate::ssh::prompt::install(window.app_handle());
    Ok(())
}

/// 一次 IPC 内完成 SSH 建连、读取和释放，关闭 WebView 也不会跳过原生清理。
async fn read_window_logs(
    target: Target,
    manager: &SessionManager,
    id: &str,
    ssh_config: Option<crate::ssh::models::SshConfig>,
) -> AppResult<String> {
    with_window_tunnel(
        target,
        manager,
        ssh_config,
        std::future::pending(),
        |target| read_container_logs(target, manager, id),
    )
    .await
}

/// 子窗口在一次调用内共用同一个临时隧道。取消覆盖 SSH 握手、响应头和正文。
async fn with_window_tunnel<T, F>(
    mut target: Target,
    manager: &SessionManager,
    ssh_config: Option<crate::ssh::models::SshConfig>,
    cancelled: impl std::future::Future<Output = T>,
    read: impl FnOnce(Target) -> F,
) -> AppResult<T>
where
    F: std::future::Future<Output = AppResult<T>>,
{
    tokio::pin!(cancelled);
    let temporary = match ssh_config {
        Some(config) => tokio::select! {
            biased;
            value = &mut cancelled => return Ok(value),
            id = manager.connect(config) => Some(id?),
        },
        None => None,
    };
    target.ssh_session_id.clone_from(&temporary);
    let result = tokio::select! {
        biased;
        value = &mut cancelled => Ok(value),
        result = read(target) => result,
    };
    if let Some(session) = temporary {
        let _ = manager.disconnect(&session).await;
    }
    result
}

async fn read_container_logs(
    target: Target,
    manager: &SessionManager,
    id: &str,
) -> AppResult<String> {
    check_id(id)?;
    let (engine, prefix) = connect(target, manager).await?;
    let path = format!("{prefix}/containers/{id}/logs?stdout=1&stderr=1&timestamps=1&tail=200");
    let data = engine
        .request(Method::GET, &path, 8 * 1024 * 1024, false)
        .await?;
    log_text(&data)
}
