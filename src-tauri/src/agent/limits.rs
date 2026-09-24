//! Per-profile budgets for local agent orchestration, independent of provider token windows.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub max_steps: usize,
    pub max_context_kb: usize,
    pub max_messages: usize,
    /// Automatic re-sends of one model request after rate limiting, overload or a
    /// dropped connection. Profiles saved before this setting use the default.
    #[serde(default = "default_max_retries")]
    pub max_retries: usize,
}
const fn default_max_retries() -> usize {
    5
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_steps: 8,
            max_context_kb: 180,
            max_messages: 64,
            max_retries: default_max_retries(),
        }
    }
}
impl Limits {
    pub fn validate(&self) -> AppResult<()> {
        if !(1..=128).contains(&self.max_steps)
            || !(64..=4000).contains(&self.max_context_kb)
            || !(16..=2048).contains(&self.max_messages)
            || self.max_retries > 999
        {
            return Err(AppError::invalid_input("任务容量无效：每轮模型请求须为 1–128 次，上下文须为 64–4000 KB，历史消息须为 16–2048 条，失败重试须为 0–999 次"));
        }
        Ok(())
    }
    pub fn check_request(&self, steps: usize, messages: &[Value]) -> AppResult<()> {
        self.validate()?;
        if steps >= self.max_steps {
            return Err(AppError::invalid_input(format!("本轮已达到 {} 次模型请求上限。可在设置 → AI Agent → 任务容量中调高，再从聊天记录继续此会话。", self.max_steps)));
        }
        self.check_context(messages, None)
    }
    pub fn check_context(&self, messages: &[Value], next: Option<&Value>) -> AppResult<()> {
        self.validate()?;
        let count = messages.len() + usize::from(next.is_some());
        if count > self.max_messages {
            return Err(AppError::invalid_input(format!("已达到 {} 条历史消息上限（含工具结果）。请在设置 → AI Agent → 任务容量中调高，或新建会话。", self.max_messages)));
        }
        let context: Vec<&Value> = messages.iter().chain(next).collect();
        let bytes = serde_json::to_vec(&context)
            .map_err(|_| AppError::internal("无法计算上下文大小"))?
            .len();
        // KB uses decimal bytes, matching the settings control and the previous 180,000-byte limit.
        if bytes > self.max_context_kb * 1000 {
            return Err(AppError::invalid_input(format!("已达到 {} KB 本地上下文容量上限。请在设置 → AI Agent → 任务容量中调高，或新建会话；模型服务仍可能有自己的上下文限制。", self.max_context_kb)));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn expanded_budgets_allow_longer_tool_runs_and_conversations() {
        let standard = Limits::default();
        let expanded = Limits {
            max_steps: 32,
            max_context_kb: 1000,
            max_messages: 256,
            ..Limits::default()
        };
        let message = json!({"role":"user", "content":"查".repeat(70000)});
        assert!(standard
            .check_request(8, &[])
            .unwrap_err()
            .message
            .contains("8 次模型请求"));
        assert!(standard
            .check_request(0, &[message.clone()])
            .unwrap_err()
            .message
            .contains("180 KB"));
        assert!(expanded.check_request(8, &[message]).is_ok());
        let history = vec![json!({"role":"tool", "content":"result"}); 65];
        assert!(standard
            .check_request(0, &history)
            .unwrap_err()
            .message
            .contains("64 条历史消息"));
        assert!(expanded.check_request(31, &history).is_ok());
        assert!(expanded.check_request(32, &history).is_err());
    }
    #[test]
    fn validates_all_ranges_and_counts_the_next_message_before_appending() {
        for invalid in [
            Limits {
                max_steps: 0,
                ..Limits::default()
            },
            Limits {
                max_steps: 129,
                ..Limits::default()
            },
            Limits {
                max_context_kb: 63,
                ..Limits::default()
            },
            Limits {
                max_context_kb: 4001,
                ..Limits::default()
            },
            Limits {
                max_messages: 15,
                ..Limits::default()
            },
            Limits {
                max_messages: 2049,
                ..Limits::default()
            },
            Limits {
                max_retries: 1000,
                ..Limits::default()
            },
        ] {
            assert!(invalid.validate().is_err());
        }
        for retries in [0, 999] {
            let limits = Limits {
                max_retries: retries,
                ..Limits::default()
            };
            assert!(limits.validate().is_ok());
        }
        let history = vec![json!({"role":"assistant","content":"ok"}); 64];
        assert!(Limits::default().check_context(&history, None).is_ok());
        assert!(Limits::default()
            .check_context(&history, Some(&json!({"role":"user","content":"more"})))
            .is_err());
    }
    #[test]
    fn profiles_saved_before_retry_setting_use_the_default() {
        let limits: Limits =
            serde_json::from_str(r#"{"maxSteps":32,"maxContextKb":1000,"maxMessages":256}"#)
                .unwrap();
        assert_eq!(limits.max_retries, 5);
        assert_eq!(
            serde_json::to_value(Limits::default()).unwrap()["maxRetries"],
            5
        );
    }
}
