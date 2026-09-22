//! MCP-shaped tool registry.
//!
//! Built-in SSH / database / Redis tools and tools discovered from external MCP
//! servers are both expressed as `ToolSpec`. `definitions()` renders them back into
//! the `{type:"function", function:{...}}` shape the protocol layer already speaks,
//! so the provider adapters do not change.
mod builtin;
mod client;
mod jsonrpc;
pub mod servers;
mod transport;

pub use client::Pool;
pub use servers::{McpServer, McpServerInput, PublicMcpServer};

use crate::error::AppError;
use serde_json::{json, Value};

pub const MAX_SCHEMA_BYTES: usize = 8192;

#[derive(Clone, Debug)]
pub enum ToolSource {
    Builtin,
    External {
        server_id: String,
        server_name: String,
        remote_name: String,
        description: String,
    },
}

#[derive(Clone, Debug)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub source: ToolSource,
}

#[derive(Clone, Debug)]
pub struct CallOutcome {
    pub text: String,
    pub is_error: bool,
}

#[derive(Default)]
pub struct Registry {
    tools: Vec<ToolSpec>,
}

impl Registry {
    /// Built-in tools for a connection kind, plus the external servers enabled for it.
    pub fn build(kind: &str, servers: &[McpServer]) -> Self {
        let mut registry = Self {
            tools: builtin::specs(kind),
        };
        for server in servers.iter().filter(|server| server.applies_to(kind)) {
            registry.add_external(server);
        }
        registry
    }

    pub fn get(&self, name: &str) -> Option<&ToolSpec> {
        self.tools.iter().find(|tool| tool.name == name)
    }

    /// The shape `policy::definitions` used to return, so protocol conversion is untouched.
    pub fn definitions(&self) -> Value {
        Value::Array(
            self.tools
                .iter()
                .map(|tool| {
                    json!({"type":"function","function":{
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    }})
                })
                .collect(),
        )
    }

    fn add_external(&mut self, server: &McpServer) {
        for tool in &server.tools {
            let Some(remote_name) = tool["name"].as_str() else {
                continue;
            };
            let Some(schema) = sanitize_schema(&tool["inputSchema"]) else {
                continue;
            };
            let Some(name) = self.unique_name(&external_name(&server.name, remote_name)) else {
                continue;
            };
            let description = tool["description"].as_str().unwrap_or("").to_owned();
            self.tools.push(ToolSpec {
                name,
                description: clip(&description, 1024),
                input_schema: schema,
                source: ToolSource::External {
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    remote_name: remote_name.to_owned(),
                    description,
                },
            });
        }
    }

    fn unique_name(&self, base: &str) -> Option<String> {
        if self.get(base).is_none() {
            return Some(base.to_owned());
        }
        for suffix in 2..100 {
            let candidate = format!("{base}-{suffix}");
            if candidate.len() <= 64 && self.get(&candidate).is_none() {
                return Some(candidate);
            }
        }
        None
    }
}

/// `mcp__{server slug}__{remote tool}`, reduced to the function-name alphabet providers accept.
fn external_name(server: &str, remote: &str) -> String {
    let mut name = format!("mcp__{}__{}", slug(server), slug(remote));
    if name.len() > 64 {
        name.truncate(64);
    }
    name
}

fn slug(value: &str) -> String {
    let mut slug: String = value
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '_' || char == '-' {
                char
            } else {
                '_'
            }
        })
        .collect();
    if slug.is_empty() || !slug.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
        slug.insert(0, 's');
    }
    slug
}

/// Providers disagree on `$ref` and definitions, so only a plain object schema is forwarded.
pub fn sanitize_schema(schema: &Value) -> Option<Value> {
    if schema["type"] != "object" {
        return None;
    }
    let mut clean = schema.clone();
    if let Some(object) = clean.as_object_mut() {
        object.remove("$ref");
        object.remove("$defs");
        object.remove("definitions");
    }
    if serde_json::to_vec(&clean)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
        > MAX_SCHEMA_BYTES
    {
        return None;
    }
    Some(clean)
}

pub fn clip(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_owned();
    }
    format!("{}…", value.chars().take(max).collect::<String>())
}

pub fn jsonrpc_error(error: &Value) -> AppError {
    let code = error["code"].as_i64().unwrap_or(0);
    let message = error["message"].as_str().unwrap_or("MCP 服务返回错误");
    AppError::internal(format!("MCP 错误 {code}：{}", clip(message, 500)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(name: &str, tools: Value) -> McpServer {
        McpServer {
            id: "server-1".into(),
            name: name.into(),
            enabled: true,
            transport: servers::Transport::Stdio,
            command: "server".into(),
            args: Vec::new(),
            env: Vec::new(),
            url: String::new(),
            headers: Vec::new(),
            targets: Vec::new(),
            tools: tools.as_array().cloned().unwrap_or_default(),
        }
    }

    #[test]
    fn external_names_are_sanitized_and_collisions_get_a_suffix() {
        let tools = json!([
            {"name":"list files","description":"lists",
             "inputSchema":{"type":"object","properties":{"path":{"type":"string"}}}},
            {"name":"list files","description":"again",
             "inputSchema":{"type":"object"}},
            {"name":"broken","inputSchema":{"type":"string"}},
        ]);
        let registry = Registry::build("ssh", &[server("My Server", tools)]);
        let names: Vec<_> = registry
            .definitions()
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap().to_owned())
            .collect();
        assert!(names.contains(&"server_status".to_owned()));
        assert!(names.contains(&"mcp__My_Server__list_files".to_owned()));
        assert!(names.contains(&"mcp__My_Server__list_files-2".to_owned()));
        assert!(!names.iter().any(|name| name.contains("broken")));
    }

    #[test]
    fn oversized_and_referential_schemas_are_dropped() {
        let mut schema = json!({"type":"object","$ref":"#/defs","properties":{}});
        schema["properties"]["blob"] = json!({"type":"string","description":"x".repeat(9000)});
        assert!(sanitize_schema(&schema).is_none());
        let clean = sanitize_schema(&json!({"type":"object","$defs":{},"properties":{}})).unwrap();
        assert!(clean.get("$defs").is_none());
        assert!(sanitize_schema(&json!({"type":"array"})).is_none());
    }

    #[test]
    fn servers_are_filtered_by_target() {
        let mut scoped = server(
            "db",
            json!([{"name":"query","inputSchema":{"type":"object"}}]),
        );
        scoped.targets = vec!["database".into()];
        let registry = Registry::build("ssh", &[scoped]);
        assert!(registry.get("mcp__db__query").is_none());
        assert!(registry.get("server_status").is_some());
    }
}
