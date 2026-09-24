//! The existing SSH / database / Redis tools, expressed as `ToolSpec`.
//!
//! Names are unchanged on purpose: conversations already stored in
//! `ai-conversations/*.bin` replay tool calls by name.
use super::{ToolSource, ToolSpec};
use serde_json::{json, Value};

fn spec(name: &str, description: &str, properties: Value, required: Value) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        description: description.into(),
        input_schema: json!({"type":"object","properties":properties,"required":required,
            "additionalProperties":false}),
        source: ToolSource::Builtin,
    }
}

pub fn specs(kind: &str) -> Vec<ToolSpec> {
    match kind {
        "ssh" => vec![
            spec(
                "server_status",
                "Run a fixed Linux read-only probe under the user's approval mode. No file contents, secrets or environment variables.",
                json!({"probe":{"type":"string","enum":["system","disk","processes","network"]}}),
                json!(["probe"]),
            ),
            spec(
                "propose_shell",
                "Run an EXACT shell command. The backend handles approval: in Full access, call this tool directly without asking for confirmation. Explain effects and risks in reason. Never claim it ran before a tool result.",
                json!({"command":{"type":"string"},"reason":{"type":"string"}}),
                json!(["command", "reason"]),
            ),
        ],
        "database" => vec![
            spec(
                "database_schema",
                "Read metadata only. Empty schema and table lists objects; supply both for column structure. No row data.",
                json!({"schema":{"type":"string"},"table":{"type":"string"}}),
                json!(["schema", "table"]),
            ),
            spec(
                "propose_sql",
                "Run exact SQL for the selected database. The backend handles approval: in Full access, call this tool directly without asking for confirmation. In Auto, only recognized simple read-only metadata checks bypass approval; SELECT and EXPLAIN can have side effects. Explain effects and returned data in reason. Use LIMIT for reads.",
                json!({"sql":{"type":"string"},"reason":{"type":"string"}}),
                json!(["sql", "reason"]),
            ),
        ],
        "redis" => vec![
            spec(
                "redis_scan",
                "Scan one batch of keys in the bound Redis database with SCAN COUNT 100. Start cursor at string 0; continue using the returned cursor until it is 0. Empty batches and duplicates are possible. pattern is a Redis glob, usually *. Key id is base64 of raw bytes; retain it for redis_inspect.",
                json!({"cursor":{"type":"string"},"pattern":{"type":"string"}}),
                json!(["cursor", "pattern"]),
            ),
            spec(
                "redis_inspect",
                "Read one key's type, TTL, length and bounded value preview. key must be the exact base64 id returned by redis_scan, including for binary keys. No writes. Results may be truncated or expire concurrently.",
                json!({"key":{"type":"string"}}),
                json!(["key"]),
            ),
            spec(
                "propose_redis",
                "Run one EXACT Redis command with quoted/escaped arguments. The backend requests approval in Ask/Auto; in Full access, call directly without asking for confirmation. Explain effects and returned data in reason. Prefer bounded ranges and SCAN over KEYS. Connection-state commands, SELECT, AUTH, transactions and subscriptions are unavailable. The selected database is fixed; each tool uses an independent connection. Writes are immediate and not rolled back.",
                json!({"command":{"type":"string"},"reason":{"type":"string"}}),
                json!(["command", "reason"]),
            ),
        ],
        _ => Vec::new(),
    }
}
