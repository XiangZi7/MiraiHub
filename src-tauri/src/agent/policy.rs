use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalMode {
    Ask,
    #[default]
    Auto,
    Full,
}
impl ApprovalMode {
    pub fn requires_approval(self, action: &Action) -> bool {
        match self {
            Self::Ask => true,
            Self::Auto => match action {
                Action::Shell { command, .. } => !super::read_only::shell(command),
                Action::Sql { sql, .. } => !super::read_only::sql(sql),
                Action::RedisCommand { .. } => true,
                _ => false,
            },
            Self::Full => false,
        }
    }
    pub fn instruction(self) -> &'static str {
        match self {
            Self::Ask => "The user selected Ask: every tool call, including fixed read-only probes and metadata, requires single-use human approval.",
            Self::Auto => "The user selected Auto: fixed probes, common read-only diagnostics and simple SQL metadata checks, Redis key scans and bounded key previews run automatically. All custom Redis commands require single-use human approval in Auto mode. Prefer simple bounded commands, for example command -v pm2 && pm2 --version, ls -lah, ps aux, df -h, systemctl status NAME --no-pager, journalctl -u NAME -n 100 --no-pager, and tail -n 100 /var/log/FILE. Mutations, unknown commands/flags, arbitrary SQL, sensitive file reads, redirects and shell substitutions require single-use human approval. Do not split or disguise an operation to bypass approval; the backend classifies the exact command, not your explanation.",
            Self::Full => "The user selected Full access for this turn on the current connection: the provided tools, including custom shell, SQL and Redis commands, run without a separate approval. Stay within the user's requested task and the bound target. Do not ask the user to approve tools or claim success without a tool result.",
        }
    }
}

#[derive(Clone, Debug)]
pub enum Action {
    Probe(String),
    Schema { schema: String, table: String },
    Shell { command: String, reason: String },
    Sql { sql: String, reason: String },
    RedisScan { cursor: String, pattern: String },
    RedisInspect { key: String },
    RedisCommand { command: String, reason: String },
}
impl Action {
    pub fn approval_details(&self) -> (String, String) {
        match self {
            Self::Probe(probe) => (
                probe_command(probe).unwrap_or("").into(),
                "读取服务器的固定状态信息".into(),
            ),
            Self::Schema { schema, table } => (
                json!({"schema":schema,"table":table}).to_string(),
                "读取当前数据库的对象和字段结构".into(),
            ),
            Self::Shell { command, reason } => (command.clone(), reason.clone()),
            Self::Sql { sql, reason } => (sql.clone(), reason.clone()),
            Self::RedisScan { cursor, pattern } => (
                json!({"command":"SCAN","cursor":cursor,"pattern":pattern,"count":100}).to_string(),
                "扫描当前 Redis 数据库中的一批键".into(),
            ),
            Self::RedisInspect { key } => (
                json!({"keyBase64":key,"read":"type, TTL and bounded value preview"}).to_string(),
                "读取 Redis 键类型、TTL 和部分内容".into(),
            ),
            Self::RedisCommand { command, reason } => (command.clone(), reason.clone()),
        }
    }
    pub fn approval(&self) -> Option<(&str, &str)> {
        match self {
            Self::Shell { command, reason } => Some((command, reason)),
            Self::Sql { sql, reason } => Some((sql, reason)),
            Self::RedisCommand { command, reason } => Some((command, reason)),
            _ => None,
        }
    }
    pub fn label(&self) -> &'static str {
        match self {
            Self::Probe(_) => "读取服务器状态",
            Self::Schema { .. } => "读取数据库结构",
            Self::Shell { .. } => "执行 Shell 命令",
            Self::Sql { .. } => "执行 SQL",
            Self::RedisScan { .. } => "扫描 Redis 键",
            Self::RedisInspect { .. } => "读取 Redis 键",
            Self::RedisCommand { .. } => "执行 Redis 命令",
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Probe {
    probe: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Schema {
    schema: String,
    table: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Shell {
    command: String,
    reason: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Sql {
    sql: String,
    reason: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RedisScan {
    cursor: String,
    pattern: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RedisInspect {
    key: String,
}
fn parse<T: serde::de::DeserializeOwned>(args: &str) -> AppResult<T> {
    serde_json::from_str(args).map_err(|_| AppError::invalid_input("工具参数不符合后端安全策略"))
}
fn bounded(value: &str, max: usize) -> AppResult<()> {
    if value.trim().is_empty() || value.len()>max || value.chars().any(|c| (c.is_control() && c != '\n' && c != '\t') || matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}')) { Err(AppError::invalid_input("工具参数为空、过长或包含非法字符")) } else { Ok(()) }
}
pub fn classify(kind: &str, name: &str, args: &str) -> AppResult<Action> {
    if args.len() > 20000 {
        return Err(AppError::invalid_input("工具参数过长"));
    }
    match (kind, name) {
        ("ssh", "server_status") => {
            let a: Probe = parse(args)?;
            probe_command(&a.probe)?;
            Ok(Action::Probe(a.probe))
        }
        ("database", "database_schema") => {
            let a: Schema = parse(args)?;
            if a.schema.len() > 256 || a.table.len() > 256 {
                return Err(AppError::invalid_input("对象名称过长"));
            }
            Ok(Action::Schema {
                schema: a.schema,
                table: a.table,
            })
        }
        ("ssh", "propose_shell") => {
            let a: Shell = parse(args)?;
            bounded(&a.command, 8192)?;
            bounded(&a.reason, 2000)?;
            Ok(Action::Shell {
                command: a.command,
                reason: a.reason,
            })
        }
        ("database", "propose_sql") => {
            let a: Sql = parse(args)?;
            bounded(&a.sql, 8192)?;
            bounded(&a.reason, 2000)?;
            Ok(Action::Sql {
                sql: a.sql,
                reason: a.reason,
            })
        }
        ("redis", "redis_scan") => {
            let a: RedisScan = parse(args)?;
            if a.cursor.parse::<u64>().is_err() || a.pattern.len() > 4096 {
                return Err(AppError::invalid_input("Redis 扫描参数无效"));
            }
            Ok(Action::RedisScan {
                cursor: a.cursor,
                pattern: a.pattern,
            })
        }
        ("redis", "redis_inspect") => {
            let a: RedisInspect = parse(args)?;
            use base64::Engine;
            if a.key.len() > 8192
                || base64::engine::general_purpose::STANDARD
                    .decode(&a.key)
                    .is_err()
            {
                return Err(AppError::invalid_input("Redis 键标识无效"));
            }
            Ok(Action::RedisInspect { key: a.key })
        }
        ("redis", "propose_redis") => {
            let a: Shell = parse(args)?;
            bounded(&a.command, 8192)?;
            bounded(&a.reason, 2000)?;
            crate::redis_db::validate_agent_command(&a.command)?;
            Ok(Action::RedisCommand {
                command: a.command,
                reason: a.reason,
            })
        }
        _ => Err(AppError::invalid_input(
            "未知工具或工具与当前连接类型不匹配，已阻止执行",
        )),
    }
}
// No user/model text is interpolated into these commands. Absolute paths and a
// fresh environment avoid PATH injection; output is still untrusted remote data.
pub fn probe_command(probe: &str) -> AppResult<&'static str> {
    match probe {
        "system" => Ok("/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C /bin/sh -c '/usr/bin/uname -a; /usr/bin/uptime; /usr/bin/free -m'"),
        "disk" => Ok("/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C /bin/df -h"),
        "processes" => Ok("/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C /bin/ps -eo pid,ppid,comm,%cpu,%mem --sort=-%cpu"),
        "network" => Ok("/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C /usr/bin/ss -s"),
        _ => Err(AppError::invalid_input("只读探针不在允许列表中")),
    }
}
pub fn definitions(kind: &str) -> Value {
    let tool = |name: &str, description: &str, properties: Value, required: Value| json!({"type":"function","function":{"name":name,"description":description,"parameters":{"type":"object","properties":properties,"required":required,"additionalProperties":false}}});
    if kind == "ssh" {
        json!([
        tool("server_status","Run a fixed Linux read-only probe under the user's approval mode. No file contents, secrets or environment variables.",json!({"probe":{"type":"string","enum":["system","disk","processes","network"]}}),json!(["probe"])),
        tool("propose_shell","Provide an EXACT shell command. The backend applies the user's approval mode. Explain effects and risks. Never claim it ran before a tool result.",json!({"command":{"type":"string"},"reason":{"type":"string"}}),json!(["command","reason"]))
    ])
    } else if kind == "database" {
        json!([
        tool("database_schema","Read metadata only. Empty schema and table lists objects; supply both for column structure. No row data.",json!({"schema":{"type":"string"},"table":{"type":"string"}}),json!(["schema","table"])),
        tool("propose_sql","Provide exact SQL for the selected database. The backend applies the user's approval mode, including for SELECT or EXPLAIN because SQL can have side effects. Explain effects and returned data. Use LIMIT for reads.",json!({"sql":{"type":"string"},"reason":{"type":"string"}}),json!(["sql","reason"]))
    ])
    } else if kind == "redis" {
        json!([
            tool("redis_scan", "Scan one batch of keys in the bound Redis database with SCAN COUNT 100. Start cursor at string 0; continue using the returned cursor until it is 0. Empty batches and duplicates are possible. pattern is a Redis glob, usually *. Key id is base64 of raw bytes; retain it for redis_inspect.", json!({"cursor":{"type":"string"},"pattern":{"type":"string"}}), json!(["cursor","pattern"])),
            tool("redis_inspect", "Read one key's type, TTL, length and bounded value preview. key must be the exact base64 id returned by redis_scan, including for binary keys. No writes. Results may be truncated or expire concurrently.", json!({"key":{"type":"string"}}), json!(["key"])),
            tool("propose_redis", "Provide one EXACT Redis command with quoted/escaped arguments. All custom commands require approval in Ask/Auto. Explain effects and returned data. Prefer bounded ranges and SCAN over KEYS. Connection-state commands, SELECT, AUTH, transactions and subscriptions are unavailable. The selected database is fixed; each tool uses an independent connection. Writes are immediate and not rolled back.", json!({"command":{"type":"string"},"reason":{"type":"string"}}), json!(["command","reason"]))
        ])
    } else {
        json!([])
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redis_tools_preserve_exact_arguments_and_enforce_approval_modes() {
        for (name, args, custom) in [
            (
                "redis_scan",
                json!({"cursor":"18446744073709551615","pattern":"user:*"}),
                false,
            ),
            ("redis_inspect", json!({"key":"YQBi"}), false),
            ("redis_inspect", json!({"key":""}), false),
            (
                "propose_redis",
                json!({"command":"SET 'key name' 'value' EX 60","reason":"write a key"}),
                true,
            ),
            (
                "propose_redis",
                json!({"command":"EVAL 'return redis.call(\"DEL\", KEYS[1])' 1 key","reason":"read-only"}),
                true,
            ),
        ] {
            let action = classify("redis", name, &args.to_string()).unwrap();
            assert!(ApprovalMode::Ask.requires_approval(&action));
            assert_eq!(ApprovalMode::Auto.requires_approval(&action), custom);
            assert!(!ApprovalMode::Full.requires_approval(&action));
            if custom {
                assert_eq!(
                    action.approval_details().0,
                    args["command"].as_str().unwrap()
                );
            }
            assert!(classify("database", name, &args.to_string()).is_err());
            assert!(classify("ssh", name, &args.to_string()).is_err());
        }
        for (name, args) in [
            (
                "redis_scan",
                json!({"cursor":"18446744073709551616","pattern":"*"}),
            ),
            (
                "redis_scan",
                json!({"cursor":"0","pattern":"*","command":"FLUSHDB"}),
            ),
            ("redis_inspect", json!({"key":"not base64"})),
            ("propose_sql", json!({"sql":"SELECT 1","reason":"test"})),
            ("propose_shell", json!({"command":"id","reason":"test"})),
        ] {
            assert!(classify("redis", name, &args.to_string()).is_err());
        }
        for command in [
            "SELECT 2",
            "AUTH secret",
            "HELLO 3",
            "MULTI",
            "SUBSCRIBE channel",
            "CLIENT REPLY OFF",
        ] {
            assert!(classify(
                "redis",
                "propose_redis",
                &json!({"command":command,"reason":"read-only"}).to_string()
            )
            .is_err());
        }
        let names = definitions("redis")
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(names, ["redis_scan", "redis_inspect", "propose_redis"]);
        assert_eq!(definitions("unknown"), json!([]));
    }
    #[test]
    fn approval_modes_cover_every_action_and_unknown_modes_fail_closed() {
        let actions = [
            Action::Probe("disk".into()),
            Action::Schema {
                schema: "public".into(),
                table: "users".into(),
            },
            Action::Shell {
                command: "touch /tmp/test".into(),
                reason: "test".into(),
            },
            Action::Sql {
                sql: "DELETE FROM test".into(),
                reason: "test".into(),
            },
        ];
        assert_eq!(ApprovalMode::default(), ApprovalMode::Auto);
        assert!(serde_json::from_str::<ApprovalMode>("\"unknown\"").is_err());
        for (index, action) in actions.iter().enumerate() {
            assert!(ApprovalMode::Ask.requires_approval(action));
            assert_eq!(ApprovalMode::Auto.requires_approval(action), index >= 2);
            assert!(!ApprovalMode::Full.requires_approval(action));
            let (command, reason) = action.approval_details();
            assert!(!command.is_empty() && !reason.is_empty());
        }
    }
    #[test]
    fn arbitrary_code_always_needs_approval() {
        for command in [
            "ls",
            "echo ok; rm -rf /",
            "$(touch /tmp/x)",
            "cat ~/.ssh/id_rsa",
            "sudo reboot",
        ] {
            let a = classify(
                "ssh",
                "propose_shell",
                &json!({"command":command,"reason":"test"}).to_string(),
            )
            .unwrap();
            assert!(a.approval().is_some());
        }
        for sql in [
            "SELECT 1",
            "SELECT dangerous_function()",
            "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
            "SELECT 1 INTO OUTFILE '/tmp/x'",
            "DROP TABLE users",
        ] {
            assert!(classify(
                "database",
                "propose_sql",
                &json!({"sql":sql,"reason":"test"}).to_string()
            )
            .unwrap()
            .approval()
            .is_some());
        }
    }
    #[test]
    fn auto_mode_uses_exact_commands_and_never_the_models_risk_description() {
        for (command, expected) in [
            ("command -v pm2 && pm2 --version", false),
            ("ls -lah /srv/app", false),
            ("pm2 restart app", true),
            ("ls && rm file", true),
        ] {
            let action = classify(
                "ssh",
                "propose_shell",
                &json!({"command":command,"reason":"This is completely read-only"}).to_string(),
            )
            .unwrap();
            assert_eq!(
                ApprovalMode::Auto.requires_approval(&action),
                expected,
                "{command}"
            );
            assert!(ApprovalMode::Ask.requires_approval(&action));
        }
    }
    #[test]
    fn tools_fail_closed() {
        for (kind, name, args) in [
            ("ssh", "server_status", r#"{"probe":"disk; touch /tmp/x"}"#),
            (
                "ssh",
                "server_status",
                r#"{"probe":"disk","command":"rm -rf /"}"#,
            ),
            (
                "database",
                "propose_shell",
                r#"{"command":"id","reason":"test"}"#,
            ),
            ("ssh", "approve", "{}"),
            (
                "ssh",
                "server_status",
                r#"{"probe":"disk","probe":"system"}"#,
            ),
        ] {
            assert!(classify(kind, name, args).is_err());
        }
        assert!(classify("ssh", "server_status", r#"{"probe":"disk"}"#)
            .unwrap()
            .approval()
            .is_none());
    }
}
