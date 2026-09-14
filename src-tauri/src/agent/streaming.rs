//! Bounded SSE decoding for OpenAI-compatible providers, including DeepSeek.
//! Only a complete, successful response may become executable tool calls.
use super::config;
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

const MAX_RESPONSE_BYTES: usize = 1_048_576;
const MAX_WIRE_BYTES: usize = 16 * MAX_RESPONSE_BYTES;

#[derive(Default)]
struct Decoder {
    line: Vec<u8>,
    data: Vec<u8>,
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
                if self.line.len() + self.data.len() > MAX_RESPONSE_BYTES {
                    return Err(AppError::invalid_input("模型响应超过 1 MB 限制"));
                }
            }
        }
        Ok(())
    }
    fn end_line(&mut self, on_progress: &mut (dyn FnMut(&str, &str) + Send)) -> AppResult<()> {
        let line = std::mem::take(&mut self.line);
        if line.is_empty() {
            if !self.data.is_empty() {
                let data = std::mem::take(&mut self.data);
                self.event(&data, on_progress)?;
            }
        } else if let Some(data) = line.strip_prefix(b"data:") {
            let data = data.strip_prefix(b" ").unwrap_or(data);
            self.data.extend_from_slice(data);
            self.data.push(b'\n');
        }
        // Comments (DeepSeek keepalives), event names and unknown SSE fields are ignored.
        Ok(())
    }
    fn event(
        &mut self,
        data: &[u8],
        on_progress: &mut (dyn FnMut(&str, &str) + Send),
    ) -> AppResult<()> {
        if data.trim_ascii() == b"[DONE]" {
            self.done = true;
            return Ok(());
        }
        let event: Value = serde_json::from_slice(data)
            .map_err(|_| AppError::invalid_input("模型流式响应不是有效 JSON"))?;
        if !event["error"].is_null() {
            return Err(AppError::internal(
                "模型服务在生成过程中返回错误，请检查模型与中转站状态",
            ));
        }
        let choices = event["choices"]
            .as_array()
            .ok_or_else(|| AppError::invalid_input("服务未返回兼容的流式响应"))?;
        // A final usage-only chunk has no choices.
        if choices.is_empty() {
            return Ok(());
        }
        if choices.len() != 1 || choices[0]["index"].as_u64().unwrap_or(0) != 0 {
            return Err(AppError::invalid_input("服务未返回兼容的流式响应"));
        }
        let choice = &choices[0];
        let delta = &choice["delta"];
        if self.finish_reason.is_some() {
            return Err(AppError::invalid_input("服务未返回兼容的流式响应"));
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
            // The executor accepts one tool at a time. Reject parallel calls before execution.
            if calls.len() != 1 || calls[0]["index"].as_u64() != Some(0) {
                return Err(AppError::invalid_input(
                    "已阻止并行工具调用，请使用支持单工具调用的模型",
                ));
            }
            if self.message["tool_calls"].is_null() {
                self.message["tool_calls"] =
                    json!([{"id":"", "type":"function", "function":{"name":"", "arguments":""}}]);
            }
            let part = &calls[0];
            let call = &mut self.message["tool_calls"][0];
            for key in ["id", "type"] {
                if let Some(value) = part.get(key).filter(|value| !value.is_null()) {
                    if !value.is_string() {
                        return Err(AppError::invalid_input("模型工具调用分片无效"));
                    }
                    if key == "type" && value != "function" {
                        return Err(AppError::invalid_input("不支持的工具类型"));
                    }
                    if key == "id" && call[key] != "" && call[key] != *value {
                        return Err(AppError::invalid_input("模型工具调用分片无效"));
                    }
                    call[key] = value.clone();
                }
            }
            for key in ["name", "arguments"] {
                if let Some(text) = part["function"][key].as_str() {
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
            phase = "tool";
        }
        if !phase.is_empty() {
            on_progress(self.message["content"].as_str().unwrap_or(""), phase);
        }
        if let Some(reason) = choice["finish_reason"].as_str() {
            self.finish_reason = Some(reason.into());
        }
        Ok(())
    }
    fn finish(mut self, on_progress: &mut (dyn FnMut(&str, &str) + Send)) -> AppResult<Value> {
        // Accept EOF immediately after a final data line, including an unterminated [DONE].
        if !self.done {
            if !self.line.is_empty() {
                self.end_line(on_progress)?;
            }
            if !self.data.is_empty() {
                let data = std::mem::take(&mut self.data);
                self.event(&data, on_progress)?;
            }
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
            if calls.len() != 1 {
                return Err(AppError::invalid_input(
                    "已阻止并行工具调用，请使用支持单工具调用的模型",
                ));
            }
            let call = &calls[0];
            if call["id"].as_str().unwrap_or("").is_empty()
                || call["function"]["name"].as_str().unwrap_or("").is_empty()
                || !serde_json::from_str::<Value>(
                    call["function"]["arguments"].as_str().unwrap_or(""),
                )
                .is_ok_and(|value| value.is_object())
            {
                return Err(AppError::invalid_input("模型工具调用分片无效"));
            }
        }
        Ok(json!({"choices":[{"message":self.message, "finish_reason":self.finish_reason}]}))
    }
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
    on_progress: &mut (dyn FnMut(&str, &str) + Send),
) -> AppResult<Value> {
    let mut response = request.send().await.map_err(config::request_error)?;
    config::check_status(&response)?;
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
        if !response["error"].is_null() {
            return Err(AppError::internal(
                "模型服务在生成过程中返回错误，请检查模型与中转站状态",
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
        let mut decoder = Decoder::new();
        // Exercise split UTF-8, split CRLF and JSON boundaries on every byte.
        for byte in wire.as_bytes() {
            decoder.push(&[*byte], &mut |_, _| {})?;
        }
        decoder.finish(&mut |_, _| {})
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
    fn rejects_truncation_length_errors_and_parallel_calls() {
        let tool = chunk(
            json!({"tool_calls":[{"index":0,"id":"call","function":{"name":"server_status","arguments":"{\"probe\":\"disk\"}"}}]}),
            Value::Null,
        );
        for wire in [
            tool.clone(),
            tool.clone() + "data: [DONE]\n\n",
            tool.clone() + &chunk(json!({}), json!("length")) + "data: [DONE]\n\n",
            tool.clone() + &chunk(json!({}), json!("stop")),
            chunk(
                json!({"tool_calls":[{"index":1,"function":{"arguments":"{}"}}]}),
                Value::Null,
            ),
            "data: {\"error\":{\"message\":\"secret-value\"}}\n\n".into(),
            "data: invalid\n\n".into(),
            chunk(json!({"content":"partial"}), Value::Null),
        ] {
            let error = parse(&wire).unwrap_err();
            assert!(!error.message.contains("secret-value"));
        }
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
