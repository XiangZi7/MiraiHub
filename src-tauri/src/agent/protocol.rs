//! Translate wire formats at the boundary; execution policy stays provider independent.
use super::config::{self, ApiFormat, Config};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

pub(super) fn endpoint(config: &Config, resource: &str) -> AppResult<reqwest::Url> {
    let mut url = config::validate_url(&config.base_url)?;
    let mut path = url.path().trim_end_matches('/').to_owned();
    for suffix in ["/chat/completions", "/messages", "/models"] {
        if path.ends_with(suffix) {
            path.truncate(path.len() - suffix.len());
            break;
        }
    }
    if path.is_empty() || (config.api_format == ApiFormat::Anthropic && !path.ends_with("/v1")) {
        path.push_str("/v1");
    }
    url.set_path(&format!("{path}/{resource}"));
    Ok(url)
}
pub(super) fn authenticate(
    config: &Config,
    request: reqwest::RequestBuilder,
) -> reqwest::RequestBuilder {
    match config.api_format {
        ApiFormat::Openai if !config.api_key.is_empty() => request.bearer_auth(&config.api_key),
        ApiFormat::Anthropic => {
            let request = request.header("anthropic-version", "2023-06-01");
            if config.api_key.is_empty() {
                request
            } else {
                request.header("x-api-key", &config.api_key)
            }
        }
        _ => request,
    }
}
fn anthropic_body(config: &Config, messages: &[Value], tools: Option<Value>) -> AppResult<Value> {
    let mut system = Vec::new();
    let mut history: Vec<Value> = Vec::new();
    for message in messages {
        let role = message["role"].as_str().unwrap_or("");
        let text = message["content"].as_str().unwrap_or("");
        if role == "system" || role == "developer" {
            if !text.is_empty() {
                system.push(json!({"type":"text", "text":text}));
            }
            continue;
        }
        let mut blocks = Vec::new();
        let role = match role {
            "tool" => {
                blocks.push(json!({"type":"tool_result", "tool_use_id":message["tool_call_id"], "content":text}));
                "user"
            }
            "user" => {
                blocks.push(json!({"type":"text", "text":text}));
                "user"
            }
            "assistant" => {
                if let Some(raw) = message["_anthropic_content"].as_array() {
                    blocks = raw.clone();
                } else {
                    if !text.is_empty() {
                        blocks.push(json!({"type":"text", "text":text}));
                    }
                    if let Some(calls) = message["tool_calls"].as_array() {
                        for call in calls {
                            let input: Value = serde_json::from_str(
                                call["function"]["arguments"].as_str().unwrap_or(""),
                            )
                            .map_err(|_| AppError::invalid_input("工具调用参数不是有效 JSON"))?;
                            blocks.push(json!({"type":"tool_use", "id":call["id"], "name":call["function"]["name"], "input":input}));
                        }
                    }
                }
                "assistant"
            }
            _ => return Err(AppError::invalid_input("不支持的消息类型")),
        };
        if history.last().is_some_and(|last| last["role"] == role) {
            history.last_mut().unwrap()["content"]
                .as_array_mut()
                .unwrap()
                .extend(blocks);
        } else {
            history.push(json!({"role":role, "content":blocks}));
        }
    }
    let mut body =
        json!({"model":config.model, "messages":history, "max_tokens":4096, "stream":false});
    if !system.is_empty() {
        body["system"] = system.into();
    }
    if let Some(tools) = tools {
        body["tools"] = tools.as_array().ok_or_else(|| AppError::invalid_input("工具定义无效"))?
            .iter().map(|tool| json!({"name":tool["function"]["name"], "description":tool["function"]["description"], "input_schema":tool["function"]["parameters"]}))
            .collect::<Vec<_>>().into();
        body["tool_choice"] = json!({"type":"auto", "disable_parallel_tool_use":true});
    }
    Ok(body)
}
fn normalize_anthropic(response: Value) -> AppResult<Value> {
    let blocks = response["content"]
        .as_array()
        .ok_or_else(|| AppError::invalid_input("服务未返回兼容 Claude Messages 的响应"))?;
    if response["stop_reason"] == "max_tokens" {
        return Err(AppError::invalid_input(
            "模型输出达到长度上限，请缩小任务范围后重试",
        ));
    }
    let mut text = Vec::new();
    let mut calls = Vec::new();
    for block in blocks {
        match block["type"].as_str() {
            Some("text") => {
                if let Some(value) = block["text"].as_str() {
                    text.push(value);
                }
            }
            Some("tool_use") => {
                if !block["input"].is_object() {
                    return Err(AppError::invalid_input("Claude 工具参数无效"));
                }
                calls.push(json!({"id":block["id"], "type":"function", "function":{"name":block["name"], "arguments":block["input"].to_string()}}));
            }
            _ => {}
        }
    }
    Ok(
        json!({"choices":[{"message":{"role":"assistant", "content":text.join("\n"), "tool_calls":calls, "_anthropic_content":blocks}}]}),
    )
}
pub(super) async fn completion(
    config: &Config,
    messages: &[Value],
    tools: Option<Value>,
) -> AppResult<Value> {
    config.ready()?;
    let (resource, body) = match config.api_format {
        ApiFormat::Anthropic => ("messages", anthropic_body(config, messages, tools)?),
        ApiFormat::Openai => {
            let mut body = json!({"model":config.model, "messages":messages, "stream":false});
            // New OpenAI reasoning models require this field; compatible endpoints commonly use max_tokens.
            let model = config.model.to_ascii_lowercase();
            let modern_openai = model.starts_with("gpt-5")
                || model.starts_with("gpt-6")
                || ["o1", "o3", "o4"]
                    .iter()
                    .any(|prefix| model.starts_with(prefix));
            body[if modern_openai {
                "max_completion_tokens"
            } else {
                "max_tokens"
            }] = 4096.into();
            if let Some(tools) = tools {
                body["tools"] = tools;
                body["parallel_tool_calls"] = false.into();
            }
            ("chat/completions", body)
        }
    };
    let request = authenticate(
        config,
        config::client()?
            .post(endpoint(config, resource)?)
            .json(&body),
    );
    let result = config::request_json(request).await?;
    match config.api_format {
        ApiFormat::Openai => Ok(result),
        ApiFormat::Anthropic => normalize_anthropic(result),
    }
}

/// Retain provider tool signatures/reasoning needed by Gemini and DeepSeek on the next turn.
pub(super) fn history_message(message: &Value) -> Value {
    let mut result =
        json!({"role":"assistant", "content":message["content"].as_str().unwrap_or("")});
    for key in ["tool_calls", "reasoning_content", "_anthropic_content"] {
        if let Some(value) = message.get(key) {
            result[key] = value.clone();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builds_native_and_relay_endpoints_without_duplicate_suffixes() {
        for (format, base, resource, expected) in [
            (
                ApiFormat::Openai,
                "https://api.openai.com",
                "chat/completions",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                ApiFormat::Openai,
                "https://relay.example/proxy/v1/chat/completions",
                "models",
                "https://relay.example/proxy/v1/models",
            ),
            (
                ApiFormat::Openai,
                "https://ark.cn-beijing.volces.com/api/v3",
                "chat/completions",
                "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
            ),
            (
                ApiFormat::Openai,
                "https://generativelanguage.googleapis.com/v1beta/openai/",
                "models",
                "https://generativelanguage.googleapis.com/v1beta/openai/models",
            ),
            (
                ApiFormat::Anthropic,
                "https://api.anthropic.com",
                "messages",
                "https://api.anthropic.com/v1/messages",
            ),
            (
                ApiFormat::Anthropic,
                "https://relay.example/anthropic",
                "messages",
                "https://relay.example/anthropic/v1/messages",
            ),
            (
                ApiFormat::Anthropic,
                "https://relay.example/v1/messages/",
                "models",
                "https://relay.example/v1/models",
            ),
        ] {
            let config = Config {
                api_format: format,
                base_url: base.into(),
                ..Config::default()
            };
            assert_eq!(endpoint(&config, resource).unwrap().as_str(), expected);
        }
    }
    #[test]
    fn preserves_tool_signatures_and_reasoning_for_compatible_models() {
        let message = json!({"role":"assistant", "content":null, "reasoning_content":"reasoning", "tool_calls":[{"id":"call-1", "type":"function", "function":{"name":"server_status","arguments":"{}"}, "extra_content":{"google":{"thought_signature":"signature"}}}]});
        let history = history_message(&message);
        assert_eq!(history["reasoning_content"], "reasoning");
        assert_eq!(history["tool_calls"], message["tool_calls"]);
    }
    #[test]
    fn rejects_invalid_and_truncated_claude_responses() {
        assert!(normalize_anthropic(json!({"choices":[]})).is_err());
        assert!(normalize_anthropic(json!({"content":[],"stop_reason":"max_tokens"})).is_err());
        assert!(normalize_anthropic(
            json!({"content":[{"type":"tool_use","input":"not an object"}]})
        )
        .is_err());
    }
}
