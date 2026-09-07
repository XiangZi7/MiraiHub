//! SSH connection configuration import/export.
//!
//! File parsing and private-key material stay in Rust. The WebView only receives
//! connection metadata during preview and current-format connection records after
//! the user confirms the import.

use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::WebviewWindow;

use crate::{
    backup,
    error::{AppError, AppResult},
};

use super::{keys, tunnels::main_window};

const MAX_CONNECTIONS: usize = 5_000;
const MAX_GROUPS: usize = 1_000;
const MAX_FIELD: usize = 8_192;
const EMBEDDED_KEY: &str = "privateKeyContents";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigPreviewItem {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    group: String,
    auth_type: String,
    has_credentials: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigPreview {
    source_format: String,
    includes_credentials: bool,
    includes_startup_commands: bool,
    connections: Vec<SshConfigPreviewItem>,
    warnings: Vec<String>,
}

struct NormalizedArchive {
    payload: Value,
    source_format: String,
    includes_credentials: bool,
    includes_startup_commands: bool,
    warnings: Vec<String>,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::invalid_input(message.into())
}

fn object<'a>(value: &'a Value, name: &str) -> AppResult<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{name} 不是有效对象")))
}

fn text(value: Option<&Value>, name: &str, required: bool) -> AppResult<String> {
    let value = value.and_then(Value::as_str).unwrap_or_default();
    if value.len() > MAX_FIELD || value.contains('\0') || (required && value.trim().is_empty()) {
        return Err(invalid(format!("{name} 无效或过长")));
    }
    Ok(value.to_owned())
}

fn port(value: Option<&Value>) -> AppResult<u16> {
    let parsed = match value {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(value)) => value.parse::<u64>().ok(),
        _ => None,
    };
    parsed
        .and_then(|value| u16::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| invalid("SSH 端口无效"))
}

fn integer_text(value: Option<&Value>, default: u64, min: u64, max: u64) -> u64 {
    let parsed = match value {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(value)) => value.parse::<u64>().ok(),
        _ => None,
    };
    parsed
        .filter(|value| (*value >= min) && (*value <= max))
        .unwrap_or(default)
}

fn timestamp(value: Option<&Value>) -> i64 {
    value
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.timestamp_millis())
        .unwrap_or_else(|| Utc::now().timestamp_millis())
}

fn connection_meta(value: &Value) -> AppResult<SshConfigPreviewItem> {
    let connection = object(value, "SSH 配置")?;
    if connection.get("kind").and_then(Value::as_str) != Some("ssh") {
        return Err(invalid("备份中包含非 SSH 配置"));
    }
    let settings = object(
        connection.get("settings").unwrap_or(&Value::Null),
        "SSH 设置",
    )?;
    let auth = object(settings.get("auth").unwrap_or(&Value::Null), "SSH 认证")?;
    let auth_type = text(auth.get("type"), "认证方式", true)?;
    if !matches!(auth_type.as_str(), "password" | "privateKey" | "agent") {
        return Err(invalid("SSH 认证方式不受支持"));
    }
    let has_credentials = match auth_type.as_str() {
        "password" => !text(auth.get("password"), "密码", false)?.is_empty(),
        "privateKey" => {
            !text(auth.get(EMBEDDED_KEY), "内嵌私钥", false)?.is_empty()
                || !text(auth.get("path"), "私钥路径", false)?.is_empty()
                || !text(auth.get("passphrase"), "私钥口令", false)?.is_empty()
        }
        _ => false,
    };

    Ok(SshConfigPreviewItem {
        id: text(connection.get("id"), "连接 ID", true)?,
        name: text(connection.get("name"), "连接名称", true)?,
        host: text(connection.get("host"), "主机", true)?,
        port: port(connection.get("port"))?,
        username: text(connection.get("username"), "用户名", true)?,
        group: text(connection.get("group"), "分组", false)?,
        auth_type,
        has_credentials,
    })
}

fn normalize_current(payload: Value) -> AppResult<NormalizedArchive> {
    backup::valid_payload(&payload)?;
    let root = object(&payload, "连接备份")?;
    let source = root
        .get("connections")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("连接列表无效"))?;
    if source.len() > MAX_CONNECTIONS {
        return Err(invalid("SSH 配置数量过多"));
    }

    let mut connections = Vec::new();
    let mut ids = HashSet::new();
    for value in source {
        let Some(connection) = value.as_object() else {
            return Err(invalid("备份中存在无效连接"));
        };
        if connection.get("kind").and_then(Value::as_str) != Some("ssh") {
            continue;
        }
        let meta = connection_meta(value)?;
        if !ids.insert(meta.id) {
            return Err(invalid("备份中存在重复连接 ID"));
        }
        connections.push(value.clone());
    }

    let groups = root
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("分组列表无效"))?
        .iter()
        .filter(|value| value.get("kind").and_then(Value::as_str) == Some("ssh"))
        .cloned()
        .collect::<Vec<_>>();
    if groups.len() > MAX_GROUPS {
        return Err(invalid("SSH 分组数量过多"));
    }
    let tags = root
        .get("tags")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("标签列表无效"))?
        .clone();
    let created_at = root
        .get("createdAt")
        .and_then(Value::as_i64)
        .unwrap_or_else(|| Utc::now().timestamp_millis());
    let includes_credentials = root
        .get("includesCredentials")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let includes_startup_commands = connections.iter().any(|value| {
        value
            .pointer("/settings/startupCommand")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
    });

    Ok(NormalizedArchive {
        payload: json!({
            "format": "miraihub-connections",
            "version": 1,
            "createdAt": created_at,
            "includesCredentials": includes_credentials,
            "connections": connections,
            "groups": groups,
            "tags": tags,
        }),
        source_format: "MiraiHub".into(),
        includes_credentials,
        includes_startup_commands,
        warnings: Vec::new(),
    })
}

fn normalize_legacy(payload: Value) -> AppResult<NormalizedArchive> {
    let root = object(&payload, "旧版 SSH 备份")?;
    if root.get("type").and_then(Value::as_str) != Some("YxcrHub.ssh-configs")
        || root.get("version").and_then(Value::as_u64) != Some(1)
    {
        return Err(invalid("不是受支持的 SSH 配置备份"));
    }
    let source_groups = root
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("旧版 SSH 分组无效"))?;
    if source_groups.len() > MAX_GROUPS {
        return Err(invalid("SSH 分组数量过多"));
    }
    let created_at = timestamp(root.get("exportedAt"));
    let mut group_names = HashMap::new();
    let mut groups = Vec::new();
    for value in source_groups {
        let group = object(value, "旧版 SSH 分组")?;
        let id = text(group.get("id"), "分组 ID", true)?;
        let name = text(group.get("name"), "分组名称", true)?;
        group_names.insert(id.clone(), name.clone());
        groups.push(json!({ "id": id, "name": name, "kind": "ssh", "createdAt": created_at }));
    }

    let source = root
        .get("configs")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("旧版 SSH 配置列表无效"))?;
    if source.len() > MAX_CONNECTIONS {
        return Err(invalid("SSH 配置数量过多"));
    }

    let mut connections = Vec::new();
    let mut ids = HashSet::new();
    let mut tags = Vec::new();
    let mut known_tags = HashSet::new();
    let mut ignored_local = 0usize;
    let mut unsupported = false;
    let mut includes_credentials = false;
    let mut includes_startup_commands = false;

    for (index, value) in source.iter().enumerate() {
        let config = object(value, "旧版 SSH 配置")?;
        if config.get("kind").and_then(Value::as_str) == Some("local") {
            ignored_local += 1;
            continue;
        }
        let id = text(config.get("id"), "连接 ID", true)?;
        if !ids.insert(id.clone()) {
            return Err(invalid("旧版备份中存在重复连接 ID"));
        }
        let name = text(config.get("name"), "连接名称", true)?;
        let host = text(config.get("host"), "主机", true)?;
        let ssh_port = port(config.get("port"))?;
        let username = text(config.get("username"), "用户名", true)?;
        let group_id = text(config.get("groupId"), "分组 ID", false)?;
        let group = group_names.get(&group_id).cloned().unwrap_or_default();
        let description = text(config.get("note"), "备注", false)?;
        let environment = text(config.get("env"), "环境标签", false)?;
        let color = match config.get("colorTag").and_then(Value::as_str) {
            Some("red" | "orange" | "amber" | "green" | "cyan" | "blue" | "violet" | "gray") => {
                config.get("colorTag").and_then(Value::as_str).unwrap()
            }
            _ => "green",
        };
        let connection_tags = if environment.is_empty() {
            Vec::<String>::new()
        } else {
            if known_tags.insert(environment.to_lowercase()) {
                tags.push(json!({ "name": environment, "color": color, "createdAt": created_at + index as i64 }));
            }
            vec![environment]
        };
        let auth_type = text(config.get("authType"), "认证方式", true)?;
        let password = text(config.get("password"), "密码", false)?;
        let private_key = text(config.get("privateKey"), "私钥", false)?;
        let passphrase = text(config.get("passphrase"), "私钥口令", false)?;
        let auth = match auth_type.as_str() {
            "password" => {
                includes_credentials |= !password.is_empty();
                json!({ "type": "password", "password": password })
            }
            "privateKey" => {
                includes_credentials |= !private_key.is_empty() || !passphrase.is_empty();
                if private_key.contains("PRIVATE KEY") {
                    let mut auth =
                        json!({ "type": "privateKey", "path": "", "passphrase": passphrase });
                    auth[EMBEDDED_KEY] = Value::String(private_key);
                    auth
                } else {
                    json!({ "type": "privateKey", "path": private_key, "passphrase": passphrase })
                }
            }
            "agent" => json!({ "type": "agent" }),
            _ => return Err(invalid("旧版 SSH 认证方式不受支持")),
        };
        let advanced = config.get("advanced").and_then(Value::as_object);
        let timeout_secs =
            integer_text(advanced.and_then(|value| value.get("timeout")), 30, 1, 300);
        let keepalive_secs = integer_text(
            advanced.and_then(|value| value.get("keepalive")),
            30,
            0,
            3_600,
        );
        let init_command = text(
            advanced.and_then(|value| value.get("initCommand")),
            "初始命令",
            false,
        )?;
        let startup_script = text(
            advanced.and_then(|value| value.get("startupScript")),
            "启动脚本",
            false,
        )?;
        let startup_command = match (init_command.is_empty(), startup_script.is_empty()) {
            (true, true) => String::new(),
            (false, true) => init_command,
            (true, false) => startup_script,
            (false, false) => format!("{init_command}\n{startup_script}"),
        };
        includes_startup_commands |= !startup_command.is_empty();
        unsupported |= config
            .get("tunnels")
            .and_then(Value::as_array)
            .is_some_and(|value| !value.is_empty())
            || config
                .get("envVars")
                .and_then(Value::as_array)
                .is_some_and(|value| !value.is_empty())
            || config
                .get("proxy")
                .and_then(Value::as_object)
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str)
                .is_some_and(|value| value != "none");

        connections.push(json!({
            "id": id,
            "name": name,
            "kind": "ssh",
            "host": host,
            "port": ssh_port,
            "username": username,
            "group": group,
            "description": description,
            "tags": connection_tags,
            "tagColor": color,
            "createdAt": created_at + index as i64,
            "lastUsedAt": 0,
            "settings": {
                "auth": auth,
                "timeoutSecs": timeout_secs,
                "keepaliveSecs": keepalive_secs,
                "terminalType": "xterm-256color",
                "startupCommand": startup_command,
            }
        }));
    }

    let referenced_groups = connections
        .iter()
        .filter_map(|value| value.get("group").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    groups.retain(|value| {
        value
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| referenced_groups.contains(name))
    });
    let mut warnings = Vec::new();
    if ignored_local > 0 {
        warnings.push(format!(
            "已忽略 {ignored_local} 条本地终端配置；这里只导入 SSH。"
        ));
    }
    if unsupported {
        warnings.push("旧版代理、隧道和环境变量暂不受当前 SSH 连接模型支持，已安全忽略。".into());
    }

    Ok(NormalizedArchive {
        payload: json!({
            "format": "miraihub-connections",
            "version": 1,
            "createdAt": created_at,
            "includesCredentials": includes_credentials,
            "connections": connections,
            "groups": groups,
            "tags": tags,
        }),
        source_format: "YxcrHub 旧版".into(),
        includes_credentials,
        includes_startup_commands,
        warnings,
    })
}

fn normalize(payload: Value) -> AppResult<NormalizedArchive> {
    if payload.get("format").and_then(Value::as_str) == Some("miraihub-connections") {
        normalize_current(payload)
    } else {
        normalize_legacy(payload)
    }
}

fn redact_connection(connection: &mut Value, credentials: bool, startup_commands: bool) {
    let Some(settings) = connection
        .get_mut("settings")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    if !startup_commands {
        settings.insert("startupCommand".into(), Value::String(String::new()));
    }
    let Some(auth) = settings.get_mut("auth").and_then(Value::as_object_mut) else {
        return;
    };
    auth.remove(EMBEDDED_KEY);
    if credentials {
        return;
    }
    if auth.get("type").and_then(Value::as_str) == Some("password") {
        auth.insert("password".into(), Value::String(String::new()));
    } else if auth.get("type").and_then(Value::as_str) == Some("privateKey") {
        auth.insert("path".into(), Value::String(String::new()));
        auth.insert("passphrase".into(), Value::String(String::new()));
    }
}

fn selected_payload(
    mut archive: NormalizedArchive,
    selected_ids: &[String],
    credentials: bool,
    startup_commands: bool,
) -> AppResult<Value> {
    if selected_ids.is_empty() || selected_ids.len() > MAX_CONNECTIONS {
        return Err(invalid("请至少选择一个 SSH 配置"));
    }
    let selected = selected_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    if selected.len() != selected_ids.len() {
        return Err(invalid("选择列表中存在重复连接 ID"));
    }
    let root = archive
        .payload
        .as_object_mut()
        .ok_or_else(|| invalid("SSH 备份无效"))?;
    let (selected_groups, selected_tags) = {
        let source = root
            .get_mut("connections")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| invalid("SSH 配置列表无效"))?;
        source.retain(|value| {
            value
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| selected.contains(id))
        });
        if source.len() != selected.len() {
            return Err(invalid("选择的 SSH 配置已不存在，请重新读取文件"));
        }

        let mut imported_keys = HashMap::<String, String>::new();
        for connection in source.iter_mut() {
            let auth = connection
                .pointer_mut("/settings/auth")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| invalid("SSH 认证配置无效"))?;
            let embedded = auth
                .remove(EMBEDDED_KEY)
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default();
            if credentials && !embedded.is_empty() {
                let path = if let Some(path) = imported_keys.get(&embedded) {
                    path.clone()
                } else {
                    let path = keys::import_private_key(&embedded)
                        .map_err(AppError::from)?
                        .display()
                        .to_string();
                    imported_keys.insert(embedded, path.clone());
                    path
                };
                auth.insert("path".into(), Value::String(path));
            }
            redact_connection(connection, credentials, startup_commands);
        }

        let selected_groups = source
            .iter()
            .filter_map(|value| value.get("group").and_then(Value::as_str))
            .map(str::to_owned)
            .collect::<HashSet<_>>();
        let selected_tags = source
            .iter()
            .filter_map(|value| value.get("tags").and_then(Value::as_array))
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect::<HashSet<_>>();
        (selected_groups, selected_tags)
    };
    if let Some(groups) = root.get_mut("groups").and_then(Value::as_array_mut) {
        groups.retain(|value| {
            value
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| selected_groups.contains(name))
        });
    }
    if let Some(tags) = root.get_mut("tags").and_then(Value::as_array_mut) {
        tags.retain(|value| {
            value
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| selected_tags.contains(name))
        });
    }
    root.insert(
        "includesCredentials".into(),
        Value::Bool(credentials && archive.includes_credentials),
    );
    Ok(archive.payload)
}

fn validate_ssh_payload(payload: &Value) -> AppResult<()> {
    backup::valid_payload(payload)?;
    let connections = payload
        .get("connections")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("SSH 配置列表无效"))?;
    if connections.is_empty() || connections.len() > MAX_CONNECTIONS {
        return Err(invalid("请至少选择一个 SSH 配置"));
    }
    for connection in connections {
        connection_meta(connection)?;
    }
    Ok(())
}

fn embed_private_keys(payload: &mut Value) -> AppResult<()> {
    validate_ssh_payload(payload)?;
    let connections = payload
        .get_mut("connections")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("SSH 配置列表无效"))?;
    for connection in connections {
        let Some(auth) = connection
            .pointer_mut("/settings/auth")
            .and_then(Value::as_object_mut)
        else {
            return Err(invalid("SSH 认证配置无效"));
        };
        // 只接受 Rust 从本机路径读取到的内容，不信任 WebView 构造的内嵌密钥字段。
        auth.remove(EMBEDDED_KEY);
        if auth.get("type").and_then(Value::as_str) != Some("privateKey") {
            continue;
        }
        let path = text(auth.get("path"), "私钥路径", false)?;
        if path.is_empty() {
            continue;
        }
        let metadata = std::fs::metadata(&path)?;
        if !metadata.is_file() || metadata.len() > 1024 * 1024 {
            return Err(invalid(format!("私钥文件无效或过大：{path}")));
        }
        let contents = std::fs::read_to_string(&path)?;
        auth.insert(EMBEDDED_KEY.into(), Value::String(contents));
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_config_backup_preview(
    window: WebviewWindow,
    path: String,
    password: String,
) -> AppResult<SshConfigPreview> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive = normalize(backup::read_archive(Path::new(&path), &password)?)?;
        let connections = archive
            .payload
            .get("connections")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("SSH 配置列表无效"))?
            .iter()
            .map(connection_meta)
            .collect::<AppResult<Vec<_>>>()?;
        Ok(SshConfigPreview {
            source_format: archive.source_format,
            includes_credentials: archive.includes_credentials,
            includes_startup_commands: archive.includes_startup_commands,
            connections,
            warnings: archive.warnings,
        })
    })
    .await
    .map_err(|_| AppError::internal("读取 SSH 配置失败"))?
}

#[tauri::command]
pub async fn ssh_config_backup_import(
    window: WebviewWindow,
    path: String,
    password: String,
    selected_ids: Vec<String>,
    credentials: bool,
    startup_commands: bool,
) -> AppResult<Value> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive = normalize(backup::read_archive(Path::new(&path), &password)?)?;
        selected_payload(archive, &selected_ids, credentials, startup_commands)
    })
    .await
    .map_err(|_| AppError::internal("导入 SSH 配置失败"))?
}

#[tauri::command]
pub async fn ssh_config_backup_write(
    window: WebviewWindow,
    path: String,
    mut payload: Value,
    password: String,
    include_credentials: bool,
) -> AppResult<()> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        backup::valid_payload(&payload)?;
        payload["scope"] = Value::String("ssh".into());
        if include_credentials {
            if password.as_bytes().len() < 10 {
                return Err(invalid("包含密码或私钥时，备份密码至少需要 10 字节"));
            }
            embed_private_keys(&mut payload)?;
            payload["includesCredentials"] = Value::Bool(true);
        } else {
            validate_ssh_payload(&payload)?;
            let connections = payload
                .get_mut("connections")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| invalid("SSH 配置列表无效"))?;
            for connection in connections {
                redact_connection(connection, false, false);
            }
            payload["includesCredentials"] = Value::Bool(false);
        }
        let bytes = backup::pack(payload, if include_credentials { &password } else { "" })?;
        backup::write_archive(Path::new(&path), &bytes)
    })
    .await
    .map_err(|_| AppError::internal("导出 SSH 配置失败"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy() -> Value {
        json!({
            "type": "YxcrHub.ssh-configs",
            "version": 1,
            "exportedAt": "2026-09-07T08:36:35.131Z",
            "configs": [
                {
                    "id": "ssh-1", "name": "Server", "host": "server.example", "port": "22",
                    "username": "root", "groupId": "group-1", "note": "legacy", "env": "prod",
                    "colorTag": "green", "authType": "password", "password": "secret",
                    "privateKey": "", "passphrase": "", "tunnels": [], "envVars": [],
                    "proxy": { "type": "none" },
                    "advanced": { "timeout": "10", "keepalive": "60", "initCommand": "pwd", "startupScript": "" }
                },
                { "id": "local-1", "kind": "local" }
            ],
            "groups": [{ "id": "group-1", "name": "Production" }]
        })
    }

    #[test]
    fn legacy_archives_are_normalized_without_local_terminals() {
        let normalized = normalize_legacy(legacy()).unwrap();
        assert_eq!(
            normalized.payload["connections"].as_array().unwrap().len(),
            1
        );
        assert_eq!(normalized.payload["connections"][0]["group"], "Production");
        assert_eq!(normalized.payload["connections"][0]["port"], 22);
        assert_eq!(
            normalized.payload["connections"][0]["settings"]["startupCommand"],
            "pwd"
        );
        assert!(normalized.includes_credentials);
        assert!(normalized.includes_startup_commands);
        assert_eq!(normalized.warnings.len(), 1);
    }

    #[test]
    fn basic_import_strips_credentials_and_commands() {
        let normalized = normalize_legacy(legacy()).unwrap();
        let selected = selected_payload(normalized, &["ssh-1".into()], false, false).unwrap();
        assert_eq!(
            selected["connections"][0]["settings"]["auth"]["password"],
            ""
        );
        assert_eq!(selected["connections"][0]["settings"]["startupCommand"], "");
        assert_eq!(selected["includesCredentials"], false);
    }
}
