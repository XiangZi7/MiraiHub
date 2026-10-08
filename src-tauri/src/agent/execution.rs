//! Execution facts displayed in the UI. Never infer task success from model prose.
use super::{clip, now, policy::Action};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub statement: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub elapsed_ms: u64,
    pub truncated: bool,
    pub error: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Metric {
    pub name: String,
    pub value: String,
    pub unit: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub label: String,
    pub command: String,
    pub reason: String,
    pub status: String,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub results: Vec<QueryResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metrics: Vec<Metric>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_change: Option<super::files::FileChange>,
}

pub struct Output {
    pub text: String,
    pub exit_code: Option<i64>,
    pub value: Option<Value>,
}
impl Output {
    pub fn from_value(value: Value) -> Self {
        Self {
            exit_code: value.get("exitCode").and_then(Value::as_i64),
            text: clip(&value.to_string(), 16384),
            value: Some(value),
        }
    }
}
impl Operation {
    pub fn start(id: &str, action: &Action) -> Self {
        let (command, reason) = action.approval_details();
        Self {
            id: id.into(),
            label: action.label().into(),
            command,
            reason,
            status: "running".into(),
            started_at: now(),
            duration_ms: None,
            exit_code: None,
            results: Vec::new(),
            metrics: Vec::new(),
            file_change: action.file_change(),
        }
    }
    pub fn finish(&mut self, action: &Action, result: &AppResult<Output>, duration_ms: u64) {
        self.duration_ms = Some(duration_ms);
        self.exit_code = result.as_ref().ok().and_then(|output| output.exit_code);
        if let Ok(output) = result {
            if let Some(value) = &output.value {
                if let Action::Sql { .. } = action {
                    self.results = query_results(value);
                    if let Some(ms) = value["elapsedMs"].as_u64() {
                        self.metrics.push(Metric {
                            name: "查询耗时".into(),
                            value: ms.to_string(),
                            unit: "ms".into(),
                        });
                    }
                }
                self.metrics.extend(shell_metrics(action, value));
            }
        }
        self.status = match result {
            Err(_) => "failed",
            Ok(output)
                if output.value.as_ref().is_some_and(|v| {
                    v["cancelled"] == true
                        || v["statements"]
                            .as_array()
                            .is_some_and(|rows| rows.iter().any(|r| r["error"].is_string()))
                }) =>
            {
                "failed"
            }
            Ok(_) => match self.exit_code {
                Some(0) => "completed",
                Some(_) => "failed",
                None if matches!(action, Action::Shell { .. } | Action::Probe(_)) => "unknown",
                None => "completed",
            },
        }
        .into();
    }
}

fn query_results(value: &Value) -> Vec<QueryResult> {
    let mut budget = 64000usize;
    value["statements"]
        .as_array()
        .into_iter()
        .flatten()
        .take(8)
        .filter_map(|statement| {
            let columns = statement["columns"].as_array()?;
            if columns.is_empty() || columns.len() > 64 {
                return None;
            }
            let names: Vec<String> = columns
                .iter()
                .map(|c| clip(c["name"].as_str().unwrap_or(""), 256))
                .collect();
            let mut rows = Vec::new();
            let mut shortened = statement["truncated"].as_bool().unwrap_or(false);
            shortened |= statement["rows"].as_array().is_some_and(|r| r.len() > 20);
            for row in statement["rows"].as_array().into_iter().flatten().take(20) {
                let row: Vec<Option<String>> = row
                    .as_array()?
                    .iter()
                    .map(|v| v.as_str().map(str::to_owned))
                    .collect();
                if row.len() != names.len() {
                    shortened = true;
                    continue;
                }
                let size: usize = row.iter().flatten().map(String::len).sum();
                if size > budget {
                    shortened = true;
                    break;
                }
                budget -= size;
                rows.push(row);
            }
            Some(QueryResult {
                statement: clip(statement["statement"].as_str().unwrap_or(""), 8192),
                columns: names,
                rows,
                elapsed_ms: statement["elapsedMs"].as_u64().unwrap_or(0),
                truncated: shortened,
                error: statement["error"].as_str().map(str::to_owned),
            })
        })
        .collect()
}
fn shell_metrics(action: &Action, value: &Value) -> Vec<Metric> {
    let stdout = value["stdout"].as_str().unwrap_or("");
    let mut metrics = Vec::new();
    let command = action.approval_details().0;
    // Combined commands and substitutions can change what stdout represents.
    if command.contains(['\n', ';', '|', '&', '`', '$', '<', '>']) {
        return metrics;
    }
    let words: Vec<_> = command.split_whitespace().collect();
    if words.get(0) == Some(&"systemctl") && words.get(1) == Some(&"status") {
        if let Some(active) = stdout
            .lines()
            .find_map(|line| line.trim().strip_prefix("Active: "))
        {
            metrics.push(Metric {
                name: "服务状态".into(),
                value: active.split(';').next().unwrap_or(active).trim().into(),
                unit: String::new(),
            });
        }
    }
    if words.get(0) == Some(&"curl") && command.contains("%{http_code}") {
        let code = stdout.trim();
        if code.len() == 3 && code.bytes().all(|c| c.is_ascii_digit()) {
            metrics.push(Metric {
                name: "HTTP 状态码".into(),
                value: code.into(),
                unit: String::new(),
            });
        }
    }
    if matches!(action, Action::Probe(p) if p == "disk") {
        for line in stdout.lines().skip(1).take(16) {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() == 6 && fields[4].ends_with('%') {
                metrics.push(Metric {
                    name: format!("磁盘使用率 {}", fields[5]),
                    value: fields[4].trim_end_matches('%').into(),
                    unit: "%".into(),
                });
            }
        }
    }
    metrics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use serde_json::json;

    #[test]
    fn exit_status_is_preserved_before_large_output_is_clipped() {
        let output = Output::from_value(json!({"stdout":"x".repeat(20000),"exitCode":7}));
        assert_eq!(output.exit_code, Some(7));
        assert!(output.text.ends_with("[输出已截断]"));
        let action = Action::Shell {
            command: "false".into(),
            reason: "check".into(),
        };
        let mut operation = Operation::start("one", &action);
        operation.finish(&action, &Ok(output), 42);
        assert_eq!(operation.status, "failed");
        assert_eq!(operation.duration_ms, Some(42));
        operation.finish(
            &action,
            &Ok(Output::from_value(json!({"exitCode":null}))),
            44,
        );
        assert_eq!(operation.status, "unknown");
        operation.finish(&action, &Err(AppError::internal("connection lost")), 45);
        assert_eq!(operation.status, "failed");
    }

    #[test]
    fn old_history_entries_remain_readable() {
        let entry: super::super::Entry =
            serde_json::from_value(json!({"role":"tool","text":"old","detail":"{}"})).unwrap();
        assert!(entry.operation.is_none());
    }
    #[test]
    fn sql_errors_and_partial_results_are_not_reported_as_success() {
        let action = Action::Sql {
            sql: "SELECT count FROM orders".into(),
            reason: "test".into(),
        };
        let value = json!({"elapsedMs":32,"cancelled":false,"statements":[{"statement":"SELECT count FROM orders","columns":[{"name":"count"}],"rows":[["7"],[null]],"elapsedMs":30,"truncated":true,"error":"connection lost"}]});
        let mut operation = Operation::start("sql", &action);
        operation.finish(&action, &Ok(Output::from_value(value)), 35);
        assert_eq!(operation.status, "failed");
        assert_eq!(operation.results[0].rows[0][0].as_deref(), Some("7"));
        assert!(operation.results[0].rows[1][0].is_none());
        assert!(operation.results[0].truncated);
        assert_eq!(operation.metrics[0].value, "32");
    }
    #[test]
    fn query_display_budget_never_slices_cells_or_loses_the_truncation_notice() {
        let value = json!({"statements":[{"columns":[{"name":"payload"}],"rows":[["x".repeat(64000)],["y"]],"elapsedMs":1,"truncated":false}]});
        let results = query_results(&value);
        assert_eq!(results[0].rows.len(), 1);
        assert_eq!(results[0].rows[0][0].as_ref().unwrap().len(), 64000);
        assert!(results[0].truncated);
    }
    #[test]
    fn observed_metrics_are_extracted_only_from_matching_commands() {
        let shell = Action::Shell {
            command: "systemctl status nginx --no-pager".into(),
            reason: "test".into(),
        };
        let metrics = shell_metrics(
            &shell,
            &json!({"stdout":" Active: active (running); since Thu\n"}),
        );
        assert_eq!(metrics[0].value, "active (running)");
        let other = Action::Shell {
            command: "echo hello".into(),
            reason: "test".into(),
        };
        assert!(shell_metrics(&other, &json!({"stdout":"Active: active (running)"})).is_empty());
        let curl = Action::Shell {
            command: "curl -w '%{http_code}' https://example.invalid".into(),
            reason: "test".into(),
        };
        assert_eq!(
            shell_metrics(&curl, &json!({"stdout":"503"}))[0].value,
            "503"
        );
        assert!(shell_metrics(&curl, &json!({"stdout":"error: 503"})).is_empty());
        let compound = Action::Shell {
            command: "curl -w '%{http_code}' https://example.invalid; echo 503".into(),
            reason: "test".into(),
        };
        assert!(shell_metrics(&compound, &json!({"stdout":"503"})).is_empty());
        let disk = Action::Probe("disk".into());
        let output = json!({"stdout":"Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 50G 45G 5G 90% /\n"});
        let metrics = shell_metrics(&disk, &output);
        assert_eq!(metrics[0].name, "磁盘使用率 /");
        assert_eq!(metrics[0].value, "90");
        assert_eq!(metrics[0].unit, "%");
    }
}
