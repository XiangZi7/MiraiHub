//! Responses wire format; only a completed response can enter the tool executor.
use super::config::Config;
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

pub(super) fn body(config: &Config, messages: &[Value], tools: Option<Value>) -> AppResult<Value> {
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    for message in messages {
        let text = message["content"].as_str().unwrap_or("");
        match message["role"].as_str().unwrap_or("") {
            "system" | "developer" => instructions.push(text),
            "tool" => input.push(json!({
                "type":"function_call_output", "call_id":message["tool_call_id"], "output":text
            })),
            "assistant" => {
                if let Some(output) = message["_responses_output"].as_array() {
                    // Preserve reasoning items (including encrypted_content) and call IDs
                    // in their original order, without duplicating text or tool calls.
                    input.extend(output.iter().cloned());
                    continue;
                }
                if !text.is_empty() {
                    input.push(json!({"role":"assistant", "content":text}));
                }
                if let Some(calls) = message["tool_calls"].as_array() {
                    for call in calls {
                        input.push(json!({"type":"function_call", "call_id":call["id"],
                            "name":call["function"]["name"], "arguments":call["function"]["arguments"]}));
                    }
                }
            }
            "user" => input.push(json!({"role":"user", "content":text})),
            _ => return Err(AppError::invalid_input("不支持的消息类型")),
        }
    }
    let mut body = json!({"model":config.model, "input":input, "instructions":instructions.join("\n\n"),
        "stream":false, "store":false, "include":["reasoning.encrypted_content"], "max_output_tokens":4096});
    if let Some(tools) = tools {
        body["tools"] = tools.as_array().ok_or_else(|| AppError::invalid_input("工具定义无效"))?
            .iter().map(|tool| json!({"type":"function", "name":tool["function"]["name"],
                "description":tool["function"]["description"], "parameters":tool["function"]["parameters"],
                "strict":false})).collect::<Vec<_>>().into();
        body["tool_choice"] = "auto".into();
        body["parallel_tool_calls"] = false.into();
    }
    Ok(body)
}

pub(super) fn normalize(response: Value) -> AppResult<Value> {
    if !response["error"].is_null()
        || matches!(response["status"].as_str(), Some("failed" | "cancelled"))
    {
        return Err(AppError::internal(
            "模型服务在生成过程中返回错误，请检查模型与中转站状态",
        ));
    }
    if response["incomplete_details"]["reason"] == "max_output_tokens" {
        return Err(AppError::invalid_input(
            "模型输出达到长度上限，请缩小任务范围后重试",
        ));
    }
    if response["status"] != "completed" {
        return Err(AppError::invalid_input(
            "模型流式响应未完整结束，未执行本次工具调用，请重试",
        ));
    }
    let output = response["output"]
        .as_array()
        .ok_or_else(|| AppError::invalid_input("服务未返回兼容 OpenAI Responses 的响应"))?;
    let mut content = String::new();
    let mut calls = Vec::new();
    for item in output {
        if item
            .get("status")
            .is_some_and(|status| !status.is_null() && status != "completed")
        {
            return Err(AppError::invalid_input(
                "模型流式响应未完整结束，未执行本次工具调用，请重试",
            ));
        }
        match item["type"].as_str() {
            Some("message") if item["role"] == "assistant" => {
                let blocks = item["content"].as_array().ok_or_else(|| {
                    AppError::invalid_input("服务未返回兼容 OpenAI Responses 的响应")
                })?;
                for block in blocks {
                    let text = match block["type"].as_str() {
                        Some("output_text") => block["text"].as_str(),
                        Some("refusal") => block["refusal"].as_str(),
                        _ => None,
                    }
                    .ok_or_else(|| {
                        AppError::invalid_input("服务未返回兼容 OpenAI Responses 的响应")
                    })?;
                    content.push_str(text);
                }
            }
            Some("function_call") => calls.push(json!({"id":item["call_id"], "type":"function",
                "function":{"name":item["name"], "arguments":item["arguments"]}})),
            Some("reasoning") => {}
            _ => {
                return Err(AppError::invalid_input(
                    "服务未返回兼容 OpenAI Responses 的响应",
                ))
            }
        }
    }
    let reason = if calls.is_empty() {
        "stop"
    } else {
        "tool_calls"
    };
    super::streaming::completed_message(
        json!({"role":"assistant", "content":content,
        "tool_calls":calls, "_responses_output":output}),
        reason,
    )
}

#[cfg(test)]
mod tests {
    use super::super::protocol;
    use super::*;

    #[test]
    fn tool_round_trip_preserves_reasoning_and_outputs_without_duplicate_calls() {
        let output = json!([
            {"type":"reasoning", "id":"rs_1", "summary":[], "encrypted_content":"encrypted-reasoning"},
            {"type":"message", "id":"msg_1", "role":"assistant", "status":"completed",
                "content":[{"type":"output_text", "text":"检查磁盘", "annotations":[]}]},
            {"type":"function_call", "id":"fc_1", "call_id":"call_1", "name":"server_status",
                "arguments":"{\"probe\":\"disk\"}", "status":"completed"}
        ]);
        let normalized = normalize(json!({"status":"completed", "output":output})).unwrap();
        let history = protocol::history_message(&normalized["choices"][0]["message"]);
        assert_eq!(history["content"], "检查磁盘");
        assert_eq!(history["tool_calls"][0]["id"], "call_1");
        let request = body(
            &Config::default(),
            &[
                json!({"role":"system", "content":"system"}),
                json!({"role":"developer", "content":"policy"}),
                json!({"role":"user", "content":"check"}),
                history,
                json!({"role":"tool", "tool_call_id":"call_1", "content":"disk ok"}),
            ],
            None,
        )
        .unwrap();
        assert_eq!(request["instructions"], "system\n\npolicy");
        let input = request["input"].as_array().unwrap();
        assert_eq!(input.len(), 5);
        assert_eq!(&input[1..4], output.as_array().unwrap());
        assert_eq!(
            input[4],
            json!({"type":"function_call_output", "call_id":"call_1", "output":"disk ok"})
        );
        assert_eq!(request["include"], json!(["reasoning.encrypted_content"]));
        assert_eq!(request["store"], false);
    }

    #[test]
    fn converts_existing_chat_history_to_responses_items() {
        let request = body(&Config::default(), &[
            json!({"role":"assistant", "content":"检查", "tool_calls":[{"id":"call_1", "type":"function",
                "function":{"name":"server_status", "arguments":"{}"}}]}),
            json!({"role":"tool", "tool_call_id":"call_1", "content":"ok"}),
        ], None).unwrap();
        assert_eq!(
            request["input"],
            json!([
                {"role":"assistant", "content":"检查"},
                {"type":"function_call", "call_id":"call_1", "name":"server_status", "arguments":"{}"},
                {"type":"function_call_output", "call_id":"call_1", "output":"ok"}
            ])
        );
    }

    #[test]
    fn incomplete_and_failed_outputs_never_become_tool_calls() {
        for response in [
            json!({"status":"incomplete", "output":[]}),
            json!({"status":"failed", "error":{"message":"secret-value"}}),
            json!({"status":"completed", "output":[{"type":"function_call", "status":"in_progress"}]}),
            json!({"status":"completed", "output":[{"type":"function_call", "call_id":"x", "name":"x", "arguments":"[]"}]}),
            json!({"status":"completed", "output":[{"type":"function_call", "call_id":"", "name":"x", "arguments":"{}"}]}),
            json!({"status":"completed", "output":[{"type":"unexpected_tool"}]}),
        ] {
            let error = normalize(response).unwrap_err();
            assert!(!error.message.contains("secret-value"));
        }
        let error = normalize(
            json!({"status":"incomplete", "incomplete_details":{"reason":"max_output_tokens"}}),
        )
        .unwrap_err();
        assert!(error.message.contains("长度上限"));
    }
}
