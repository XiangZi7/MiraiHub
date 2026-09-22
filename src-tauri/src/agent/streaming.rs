//! Bounded SSE decoding for OpenAI-compatible providers, including DeepSeek.
//! Only a complete, successful response may become executable tool calls.
use super::config::{self, ApiFormat};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

const MAX_RESPONSE_BYTES: usize = 1_048_576;
const MAX_WIRE_BYTES: usize = 16 * MAX_RESPONSE_BYTES;
/// A parallel batch is answered rather than executed, so it only has to stay bounded.
pub(super) const MAX_TOOL_CALLS: usize = 8;

#[derive(Default)]
struct Decoder {
    line: Vec<u8>,
    data: Vec<u8>,
    event_name: Vec<u8>,
    first_line: bool,
    format: ApiFormat,
    after_cr: bool,
    wire_bytes: usize,
    payload_bytes: usize,
    message: Value,
    finish_reason: Option<String>,
    done: bool,
}
impl Decoder {
    fn new() -> Self {
        Self {
            message: json!({"role":"assistant", "content":""}),
            first_line: true,
            ..Self::default()
        }
    }
    fn push(
        &mut self,
        bytes: &[u8],
        on_progress: &mut (dyn FnMut(&str, &str) + Send),
    ) -> AppResult<()> {
        self.wire_bytes += bytes.len();
        if self.wire_bytes > MAX_WIRE_BYTES {
            return Err(AppError::invalid_input("模型流式响应超过传输容量限制"));
        }
        for &byte in bytes {
            if self.done {
                break;
            }
            if self.after_cr && byte == b'\n' {
                self.after_cr = false;
                continue;
            }
            self.after_cr = byte == b'\r';
            if byte == b'\r' || byte == b'\n' {
                self.end_line(on_progress)?;
            } else {
                self.line.push(byte);
                if self.line.len() + self.data.len() + self.event_name.len() > MAX_RESPONSE_BYTES {
                    return Err(AppError::invalid_input("模型响应超过 1 MB 限制"));
                }
            }
        }
        Ok(())
    }
    fn end_line(&mut self, on_progress: &mut (dyn FnMut(&str, &str) + Send)) -> AppResult<()> {
        let line = std::mem::take(&mut self.line);
        let line = if std::mem::take(&mut self.first_line) {
            line.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&line)
        } else {
            &line
        };
        if line.is_empty() {
            self.dispatch(on_progress)?;
        } else if let Some(data) = line.strip_prefix(b"data:") {
            let data = data.strip_prefix(b" ").unwrap_or(data);
            self.data.extend_from_slice(data);
            self.data.push(b'\n');
        } else if let Some(name) = line.strip_prefix(b"event:") {
            self.event_name = name.trim_ascii().to_vec();
        }
        // Comments (DeepSeek keepalives) and unknown SSE fields are ignored.
        Ok(())
    }
    fn dispatch(&mut self, on_progress: &mut (dyn FnMut(&str, &str) + Send)) -> AppResult<()> {
        let data = std::mem::take(&mut self.data);
        let name = std::mem::take(&mut self.event_name);
        if data.trim_ascii().is_empty() {
            return Ok(());
        }
        self.event(&data, &name, on_progress)
    }
    fn event(
        &mut self,
        data: &[u8],
        name: &[u8],
        on_progress: &mut (dyn FnMut(&str, &str) + Send),
    ) -> AppResult<()> {
        if data.trim_ascii() == b"[DONE]" {
            self.done = true;
            return Ok(());
        }
        if name == b"error" {
            return Err(AppError::internal(
                "模型服务在生成过程中返回错误，请检查模型与中转站状态",
            ));
        }
        let event: Value = serde_json::from_slice(data)
            .map_err(|_| AppError::invalid_input("模型流式响应不是有效 JSON"))?;
        let kind = event["type"]
            .as_str()
            .unwrap_or_else(|| std::str::from_utf8(name).unwrap_or(""));
        if auxiliary_event(&event, kind) {
            return Ok(());
        }
        if self.format == ApiFormat::Responses {
            return self.responses_event(&event, kind, on_progress);
        }
        // Chat-completions relays report failures as an error object. Responses events
        // carry their own and are handled above, where the provider's wording is kept.
        if !event["error"].is_null() || event["type"] == "error" {
            return Err(AppError::internal(match config::provider_detail(&event) {
                Some(detail) => format!("模型服务错误：{detail}"),
                None => "模型服务在生成过程中返回错误，请检查模型与中转站状态".into(),
            }));
        }
        if kind.starts_with("response.") {
            return Err(AppError::invalid_input(
                "服务返回了 Responses 流，请在 AI Agent 设置中将 API 格式改为 OpenAI · Responses",
            ));
        }
        if kind.starts_with("message_") || kind.starts_with("content_block_") {
            return Err(AppError::invalid_input("服务返回了 Claude Messages 流，请在 AI Agent 设置中将 API 格式改为 Claude · Messages"));
        }
        let choices = event["choices"].as_array().ok_or_else(|| {
            AppError::invalid_input("流式分片缺少 choices，请检查 API 格式与中转站协议转换")
        })?;
        // A final usage-only chunk has no choices.
        if choices.is_empty() {
            return Ok(());
        }
        if choices.len() != 1 || choices[0]["index"].as_u64().unwrap_or(0) != 0 {
            return Err(AppError::invalid_input("服务未返回兼容的流式响应"));
        }
        let choice = &choices[0];
        let delta = &choice["delta"];
        if let Some(reason) = &self.finish_reason {
            // A relay may repeat its terminal chunk or send usage with an empty
            // delta. Never accept new content/calls or a changed finish reason.
            let empty = delta.is_null()
                || delta.as_object().is_some_and(|fields| {
                    fields
                        .values()
                        .all(|v| v.is_null() || v == "" || v.as_array().is_some_and(Vec::is_empty))
                });
            if empty
                && (choice["finish_reason"].is_null()
                    || choice["finish_reason"] == ""
                    || choice["finish_reason"] == *reason)
            {
                return Ok(());
            }
            return Err(AppError::invalid_input(
                "模型结束标记后仍返回内容或冲突状态，未执行本次工具调用",
            ));
        }
        self.payload_bytes += serde_json::to_vec(delta).unwrap_or_default().len();
        if self.payload_bytes > MAX_RESPONSE_BYTES {
            return Err(AppError::invalid_input("模型响应超过 1 MB 限制"));
        }
        let mut phase = "";
        for key in ["reasoning_content", "content", "refusal"] {
            if let Some(text) = delta[key].as_str().filter(|text| !text.is_empty()) {
                append(&mut self.message[key], text)?;
                phase = if key == "reasoning_content" {
                    "thinking"
                } else {
                    "answering"
                };
            }
        }
        if let Some(calls) = delta["tool_calls"]
            .as_array()
            .filter(|calls| !calls.is_empty())
        {
            // Accumulate every slot the provider streams. The executor's
            // one-tool-at-a-time policy is applied once the response is complete,
            // so a parallel batch can be answered instead of aborting the run.
            for part in calls {
                let index = part["index"].as_u64().unwrap_or(0) as usize;
                if index >= MAX_TOOL_CALLS {
                    return Err(AppError::invalid_input(
                        "模型单轮返回的工具调用过多，未执行本次操作",
                    ));
                }
                if !self.message["tool_calls"].is_array() {
                    self.message["tool_calls"] = json!([]);
                }
                if let Some(slots) = self.message["tool_calls"].as_array_mut() {
                    while slots.len() <= index {
                        slots.push(
                            json!({"id":"", "type":"function", "function":{"name":"", "arguments":""}}),
                        );
                    }
                }
                let call = &mut self.message["tool_calls"][index];
                for key in ["id", "type"] {
                    // Relays can serialize omitted metadata as empty strings on
                    // argument-only chunks. Keep the established identity/type.
                    if let Some(value) = part
                        .get(key)
                        .filter(|value| !value.is_null() && *value != "")
                    {
                        if !value.is_string() {
                            return Err(AppError::invalid_input(
                                "模型工具调用的 id/type 不是字符串，未执行本次操作",
                            ));
                        }
                        if key == "type" && value != "function" {
                            return Err(AppError::invalid_input("不支持的工具类型"));
                        }
                        if key == "id" && call[key] != "" && call[key] != *value {
                            return Err(AppError::invalid_input(
                                "模型工具调用的 ID 在分片间发生冲突，未执行本次操作",
                            ));
                        }
                        call[key] = value.clone();
                    }
                }
                for key in ["name", "arguments"] {
                    if let Some(value) = part["function"].get(key).filter(|value| !value.is_null())
                    {
                        let text = value.as_str().ok_or_else(|| {
                            AppError::invalid_input(
                                "模型工具调用的函数名或参数不是字符串，未执行本次操作",
                            )
                        })?;
                        append(&mut call["function"][key], text)?;
                    }
                }
                // Preserve provider-specific tool signatures (e.g. Gemini extra_content).
                if let Some(fields) = part.as_object() {
                    for (key, value) in fields {
                        if !["index", "id", "type", "function"].contains(&key.as_str()) {
                            call[key] = value.clone();
                        }
                    }
                }
            }
            phase = "tool";
        }
        if !phase.is_empty() {
            on_progress(self.message["content"].as_str().unwrap_or(""), phase);
        }
        if let Some(reason) = choice["finish_reason"]
            .as_str()
            .filter(|reason| !reason.is_empty())
        {
            self.finish_reason = Some(reason.into());
        }
        Ok(())
    }
    fn responses_event(
        &mut self,
        event: &Value,
        kind: &str,
        on_progress: &mut (dyn FnMut(&str, &str) + Send),
    ) -> AppResult<()> {
        if !kind.starts_with("response.") {
            return Err(AppError::invalid_input(
                "服务未返回兼容 OpenAI Responses 的响应",
            ));
        }
        self.payload_bytes += serde_json::to_vec(event).unwrap_or_default().len();
        if self.payload_bytes > MAX_RESPONSE_BYTES {
            return Err(AppError::invalid_input("模型响应超过 1 MB 限制"));
        }
        match kind {
            "response.output_text.delta" | "response.refusal.delta" => {
                let delta = event["delta"].as_str().ok_or_else(|| {
                    AppError::invalid_input("服务未返回兼容 OpenAI Responses 的响应")
                })?;
                append(&mut self.message["content"], delta)?;
                on_progress(self.message["content"].as_str().unwrap_or(""), "answering");
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                on_progress(self.message["content"].as_str().unwrap_or(""), "thinking");
            }
            "response.function_call_arguments.delta" | "response.function_call_arguments.done" => {
                on_progress(self.message["content"].as_str().unwrap_or(""), "tool");
            }
            "response.output_item.added" if event["item"]["type"] == "function_call" => {
                on_progress(self.message["content"].as_str().unwrap_or(""), "tool");
            }
            "response.completed" => {
                // The completed event contains authoritative full output. Arguments
                // done/item done/EOF alone must never authorize a tool invocation.
                let response = super::responses::normalize(event["response"].clone())?;
                self.message = response["choices"][0]["message"].clone();
                self.finish_reason = response["choices"][0]["finish_reason"]
                    .as_str()
                    .map(str::to_owned);
                self.done = true;
            }
            "response.failed" | "response.cancelled" => {
                // Only the provider's error object is quoted. The rest of the event can
                // carry echoed request data, which must not reach the panel.
                return Err(AppError::internal(
                    match config::provider_detail(&json!({"error": event["response"]["error"]})) {
                        Some(detail) => format!("模型服务错误：{detail}"),
                        None => "模型服务在生成过程中返回错误，请检查模型与中转站状态".into(),
                    },
                ));
            }
            "response.incomplete" => {
                if event["response"]["incomplete_details"]["reason"] == "max_output_tokens" {
                    return Err(AppError::invalid_input(
                        "模型输出达到长度上限，请缩小任务范围后重试",
                    ));
                }
                return Err(AppError::invalid_input(
                    "模型流式响应未完整结束，未执行本次工具调用，请重试",
                ));
            }
            _ => {}
        }
        Ok(())
    }
    fn finish(mut self, on_progress: &mut (dyn FnMut(&str, &str) + Send)) -> AppResult<Value> {
        // Accept EOF immediately after a final data line, including an unterminated [DONE].
        if !self.done {
            if !self.line.is_empty() {
                self.end_line(on_progress)?;
            }
            self.dispatch(on_progress)?;
        }
        let calls = self.message["tool_calls"].as_array();
        let has_calls = calls.is_some_and(|calls| !calls.is_empty());
        match self.finish_reason.as_deref() {
            Some("length") => {
                return Err(AppError::invalid_input(
                    "模型输出达到长度上限，请缩小任务范围后重试",
                ))
            }
            Some("content_filter") => {
                return Err(AppError::invalid_input(
                    "模型服务未能完成此回复，请调整请求后重试",
                ))
            }
            Some("stop") if !has_calls => {}
            Some("tool_calls") if has_calls => {}
            _ => {
                return Err(AppError::invalid_input(
                    "模型流式响应未完整结束，未执行本次工具调用，请重试",
                ))
            }
        }
        if let Some(calls) = calls.filter(|calls| !calls.is_empty()) {
            // Every slot is validated so a parallel batch reaches the executor intact;
            // the one-tool-at-a-time policy is applied there, not by aborting the run.
            if calls.len() > MAX_TOOL_CALLS {
                return Err(AppError::invalid_input(
                    "模型单轮返回的工具调用过多，未执行本次操作",
                ));
            }
            for call in calls {
                if call["id"].as_str().unwrap_or("").trim().is_empty() {
                    return Err(AppError::invalid_input("缺少有效工具调用 ID"));
                }
                if call["function"]["name"]
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .is_empty()
                {
                    return Err(AppError::invalid_input(
                        "模型工具调用缺少函数名，未执行本次操作",
                    ));
                }
                let args = call["function"]["arguments"].as_str().ok_or_else(|| {
                    AppError::invalid_input("模型工具调用的函数名或参数不是字符串，未执行本次操作")
                })?;
                if args.trim().is_empty() {
                    return Err(AppError::invalid_input(
                        "模型工具调用缺少参数，未执行本次操作",
                    ));
                }
                // Do not repair, concatenate snapshots, or substitute {}: these are
                // executable arguments. Report the failure without exposing them.
                match serde_json::from_str::<Value>(args) {
                    Ok(value) if value.is_object() => {}
                    Ok(_) => {
                        return Err(AppError::invalid_input(
                            "模型工具调用参数必须是 JSON 对象，未执行本次操作",
                        ))
                    }
                    Err(error) if error.is_eof() => {
                        return Err(AppError::invalid_input(
                            "模型工具调用参数不完整，未执行本次操作",
                        ))
                    }
                    Err(_) => {
                        return Err(AppError::invalid_input(
                            "模型工具调用参数不是有效 JSON，未执行本次操作",
                        ))
                    }
                }
            }
        }
        Ok(json!({"choices":[{"message":self.message, "finish_reason":self.finish_reason}]}))
    }
}
// Known metadata only. Unlike ignoring every event without choices, this cannot
// hide a protocol mismatch or silently discard an unfamiliar content/tool event.
fn auxiliary_event(event: &Value, kind: &str) -> bool {
    let Some(fields) = event.as_object() else {
        return false;
    };
    let no_choices =
        event["choices"].is_null() || event["choices"].as_array().is_some_and(Vec::is_empty);
    no_choices
        && (matches!(kind, "ping" | "heartbeat") || (kind.is_empty() && event["usage"].is_object()))
        && fields.keys().all(|key| {
            matches!(
                key.as_str(),
                "type"
                    | "choices"
                    | "usage"
                    | "id"
                    | "object"
                    | "created"
                    | "model"
                    | "system_fingerprint"
                    | "service_tier"
                    | "timestamp"
            )
        })
}

pub(super) fn completed_message(message: Value, reason: &str) -> AppResult<Value> {
    let mut decoder = Decoder::new();
    decoder.message = message;
    decoder.finish_reason = Some(reason.into());
    decoder.finish(&mut |_, _| {})
}
fn append(value: &mut Value, text: &str) -> AppResult<()> {
    if value.is_null() {
        *value = Value::String(String::new());
    }
    if let Value::String(value) = value {
        value.push_str(text);
        Ok(())
    } else {
        Err(AppError::invalid_input("服务未返回兼容的流式响应"))
    }
}

pub(super) async fn completion(
    request: reqwest::RequestBuilder,
    format: ApiFormat,
    on_progress: &mut (dyn FnMut(&str, &str) + Send),
) -> AppResult<Value> {
    let mut response =
        config::check_status(request.send().await.map_err(config::request_error)?).await?;
    // Some relays ignore stream=true and return a regular JSON response. Consume
    // that single response; never retry a model request automatically.
    let json_response = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/json")
        });
    if json_response {
        let response = config::response_json(response).await?;
        if format == ApiFormat::Responses {
            return super::responses::normalize(response);
        }
        if !response["error"].is_null() {
            return Err(AppError::internal(
                match config::provider_detail(&response) {
                    Some(detail) => format!("模型服务错误：{detail}"),
                    None => "模型服务在生成过程中返回错误，请检查模型与中转站状态".into(),
                },
            ));
        }
        // Apply the same completion checks when a relay ignores streaming.
        if response["choices"][0]["finish_reason"].is_string() {
            let mut decoder = Decoder::new();
            decoder.message = response["choices"][0]["message"].clone();
            decoder.finish_reason = response["choices"][0]["finish_reason"]
                .as_str()
                .map(str::to_owned);
            decoder.finish(&mut |_, _| {})?;
        }
        return Ok(response);
    }
    let mut decoder = Decoder::new();
    decoder.format = format;
    while let Some(bytes) = response.chunk().await.map_err(config::request_error)? {
        decoder.push(&bytes, on_progress)?;
        if decoder.done {
            break;
        }
    }
    decoder.finish(on_progress)
}

#[cfg(test)]
mod tests {
    use super::super::{
        config::{ApiFormat, Config},
        protocol,
    };
    use super::*;
    use std::time::Duration;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::oneshot,
    };

    fn chunk(delta: Value, reason: Value) -> String {
        format!(
            "data: {}\r\n\r\n",
            json!({"choices":[{"index":0,"delta":delta,"finish_reason":reason}]})
        )
    }
    fn parse(wire: &str) -> AppResult<Value> {
        parse_format(wire, ApiFormat::Openai)
    }
    fn parse_format(wire: &str, format: ApiFormat) -> AppResult<Value> {
        let mut decoder = Decoder::new();
        decoder.format = format;
        // Exercise split UTF-8, split CRLF and JSON boundaries on every byte.
        for byte in wire.as_bytes() {
            decoder.push(&[*byte], &mut |_, _| {})?;
        }
        decoder.finish(&mut |_, _| {})
    }
    fn event(value: Value) -> String {
        format!("data: {value}\n\n")
    }
    fn response(output: Value) -> Value {
        json!({"id":"resp_1", "object":"response", "status":"completed", "output":output})
    }
    fn output_text(text: &str) -> Value {
        json!({"type":"message", "id":"msg_1", "role":"assistant", "status":"completed",
            "content":[{"type":"output_text", "text":text, "annotations":[]}]})
    }
    #[test]
    fn empty_finish_reason_is_not_a_completion_marker() {
        let wire = chunk(json!({"role":"assistant", "content":""}), json!(""))
            + &chunk(json!({"content":"你好"}), json!(""))
            + &chunk(json!({"content":"世界"}), json!("stop"))
            + "data: [DONE]\n\n";
        assert_eq!(
            parse(&wire).unwrap()["choices"][0]["message"]["content"],
            "你好世界"
        );
        assert!(parse(&chunk(json!({"content":"partial"}), json!(""))).is_err());
    }
    #[test]
    fn accepts_known_metadata_and_empty_terminal_chunks() {
        let wire = "\u{feff}event: ping\ndata: {}\n\ndata:   \n\n".to_owned()
            + &event(json!({"type":"ping"}))
            + &chunk(json!({"content":"ok"}), json!("stop"))
            + &event(json!({"usage":{"total_tokens":7}}))
            + &chunk(json!({}), json!("stop"))
            + &chunk(json!({"content":null}), Value::Null)
            + "data: [DONE]\n\n";
        assert_eq!(
            parse(&wire).unwrap()["choices"][0]["message"]["content"],
            "ok"
        );
        for tail in [
            chunk(json!({"content":"late"}), Value::Null),
            chunk(json!({}), json!("length")),
            event(json!({"usage":{}, "content":"must not be ignored"})),
        ] {
            let error =
                parse(&(chunk(json!({"content":"ok"}), json!("stop")) + &tail)).unwrap_err();
            assert!(!error.message.contains("must not be ignored"));
        }
        // The provider's own wording is quoted, but a credential it echoes is masked.
        let error = parse(
            &(chunk(json!({"content":"ok"}), json!("stop"))
                + &event(
                    json!({"type":"ping", "error":{"message":"bad key sk-abcdefgh12345678"}}),
                )),
        )
        .unwrap_err();
        assert!(error.message.contains("bad key"));
        assert!(!error.message.contains("sk-abcdefgh12345678"));
    }
    #[test]
    fn explains_wrong_protocol_instead_of_generic_incompatibility() {
        for (value, expected) in [
            (
                json!({"type":"response.created", "response":{}}),
                "OpenAI · Responses",
            ),
            (
                json!({"type":"message_start", "message":{}}),
                "Claude · Messages",
            ),
            (json!({"unexpected":"secret-value"}), "缺少 choices"),
        ] {
            let error = parse(&event(value)).unwrap_err();
            assert!(error.message.contains(expected));
            assert!(!error.message.contains("secret-value"));
        }
    }
    #[test]
    fn responses_require_completed_event_with_valid_full_output() {
        let tool = json!({"type":"function_call", "id":"fc_1", "call_id":"call_1", "name":"server_status",
            "arguments":"{\"probe\":\"disk\"}", "status":"completed"});
        let prefix = event(json!({"type":"response.created", "response":{"status":"in_progress"}}))
            + &event(
                json!({"type":"response.function_call_arguments.done", "arguments":"{\"probe\":\"disk\"}"}),
            );
        let valid = prefix.clone()
            + &event(json!({"type":"response.completed", "response":response(json!([tool]))}));
        let parsed = parse_format(&valid, ApiFormat::Responses).unwrap();
        assert_eq!(
            parsed["choices"][0]["message"]["tool_calls"][0]["id"],
            "call_1"
        );
        for tail in [
            String::new(),
            "data: [DONE]\n\n".into(),
            event(
                json!({"type":"response.failed", "response":{"error":{"message":"bad key sk-abcdefgh12345678"}}}),
            ),
            event(
                json!({"type":"response.incomplete", "response":{"incomplete_details":{"reason":"max_output_tokens"}}}),
            ),
            event(
                json!({"type":"response.completed", "response":{"status":"in_progress", "output":[tool]}}),
            ),
            event(
                json!({"type":"response.completed", "response":response(json!([{"type":"function_call", "call_id":"call_1", "name":"server_status", "arguments":"{"}]))}),
            ),
        ] {
            let error = parse_format(&(prefix.clone() + &tail), ApiFormat::Responses).unwrap_err();
            assert!(!error.message.contains("sk-abcdefgh12345678"));
        }
        // A parallel batch is kept whole; the executor answers it instead of failing here.
        let parallel = prefix
            + &event(json!({"type":"response.completed", "response":response(json!([tool,tool]))}));
        let parsed = parse_format(&parallel, ApiFormat::Responses).unwrap();
        assert_eq!(
            parsed["choices"][0]["message"]["tool_calls"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn decodes_utf8_reasoning_heartbeats_usage_and_multiline_data() {
        let wire = format!(
            ": keep-alive\r\n\r\n{}{}{}",
            chunk(json!({"reasoning_content":"先检查磁盘"}), Value::Null),
            chunk(json!({"content":"你好🌍"}), Value::Null),
            chunk(json!({}), json!("stop"))
        );
        let valid = wire
            + "data: {\r\ndata: \"choices\":[],\"usage\":{\"total_tokens\":10}}\r\n\r\ndata: [DONE]";
        let result = parse(&valid).unwrap();
        let history = protocol::history_message(&result["choices"][0]["message"]);
        assert_eq!(history["content"], "你好🌍");
        assert_eq!(history["reasoning_content"], "先检查磁盘");
    }
    #[test]
    fn assembles_tool_arguments_and_preserves_provider_signatures() {
        let wire = chunk(json!({"reasoning_content":"检查"}), Value::Null)
            + &chunk(
                json!({"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"server_status","arguments":""},"extra_content":{"signature":"sig"}}]}),
                Value::Null,
            )
            + &chunk(
                json!({"tool_calls":[{"index":0,"function":{"arguments":"{\"probe\":"}}]}),
                Value::Null,
            )
            + &chunk(
                json!({"tool_calls":[{"index":0,"function":{"arguments":"\"disk\"}"}}]}),
                Value::Null,
            )
            + &chunk(json!({}), json!("tool_calls"))
            + "data: [DONE]\n\n";
        let result = parse(&wire).unwrap();
        let history = protocol::history_message(&result["choices"][0]["message"]);
        assert_eq!(
            history["tool_calls"][0]["function"]["arguments"],
            "{\"probe\":\"disk\"}"
        );
        assert_eq!(
            history["tool_calls"][0]["extra_content"]["signature"],
            "sig"
        );
        assert_eq!(history["reasoning_content"], "检查");
    }
    #[test]
    fn rejects_truncation_length_errors_and_unfinished_calls() {
        let tool = chunk(
            json!({"tool_calls":[{"index":0,"id":"call","function":{"name":"server_status","arguments":"{\"probe\":\"disk\"}"}}]}),
            Value::Null,
        );
        for wire in [
            tool.clone(),
            tool.clone() + "data: [DONE]\n\n",
            tool.clone() + &chunk(json!({}), json!("length")) + "data: [DONE]\n\n",
            tool.clone() + &chunk(json!({}), json!("stop")),
            "data: {\"error\":{\"message\":\"bad key sk-abcdefgh12345678\"}}\n\n".into(),
            "data: invalid\n\n".into(),
            chunk(json!({"content":"partial"}), Value::Null),
        ] {
            let error = parse(&wire).unwrap_err();
            assert!(!error.message.contains("sk-abcdefgh12345678"));
        }
    }
    #[test]
    fn assembles_a_parallel_batch_and_rejects_more_than_eight() {
        let wire = chunk(
            json!({"tool_calls":[
                {"index":0,"id":"call_a","type":"function","function":{"name":"server_status","arguments":"{\"probe\":\"disk\"}"}},
                {"index":1,"id":"call_b","type":"function","function":{"name":"server_status","arguments":"{\"probe\":\"system\"}"}}
            ]}),
            json!("tool_calls"),
        ) + "data: [DONE]\n\n";
        let result = parse(&wire).unwrap();
        let calls = result["choices"][0]["message"]["tool_calls"]
            .as_array()
            .unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1]["id"], "call_b");
        // A gap in the streamed indexes leaves an empty slot, which fails validation
        // instead of being silently skipped or executed.
        let gapped = chunk(
            json!({"tool_calls":[{"index":1,"id":"call_b","function":{"name":"server_status","arguments":"{}"}}]}),
            json!("tool_calls"),
        );
        assert!(parse(&gapped).is_err());
        let overflow = chunk(
            json!({"tool_calls":[{"index":MAX_TOOL_CALLS,"function":{"arguments":"{}"}}]}),
            Value::Null,
        );
        let error = parse(&overflow).unwrap_err();
        assert!(error.message.contains("工具调用过多"));
    }
    #[test]
    fn preserves_tool_identity_when_continuations_contain_empty_placeholders() {
        for placeholder in [json!(""), Value::Null] {
            let wire = chunk(
                json!({"tool_calls":[{"index":0,"id":"call_pm2","type":"function",
                    "function":{"name":"propose_shell","arguments":"{\"command\":\""}}]}),
                Value::Null,
            ) + &chunk(
                json!({"tool_calls":[{"index":0,"id":placeholder,"type":placeholder,
                    "function":{"name":"","arguments":"command -v pm2 && pm2 --version\",\"reason\":\"检查 pm2\"}"}}]}),
                Value::Null,
            ) + &chunk(json!({}), json!("tool_calls"))
                + "data: [DONE]\n\n";
            let result = parse(&wire).unwrap();
            let call = &result["choices"][0]["message"]["tool_calls"][0];
            assert_eq!(call["id"], "call_pm2");
            assert_eq!(call["type"], "function");
            let action = super::super::policy::classify(
                &super::super::mcp::Registry::build("ssh", &[]),
                "ssh",
                call["function"]["name"].as_str().unwrap(),
                call["function"]["arguments"].as_str().unwrap(),
            )
            .unwrap();
            assert!(matches!(action, super::super::policy::Action::Shell { .. }));
        }
    }
    #[test]
    fn rejects_conflicting_ids_and_invalid_field_types_without_echoing_arguments() {
        let first = chunk(
            json!({"tool_calls":[{"index":0,"id":"call_1","type":"function",
            "function":{"name":"propose_shell","arguments":"{\"command\":\"secret-value\""}}]}),
            Value::Null,
        );
        for (part, expected) in [
            (
                json!({"index":0,"id":"different-call"}),
                "ID 在分片间发生冲突",
            ),
            (json!({"index":0,"id":123}), "id/type 不是字符串"),
            (json!({"index":0,"type":{}}), "id/type 不是字符串"),
            (
                json!({"index":0,"function":{"name":false}}),
                "函数名或参数不是字符串",
            ),
            (
                json!({"index":0,"function":{"arguments":{"command":"secret-value"}}}),
                "函数名或参数不是字符串",
            ),
        ] {
            let error = parse(&(first.clone() + &chunk(json!({"tool_calls":[part]}), Value::Null)))
                .unwrap_err();
            assert!(error.message.contains(expected), "{}", error.message);
            assert!(!error.message.contains("secret-value"));
        }
    }
    #[test]
    fn reports_missing_metadata_and_malformed_arguments_separately() {
        for (id, name, arguments, expected) in [
            ("", "propose_shell", "{}", "缺少有效工具调用 ID"),
            ("call_1", "", "{}", "缺少函数名"),
            ("call_1", "propose_shell", "", "缺少参数"),
            (
                "call_1",
                "propose_shell",
                "{\"command\":\"secret-value\"",
                "参数不完整",
            ),
            (
                "call_1",
                "propose_shell",
                "{secret-value}",
                "参数不是有效 JSON",
            ),
            (
                "call_1",
                "propose_shell",
                "[\"secret-value\"]",
                "参数必须是 JSON 对象",
            ),
        ] {
            let error = completed_message(json!({"role":"assistant", "content":"检查环境",
                "tool_calls":[{"id":id,"type":"function","function":{"name":name,"arguments":arguments}}]}),
                "tool_calls").unwrap_err();
            assert!(error.message.contains(expected), "{}", error.message);
            assert!(!error.message.contains("secret-value"));
        }
    }
    #[test]
    fn repeated_metadata_does_not_deduplicate_argument_text() {
        let first = chunk(
            json!({"tool_calls":[{"index":0,"id":"call_1","type":"function",
            "function":{"name":"propose_shell","arguments":"{\"command\":\"printf "}}]}),
            Value::Null,
        );
        let repeated = chunk(
            json!({"tool_calls":[{"index":0,"id":"call_1","type":"function",
            "function":{"name":null,"arguments":"a"}}]}),
            Value::Null,
        );
        let last = chunk(
            json!({"tool_calls":[{"index":0,"id":"","type":"",
            "function":{"name":"","arguments":"\",\"reason\":\"test\"}"}}]}),
            json!("tool_calls"),
        );
        let result = parse(&(first + &repeated + &repeated + &last + "data: [DONE]\n\n")).unwrap();
        let call = &result["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(
            call["function"]["arguments"],
            "{\"command\":\"printf aa\",\"reason\":\"test\"}"
        );
        assert_eq!(call["id"], "call_1");
    }
    #[test]
    fn rejects_incomplete_arguments_and_accepts_eof_after_finish_reason() {
        let wire = chunk(
            json!({"tool_calls":[{"index":0,"id":"call","function":{"name":"server_status","arguments":"{\"probe\":"}}]}),
            json!("tool_calls"),
        );
        assert!(parse(&wire).is_err());
        assert_eq!(
            parse(&chunk(json!({"content":"完成"}), json!("stop"))).unwrap()["choices"][0]
                ["message"]["content"],
            "完成"
        );
    }
    #[test]
    fn json_fallback_handles_empty_tool_arrays_and_rejects_length_truncation() {
        for (calls, reason, valid) in [
            (json!([]), "stop", true),
            (json!([]), "tool_calls", false),
            (Value::Null, "length", false),
        ] {
            let mut decoder = Decoder::new();
            decoder.message = json!({"role":"assistant", "content":"text", "tool_calls":calls});
            decoder.finish_reason = Some(reason.into());
            assert_eq!(decoder.finish(&mut |_, _| {}).is_ok(), valid);
        }
    }
    #[test]
    fn bounds_unterminated_events_and_aggregate_output() {
        let mut decoder = Decoder::new();
        assert!(decoder
            .push(&vec![b'x'; MAX_RESPONSE_BYTES + 1], &mut |_, _| {})
            .is_err());
        let mut decoder = Decoder::new();
        let large = chunk(
            json!({"reasoning_content":"x".repeat(300_000)}),
            Value::Null,
        );
        for _ in 0..3 {
            decoder.push(large.as_bytes(), &mut |_, _| {}).unwrap();
        }
        assert!(decoder.push(large.as_bytes(), &mut |_, _| {}).is_err());
    }

    async fn mock_stream(
        first: String,
        rest: String,
        gate: oneshot::Receiver<()>,
        content_type: &str,
    ) -> (Config, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let headers = format!("HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", first.len() + rest.len());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let read = stream.read(&mut buffer).await.unwrap();
                assert!(read > 0);
                request.extend_from_slice(&buffer[..read]);
                if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let size = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|n| n.trim().parse::<usize>().ok())
                        })
                        .unwrap();
                    if request.len() >= end + 4 + size {
                        break;
                    }
                }
            }
            stream.write_all(headers.as_bytes()).await.unwrap();
            stream.write_all(first.as_bytes()).await.unwrap();
            let _ = gate.await;
            let _ = stream.write_all(rest.as_bytes()).await;
            String::from_utf8(request).unwrap()
        });
        (
            Config {
                enabled: true,
                api_format: ApiFormat::Openai,
                base_url: format!("http://{address}/v1"),
                model: "deepseek-test".into(),
                ..Config::default()
            },
            server,
        )
    }
    #[tokio::test]
    async fn delivers_progress_before_response_finishes_and_sends_stream_true() {
        let (send, gate) = oneshot::channel();
        let (config, server) = mock_stream(
            chunk(json!({"content":"你好"}), Value::Null),
            chunk(json!({"content":"世界"}), json!("stop")) + "data: [DONE]\n\n",
            gate,
            "text/event-stream; charset=utf-8",
        )
        .await;
        let mut send = Some(send);
        let mut previews = Vec::new();
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            protocol::streaming_completion(&config, &[], None, &mut |text, phase| {
                previews.push((text.to_owned(), phase.to_owned()));
                if let Some(send) = send.take() {
                    send.send(()).unwrap();
                }
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(previews[0], ("你好".into(), "answering".into()));
        assert_eq!(result["choices"][0]["message"]["content"], "你好世界");
        let request = server.await.unwrap();
        let body: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["stream"], true);
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
    }
    #[tokio::test]
    async fn accepts_a_relay_that_returns_json_without_retrying() {
        let (send, gate) = oneshot::channel();
        send.send(()).unwrap();
        let (config, server) = mock_stream(
            json!({"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}).to_string(),
            String::new(), gate, "application/json",
        ).await;
        let result = protocol::streaming_completion(&config, &[], None, &mut |_, _| {})
            .await
            .unwrap();
        assert_eq!(result["choices"][0]["message"]["content"], "ok");
        server.await.unwrap();
    }
    #[tokio::test]
    async fn responses_deliver_live_text_and_use_the_responses_endpoint() {
        let (send, gate) = oneshot::channel();
        let (mut config, server) = mock_stream(
            event(json!({"type":"response.output_text.delta", "delta":"你好🌍"})),
            event(json!({"type":"response.completed", "response":response(json!([output_text("你好🌍")]))})),
            gate, "text/event-stream",
        ).await;
        config.api_format = ApiFormat::Responses;
        config.api_key = "test-responses-key".into();
        let mut send = Some(send);
        let mut previews = Vec::new();
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            protocol::streaming_completion(
                &config,
                &[
                    json!({"role":"system", "content":"system rule"}),
                    json!({"role":"user", "content":"hello"}),
                ],
                Some(super::super::policy::definitions("ssh")),
                &mut |text, phase| {
                    previews.push((text.to_owned(), phase.to_owned()));
                    if let Some(send) = send.take() {
                        send.send(()).unwrap();
                    }
                },
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(previews[0], ("你好🌍".into(), "answering".into()));
        assert_eq!(result["choices"][0]["message"]["content"], "你好🌍");
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /v1/responses HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer test-responses-key"));
        let body: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["stream"], true);
        assert_eq!(body["store"], false);
        assert_eq!(body["instructions"], "system rule");
        assert_eq!(body["input"], json!([{"role":"user", "content":"hello"}]));
        assert!(body["messages"].is_null());
        assert_eq!(body["parallel_tool_calls"], false);
        assert_eq!(body["tools"][0]["type"], "function");
        assert!(body["tools"][0]["name"].is_string());
    }
    #[tokio::test]
    async fn responses_support_json_fallback_and_connection_test() {
        for streaming in [true, false] {
            let (send, gate) = oneshot::channel();
            send.send(()).unwrap();
            let (mut config, server) = mock_stream(
                response(json!([output_text("ok")])).to_string(),
                String::new(),
                gate,
                "application/json",
            )
            .await;
            config.api_format = ApiFormat::Responses;
            let result = if streaming {
                protocol::streaming_completion(&config, &[], None, &mut |_, _| {}).await
            } else {
                protocol::completion(&config, &[], None).await
            }
            .unwrap();
            assert_eq!(result["choices"][0]["message"]["content"], "ok");
            let request = server.await.unwrap();
            let body: Value =
                serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(body["stream"], streaming);
        }
    }
    #[tokio::test]
    async fn timeout_is_distinguished_from_connection_failure() {
        let (_send, gate) = oneshot::channel();
        let (config, server) = mock_stream(
            ": waiting\n\n".into(),
            "data: [DONE]\n\n".into(),
            gate,
            "text/event-stream",
        )
        .await;
        let error = completion(
            config::streaming_client()
                .unwrap()
                .post(&config.base_url)
                .json(&json!({}))
                .timeout(Duration::from_millis(40)),
            ApiFormat::Openai,
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(error.message.contains("超时"));
        server.abort();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let error = completion(
            config::streaming_client()
                .unwrap()
                .post(format!("http://{address}")),
            ApiFormat::Openai,
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(error.message.contains("无法连接"));
        assert!(!error.message.contains("超时"));
    }
    #[tokio::test]
    #[ignore = "65-second regression check for the former 60-second total timeout"]
    async fn active_stream_survives_sixty_seconds() {
        let (send, gate) = oneshot::channel();
        let (config, server) = mock_stream(
            ": keep-alive\n\n".into(),
            chunk(json!({"content":"完成"}), json!("stop")) + "data: [DONE]\n\n",
            gate,
            "text/event-stream",
        )
        .await;
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(65)).await;
            let _ = send.send(());
        });
        let response = protocol::streaming_completion(&config, &[], None, &mut |_, _| {})
            .await
            .unwrap();
        assert_eq!(response["choices"][0]["message"]["content"], "完成");
        server.await.unwrap();
    }
}
