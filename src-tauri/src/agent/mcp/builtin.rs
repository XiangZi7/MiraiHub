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
                "Provide an EXACT shell command. The backend applies the user's approval mode. Explain effects and risks. Never claim it ran before a tool result.",
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
                "Provide exact SQL for the selected database. The backend applies the user's approval mode, including for SELECT or EXPLAIN because SQL can have side effects. Explain effects and returned data. Use LIMIT for reads.",
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
                "Provide one EXACT Redis command with quoted/escaped arguments. All custom commands require approval in Ask/Auto. Explain effects and returned data. Prefer bounded ranges and SCAN over KEYS. Connection-state commands, SELECT, AUTH, transactions and subscriptions are unavailable. The selected database is fixed; each tool uses an independent connection. Writes are immediate and not rolled back.",
                json!({"command":{"type":"string"},"reason":{"type":"string"}}),
                json!(["command", "reason"]),
            ),
        ],
        _ => Vec::new(),
    }
}
