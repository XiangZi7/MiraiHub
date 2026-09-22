//! MCP server configuration. Secrets live in the same DPAPI-protected file as the
//! AI profiles, and the public view only reports whether a value is set.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_SERVERS: usize = 20;

#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    #[default]
    Stdio,
    Http,
}

/// One secret pair. `value` is what gets stored; the public view never returns it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Secret {
    pub key: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub transport: Transport,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<Secret>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: Vec<Secret>,
    /// Connection kinds this server is offered to. Empty means all of them.
    #[serde(default)]
    pub targets: Vec<String>,
    /// Tools discovered by the last successful probe, so a conversation can start
    /// without reconnecting. Not user input; refreshed by `ai_test_mcp_server`.
    #[serde(default)]
    pub tools: Vec<Value>,
}

impl McpServer {
    pub fn applies_to(&self, kind: &str) -> bool {
        self.enabled
            && (self.targets.is_empty() || self.targets.iter().any(|target| target == kind))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSecret {
    pub key: String,
    pub has_value: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicMcpServer {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub transport: Transport,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<PublicSecret>,
    pub url: String,
    pub headers: Vec<PublicSecret>,
    pub targets: Vec<String>,
    pub tools: Vec<String>,
}

impl McpServer {
    pub fn public(&self) -> PublicMcpServer {
        PublicMcpServer {
            id: self.id.clone(),
            name: self.name.clone(),
            enabled: self.enabled,
            transport: self.transport,
            command: self.command.clone(),
            args: self.args.clone(),
            env: public_secrets(&self.env),
            url: self.url.clone(),
            headers: public_secrets(&self.headers),
            targets: self.targets.clone(),
            tools: self
                .tools
                .iter()
                .filter_map(|tool| tool["name"].as_str().map(str::to_owned))
                .collect(),
        }
    }
}

fn public_secrets(secrets: &[Secret]) -> Vec<PublicSecret> {
    secrets
        .iter()
        .map(|secret| PublicSecret {
            key: secret.key.clone(),
            has_value: !secret.value.is_empty(),
        })
        .collect()
}

/// What the settings page sends. Secret values are omitted when unchanged, so an
/// empty value keeps the stored one unless `clear` is set.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SecretInput {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub clear: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerInput {
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub transport: Transport,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<SecretInput>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: Vec<SecretInput>,
    #[serde(default)]
    pub targets: Vec<String>,
}

pub fn validate(input: McpServerInput, previous: Option<&McpServer>) -> AppResult<McpServer> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(AppError::invalid_input(
            "请填写 MCP 服务器名称（最多 80 字）",
        ));
    }
    for target in &input.targets {
        if !matches!(target.as_str(), "ssh" | "database" | "redis") {
            return Err(AppError::invalid_input("MCP 服务器的适用目标无效"));
        }
    }
    let (command, args, env, url, headers) = match input.transport {
        Transport::Stdio => {
            let command = input.command.trim();
            if command.is_empty()
                || command.chars().count() > 512
                || command.chars().any(char::is_control)
            {
                return Err(AppError::invalid_input(
                    "请填写启动命令（最多 512 字符，不能含控制字符）",
                ));
            }
            if input.args.len() > 32 || input.args.iter().any(|arg| arg.chars().count() > 1024) {
                return Err(AppError::invalid_input(
                    "启动参数最多 32 项，每项最多 1024 字符",
                ));
            }
            (
                command.to_owned(),
                input.args,
                merge_secrets(input.env, previous.map(|server| server.env.as_slice()))?,
                String::new(),
                Vec::new(),
            )
        }
        Transport::Http => {
            let url = super::super::config::validate_url(input.url.trim())?.to_string();
            (
                String::new(),
                Vec::new(),
                Vec::new(),
                url.trim_end_matches('/').to_owned(),
                merge_secrets(
                    input.headers,
                    previous.map(|server| server.headers.as_slice()),
                )?,
            )
        }
    };
    Ok(McpServer {
        id: input.id.unwrap_or_default(),
        name: name.to_owned(),
        enabled: input.enabled,
        transport: input.transport,
        command,
        args,
        env,
        url,
        headers,
        targets: input.targets,
        tools: previous
            .map(|server| server.tools.clone())
            .unwrap_or_default(),
    })
}

fn merge_secrets(input: Vec<SecretInput>, previous: Option<&[Secret]>) -> AppResult<Vec<Secret>> {
    if input.len() > 32 {
        return Err(AppError::invalid_input("环境变量或请求头最多 32 项"));
    }
    let mut merged = Vec::with_capacity(input.len());
    for secret in input {
        if !is_key(&secret.key) {
            return Err(AppError::invalid_input(
                "环境变量或请求头的名称无效（字母、数字与下划线，且不能以数字开头）",
            ));
        }
        if secret.value.chars().count() > 4096 || secret.value.chars().any(char::is_control) {
            return Err(AppError::invalid_input(
                "环境变量或请求头的值过长或含控制字符",
            ));
        }
        let value = if secret.clear {
            String::new()
        } else if secret.value.is_empty() {
            previous
                .and_then(|secrets| secrets.iter().find(|stored| stored.key == secret.key))
                .map(|stored| stored.value.clone())
                .unwrap_or_default()
        } else {
            secret.value
        };
        merged.push(Secret {
            key: secret.key,
            value,
        });
    }
    Ok(merged)
}

fn is_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && key.len() <= 128
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> McpServerInput {
        McpServerInput {
            id: None,
            name: " Files ".into(),
            enabled: true,
            transport: Transport::Stdio,
            command: " npx ".into(),
            args: vec!["-y".into(), "server".into()],
            env: vec![SecretInput {
                key: "TOKEN".into(),
                value: "secret-value".into(),
                clear: false,
            }],
            url: String::new(),
            headers: Vec::new(),
            targets: vec!["ssh".into()],
        }
    }

    #[test]
    fn validates_bounds_and_never_publishes_secret_values() {
        let server = validate(input(), None).unwrap();
        assert_eq!(server.command, "npx");
        assert_eq!(server.name, "Files");
        let public = serde_json::to_value(server.public()).unwrap();
        assert_eq!(public["env"][0]["hasValue"], true);
        assert!(public["env"][0].get("value").is_none());
        assert!(!public.to_string().contains("secret-value"));

        let mut broken = input();
        broken.command = "bad\ncommand".into();
        assert!(validate(broken, None).is_err());
        let mut broken = input();
        broken.env[0].key = "1TOKEN".into();
        assert!(validate(broken, None).is_err());
        let mut broken = input();
        broken.targets = vec!["email".into()];
        assert!(validate(broken, None).is_err());
    }

    #[test]
    fn blank_secret_keeps_the_stored_value_until_cleared() {
        let stored = validate(input(), None).unwrap();
        let mut update = input();
        update.env[0].value.clear();
        let kept = validate(update, Some(&stored)).unwrap();
        assert_eq!(kept.env[0].value, "secret-value");
        let mut update = input();
        update.env[0].value.clear();
        update.env[0].clear = true;
        assert!(validate(update, Some(&stored)).unwrap().env[0]
            .value
            .is_empty());
    }

    #[test]
    fn http_servers_reuse_the_api_url_rules() {
        let mut http = input();
        http.transport = Transport::Http;
        http.url = "https://mcp.example/rpc".into();
        http.headers = vec![SecretInput {
            key: "Authorization".into(),
            value: "Bearer token".into(),
            clear: false,
        }];
        let server = validate(http, None).unwrap();
        assert_eq!(server.url, "https://mcp.example/rpc");
        assert!(server.command.is_empty());

        let mut http = input();
        http.transport = Transport::Http;
        http.url = "http://remote.example/rpc".into();
        assert!(validate(http, None).is_err());
    }
}
