//! Execution facts displayed in the UI. Never infer task success from model prose.
use super::{clip, now, policy::Action};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
}

pub struct Output {
    pub text: String,
    pub exit_code: Option<i64>,
}
impl Output {
    pub fn from_value(value: Value) -> Self {
        Self {
            exit_code: value.get("exitCode").and_then(Value::as_i64),
            text: clip(&value.to_string(), 16384),
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
        }
    }
    pub fn finish(&mut self, action: &Action, result: &AppResult<Output>, duration_ms: u64) {
        self.duration_ms = Some(duration_ms);
        self.exit_code = result.as_ref().ok().and_then(|output| output.exit_code);
        self.status = match result {
            Err(_) => "failed",
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
}
