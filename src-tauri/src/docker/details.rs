//! 读取所选容器的诊断信息，只向详情窗口返回需要展示的字段。
use std::{collections::BTreeMap, time::Duration};

use chrono::DateTime;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{State, WebviewWindow};

use super::{connect, validate_window, with_window_tunnel, Kind, Target};
use crate::{
    error::{AppError, AppResult},
    ssh::{models::SshConfig, SessionManager},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetails {
    id: String,
    name: String,
    image: String,
    state: String,
    created_at: Option<String>,
    started_at: Option<String>,
    finished_at: Option<String>,
    exit_code: Option<i64>,
    oom_killed: bool,
    error: String,
    restart_count: u64,
    health: Option<Health>,
    ports: Vec<PortBinding>,
    mounts: Vec<Mount>,
    stats: Option<Resources>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all(deserialize = "PascalCase", serialize = "camelCase"))]
struct Health {
    status: String,
    #[serde(default)]
    failing_streak: u32,
    #[serde(default, deserialize_with = "health_checks")]
    log: Vec<HealthCheck>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all(deserialize = "PascalCase", serialize = "camelCase"))]
struct HealthCheck {
    #[serde(default, deserialize_with = "timestamp")]
    start: Option<String>,
    #[serde(default, deserialize_with = "timestamp")]
    end: Option<String>,
    exit_code: i32,
    #[serde(default)]
    output: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all(deserialize = "PascalCase", serialize = "camelCase"))]
struct Mount {
    #[serde(default, rename(deserialize = "Type", serialize = "type"))]
    kind: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    source: String,
    destination: String,
    #[serde(rename(deserialize = "RW"))]
    writable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortBinding {
    container_port: String,
    host_ip: String,
    host_port: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Resources {
    cpu_percent: Option<f64>,
    memory_bytes: Option<u64>,
    memory_limit_bytes: Option<u64>,
}

/// Docker 用 Go 的零时间表示容器从未启动或终止。
fn timestamp<'de, D: serde::Deserializer<'de>>(input: D) -> Result<Option<String>, D::Error> {
    Ok(Option::<String>::deserialize(input)?
        .filter(|value| !value.is_empty() && !value.starts_with("0001-01-01T")))
}

/// 尚未执行检查的容器有的引擎版本返回 null，窗口统一读取空列表。
fn health_checks<'de, D: serde::Deserializer<'de>>(input: D) -> Result<Vec<HealthCheck>, D::Error> {
    Ok(Option::<Vec<HealthCheck>>::deserialize(input)?.unwrap_or_default())
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Inspect {
    id: String,
    name: String,
    #[serde(default, deserialize_with = "timestamp")]
    created: Option<String>,
    #[serde(default)]
    restart_count: u64,
    state: ContainerState,
    config: Config,
    mounts: Option<Vec<Mount>>,
    host_config: Option<HostConfig>,
    network_settings: Option<Network>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ContainerState {
    status: String,
    #[serde(default, rename = "OOMKilled")]
    oom_killed: bool,
    #[serde(default)]
    error: String,
    exit_code: Option<i64>,
    #[serde(default, deserialize_with = "timestamp")]
    started_at: Option<String>,
    #[serde(default, deserialize_with = "timestamp")]
    finished_at: Option<String>,
    health: Option<Health>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Config {
    image: String,
    exposed_ports: Option<BTreeMap<String, serde::de::IgnoredAny>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct HostConfig {
    port_bindings: Option<Ports>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Network {
    ports: Option<Ports>,
}

type Ports = BTreeMap<String, Option<Vec<HostPort>>>;

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct HostPort {
    host_ip: String,
    host_port: String,
}

/// 运行时使用实际分配的端口；停止后仍显示已配置的映射和仅容器网络可见的端口。
fn port_bindings(
    config: &Config,
    host: Option<HostConfig>,
    network: Option<Network>,
) -> Vec<PortBinding> {
    let mut ports = host.and_then(|h| h.port_bindings).unwrap_or_default();
    for (port, active) in network.and_then(|n| n.ports).unwrap_or_default() {
        let binding = ports.entry(port).or_default();
        if active.as_ref().is_some_and(|values| !values.is_empty()) {
            *binding = active;
        }
    }
    if let Some(exposed) = &config.exposed_ports {
        for port in exposed.keys() {
            ports.entry(port.clone()).or_default();
        }
    }
    let mut result = Vec::new();
    for (port, hosts) in ports {
        let hosts = hosts.unwrap_or_default();
        if hosts.is_empty() {
            result.push(PortBinding {
                container_port: port,
                host_ip: String::new(),
                host_port: String::new(),
            });
        } else {
            for host in hosts {
                result.push(PortBinding {
                    container_port: port.clone(),
                    host_ip: host.host_ip,
                    host_port: host.host_port,
                });
            }
        }
    }
    result
}

/// 白名单解码 inspect，原始环境变量、标签、启动参数和凭据不进入 WebView。
fn inspect(id: &str, data: &[u8]) -> AppResult<ContainerDetails> {
    let raw: Inspect = serde_json::from_slice(data)
        .map_err(|e| AppError::network(format!("Docker 容器详情格式无效：{e}")))?;
    if !id.eq_ignore_ascii_case(&raw.id) {
        return Err(AppError::network(
            "Docker Engine 返回的容器 ID 与所选容器不匹配",
        ));
    }
    let ports = port_bindings(&raw.config, raw.host_config, raw.network_settings);
    let exited = matches!(raw.state.status.as_str(), "exited" | "dead" | "restarting");
    Ok(ContainerDetails {
        id: raw.id,
        name: raw.name.trim_start_matches('/').to_owned(),
        image: raw.config.image,
        state: raw.state.status,
        created_at: raw.created,
        started_at: raw.state.started_at,
        finished_at: raw.state.finished_at,
        exit_code: raw.state.exit_code.filter(|_| exited),
        oom_killed: raw.state.oom_killed,
        error: raw.state.error,
        restart_count: raw.restart_count,
        health: raw.state.health,
        ports,
        mounts: raw.mounts.unwrap_or_default(),
        stats: None,
    })
}

/// Unix 使用 CPU 总量和系统时间的增量，Windows 使用每个处理器可用的 100ns 时间片。
fn cpu_percent(sample: &Value) -> Option<f64> {
    let number = |path| sample.pointer(path)?.as_u64();
    let cpu_delta = number("/cpu_stats/cpu_usage/total_usage")?
        .checked_sub(number("/precpu_stats/cpu_usage/total_usage")?)? as f64;
    if let Some(system) = number("/cpu_stats/system_cpu_usage").filter(|v| *v > 0) {
        let system_delta = system.checked_sub(number("/precpu_stats/system_cpu_usage")?)?;
        let cpus = number("/cpu_stats/online_cpus")
            .filter(|n| *n > 0)
            .or_else(|| {
                Some(
                    sample
                        .pointer("/cpu_stats/cpu_usage/percpu_usage")?
                        .as_array()?
                        .len() as u64,
                )
            })?;
        return (system_delta > 0 && cpus > 0)
            .then(|| 100.0 * cpu_delta * cpus as f64 / system_delta as f64);
    }
    let count = sample["num_procs"].as_u64().filter(|n| *n > 0)?;
    let at = |key: &str| DateTime::parse_from_rfc3339(sample[key].as_str()?).ok();
    let elapsed = (at("read")? - at("preread")?).num_nanoseconds()?;
    (elapsed > 0).then(|| 100.0 * cpu_delta / (elapsed as f64 / 100.0 * count as f64))
}

/// 与 docker stats 一样排除 Linux 可回收的文件缓存；Windows 读取私有工作集。
fn resources(id: &str, data: &[u8]) -> Option<Resources> {
    let sample: Value = serde_json::from_slice(data).ok()?;
    if sample["id"]
        .as_str()
        .is_some_and(|value| !id.eq_ignore_ascii_case(value))
    {
        return None;
    }
    let mem = &sample["memory_stats"];
    let memory_bytes = mem["privateworkingset"].as_u64().or_else(|| {
        let used = mem["usage"].as_u64()?;
        let cache = ["total_inactive_file", "inactive_file"]
            .iter()
            .find_map(|key| mem["stats"][*key].as_u64().filter(|n| *n < used));
        Some(used - cache.unwrap_or(0))
    });
    let cpu_percent = cpu_percent(&sample);
    let memory_limit_bytes = mem["limit"].as_u64().filter(|n| *n > 0);
    if cpu_percent.is_none() && memory_bytes.is_none() && memory_limit_bytes.is_none() {
        return None;
    }
    Some(Resources {
        cpu_percent,
        memory_bytes,
        memory_limit_bytes,
    })
}

/// 同一次版本协商和 SSH 会话内先取详情，再有时限地取 CPU 双采样。
pub(super) async fn read(
    target: Target,
    manager: &SessionManager,
    id: &str,
) -> AppResult<ContainerDetails> {
    let (engine, version) = connect(target, manager).await?;
    let base = format!("{version}/containers/{id}");
    let data = engine
        .request(Method::GET, &format!("{base}/json"), 8 * 1024 * 1024, false)
        .await?;
    let mut details = inspect(id, &data)?;
    if matches!(details.state.as_str(), "running" | "paused") {
        let path = format!("{base}/stats?stream=false");
        if let Ok(Ok(data)) = tokio::time::timeout(
            Duration::from_secs(4),
            engine.request(Method::GET, &path, 2 * 1024 * 1024, false),
        )
        .await
        {
            details.stats = resources(id, &data);
        }
    }
    Ok(details)
}

/// 只读详情命令仅接受原生窗口打开时绑定的连接身份和完整容器 ID。
#[tauri::command]
pub async fn docker_container_details(
    window: WebviewWindow,
    target: Target,
    manager: State<'_, SessionManager>,
    id: String,
    connection_id: String,
    ssh_config: Option<SshConfig>,
) -> AppResult<ContainerDetails> {
    validate_window(
        Kind::Details,
        &window,
        &connection_id,
        &id,
        &target,
        ssh_config.as_ref(),
    )?;
    with_window_tunnel(
        target,
        &manager,
        ssh_config,
        std::future::pending(),
        |target| read(target, &manager, &id),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn windows_and_legacy_linux_metrics_use_available_samples() {
        let sample = |value: Value| resources("id", &serde_json::to_vec(&value).unwrap()).unwrap();
        let win = sample(json!({
            "num_procs":4,"preread":"2026-02-01T00:00:00Z","read":"2026-02-01T00:00:01Z",
            "precpu_stats":{"cpu_usage":{"total_usage":10}},"cpu_stats":{"cpu_usage":{"total_usage":10000010}},
            "memory_stats":{"privateworkingset":65536}
        }));
        assert_eq!(win.cpu_percent, Some(25.0));
        assert_eq!(win.memory_bytes, Some(65536));
        assert_eq!(win.memory_limit_bytes, None);
        let linux = sample(json!({
            "precpu_stats":{"cpu_usage":{"total_usage":100},"system_cpu_usage":1000},
            "cpu_stats":{"cpu_usage":{"total_usage":150,"percpu_usage":[50,100]},"system_cpu_usage":1100},
            "memory_stats":{"usage":300,"stats":{"total_inactive_file":10}}
        }));
        assert_eq!(linux.cpu_percent, Some(100.0));
        assert_eq!(linux.memory_bytes, Some(290));
        assert!(resources("one", br#"{"id":"other","memory_stats":{"usage":123}}"#).is_none());
        assert!(resources("one", b"{}").is_none());
    }
}
