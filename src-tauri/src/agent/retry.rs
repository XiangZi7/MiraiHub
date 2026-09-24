//! Retry only model requests. Tool execution stays outside this loop.
use super::{clip, now, protocol, Cell, Progress, Run};
use crate::error::{AppError, AppResult, ErrorKind};
use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Notice {
    attempt: usize,
    max: usize,
    retry_at: i64,
    reason: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{config::ApiFormat, tests::pending_run};
    use serde_json::json;
    use std::sync::{atomic::AtomicBool, Arc};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::{Mutex, Notify},
    };

    fn cell() -> Cell {
        Cell {
            cancelled: AtomicBool::new(false),
            cancel_notify: Notify::new(),
            run: Mutex::new(pending_run()),
        }
    }

    fn response(status: u16, body: &str, headers: &str) -> String {
        format!("HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len())
    }

    async fn mock(
        responses: Vec<String>,
    ) -> (Run, Arc<Mutex<Vec<Value>>>, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut run = pending_run();
        run.status = "running".into();
        run.pending = None;
        run.steps = 1;
        run.config.enabled = true;
        run.config.model = "test-model".into();
        run.config.base_url = format!("http://{}/v1", listener.local_addr().unwrap());
        run.config.api_key = "test-secret-for-redaction".into();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let server = tokio::spawn(async move {
            let mut index = 0;
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buf = [0u8; 4096];
                loop {
                    let count = stream.read(&mut buf).await.unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buf[..count]);
                    if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                        let length: usize = headers
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length:"))
                            .unwrap()
                            .trim()
                            .parse()
                            .unwrap();
                        if request.len() >= end + 4 + length {
                            captured.lock().await.push(
                                serde_json::from_slice(&request[end + 4..end + 4 + length])
                                    .unwrap(),
                            );
                            break;
                        }
                    }
                }
                stream
                    .write_all(responses[index.min(responses.len() - 1)].as_bytes())
                    .await
                    .unwrap();
                index += 1;
            }
        });
        (run, requests, server)
    }

    #[test]
    fn backoff_is_bounded_even_at_999_and_honors_server_delay() {
        let mut error = AppError::network("limited");
        for (attempt, seconds) in [(1, 2), (2, 4), (5, 32), (6, 60), (999, 60)] {
            assert_eq!(delay(&error, attempt), Duration::from_secs(seconds));
        }
        error.retry_after = Some(Duration::from_secs(90));
        assert_eq!(delay(&error, 1), Duration::from_secs(90));
    }

    #[tokio::test]
    async fn rate_limit_resends_the_same_request_for_all_protocols() {
        for (format, body) in [
            (
                ApiFormat::Openai,
                json!({"choices":[{"message":{"role":"assistant","content":"done"}}]}),
            ),
            (
                ApiFormat::Responses,
                json!({"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}]}),
            ),
            (
                ApiFormat::Anthropic,
                json!({"stop_reason":"end_turn","content":[{"type":"text","text":"done"}]}),
            ),
        ] {
            let (mut run, requests, server) = mock(vec![
                response(
                    429,
                    r#"{"error":{"message":"5 requests per minute test-secret-for-redaction"}}"#,
                    "retry-after-ms: 10\r\n",
                ),
                response(200, &body.to_string(), "Content-Type: application/json\r\n"),
            ])
            .await;
            run.config.api_format = format;
            let messages = vec![json!({"role":"user","content":"hello"})];
            let mut events = Vec::new();
            let start = Instant::now();
            let result = completion(&mut run, &messages, &cell(), &mut |event| {
                events.push(event)
            })
            .await
            .unwrap();
            assert_eq!(result["choices"][0]["message"]["content"], "done");
            assert!(start.elapsed() >= Duration::from_millis(10));
            let requests = requests.lock().await;
            assert_eq!(requests.len(), 2);
            assert_eq!(requests[0], requests[1]);
            assert_eq!(run.steps, 1);
            assert!(run.entries.is_empty());
            assert!(run.messages.is_empty());
            let notice = events
                .iter()
                .find_map(|event| event.retry.as_ref())
                .unwrap();
            assert_eq!(notice.attempt, 1);
            assert_eq!(notice.max, 5);
            assert!(!notice.reason.contains("test-secret-for-redaction"));
            assert_eq!(events.last().unwrap().phase, "thinking");
            server.abort();
        }
    }

    #[tokio::test]
    async fn permanent_errors_disabled_retries_and_exhaustion_stop_at_the_right_count() {
        for (status, body, max, expected) in [
            (401, "{}", 999, 1),
            (429, r#"{"error":{"code":"insufficient_quota"}}"#, 999, 1),
            (429, "{}", 0, 1),
            (503, "{}", 2, 3),
        ] {
            let (mut run, requests, server) =
                mock(vec![response(status, body, "retry-after-ms: 0\r\n")]).await;
            run.config.limits.max_retries = max;
            let mut events = Vec::new();
            assert!(
                completion(&mut run, &[], &cell(), &mut |event| events.push(event))
                    .await
                    .is_err()
            );
            assert_eq!(requests.lock().await.len(), expected);
            assert_eq!(
                events.iter().filter(|event| event.retry.is_some()).count(),
                expected - 1
            );
            server.abort();
        }
    }

    #[tokio::test]
    async fn stop_interrupts_retry_wait_without_resending_or_taking_the_run_lock() {
        let (mut run, requests, server) =
            mock(vec![response(429, "{}", "Retry-After: 600\r\n")]).await;
        let cell = cell();
        let _lock = cell.run.lock().await;
        let error = tokio::time::timeout(
            Duration::from_secs(2),
            completion(&mut run, &[], &cell, &mut |event| {
                if event.retry.is_some() {
                    cell.cancel();
                }
            }),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(error.message, "任务已取消");
        assert_eq!(requests.lock().await.len(), 1);
        server.abort();
    }

    #[tokio::test]
    async fn interrupted_tool_stream_is_discarded_before_a_fresh_attempt() {
        let partial = "data: {\"choices\":[{\"delta\":{\"content\":\"old partial\",\"tool_calls\":[{\"index\":0,\"id\":\"old-call\",\"type\":\"function\",\"function\":{\"name\":\"propose_shell\",\"arguments\":\"{\\\"command\\\":\"}}]}}]}\n\n";
        let (mut run, requests, server) = mock(vec![
            response(200, partial, "Content-Type: text/event-stream\r\n"),
            response(200, r#"{"choices":[{"message":{"role":"assistant","content":"fresh answer"},"finish_reason":"stop"}]}"#, "Content-Type: application/json\r\n"),
        ]).await;
        run.config.limits.max_retries = 1;
        let mut events = Vec::new();
        let result = completion(&mut run, &[], &cell(), &mut |event| events.push(event))
            .await
            .unwrap();
        assert_eq!(requests.lock().await.len(), 2);
        assert_eq!(result["choices"][0]["message"]["content"], "fresh answer");
        assert!(result["choices"][0]["message"]["tool_calls"].is_null());
        assert!(events.iter().any(|event| event.text == "old partial"));
        assert!(events
            .iter()
            .filter(|event| event.retry.is_some())
            .all(|event| event.text.is_empty()));
        assert!(run.entries.is_empty());
        assert!(run.messages.is_empty());
        assert!(run.pending.is_none());
        server.abort();
    }

    #[tokio::test]
    async fn a_final_interruption_keeps_partial_text_only_in_the_transcript() {
        let partial = "data: {\"choices\":[{\"delta\":{\"content\":\"partial answer\"}}]}\n\n";
        let (mut run, requests, server) = mock(vec![response(
            200,
            partial,
            "Content-Type: text/event-stream\r\n",
        )])
        .await;
        run.config.limits.max_retries = 0;
        assert!(completion(&mut run, &[], &cell(), &mut |_| {})
            .await
            .is_err());
        assert_eq!(requests.lock().await.len(), 1);
        assert_eq!(run.entries.len(), 1);
        assert_eq!(run.entries[0].text, "partial answer");
        assert!(run.messages.is_empty());
        server.abort();
    }
}

fn delay(error: &AppError, attempt: usize) -> Duration {
    error
        .retry_after
        .unwrap_or_else(|| Duration::from_secs((2u64 << attempt.saturating_sub(1).min(5)).min(60)))
}

pub(super) async fn completion(
    run: &mut Run,
    messages: &[Value],
    cell: &Cell,
    emit: &mut (dyn FnMut(Progress) + Send),
) -> AppResult<Value> {
    let mut attempt = 0;
    loop {
        run.check(cell)?;
        // Clear stale partial output and the retry countdown before each request,
        // including providers that do not send progress until their first token.
        emit(Progress {
            run_id: run.id.clone(),
            text: String::new(),
            phase: "thinking".into(),
            retry: None,
        });
        let mut partial_text = String::new();
        let result = {
            let mut last_update = Instant::now();
            let mut last_phase = String::new();
            let mut on_progress = |text: &str, phase: &str| {
                partial_text = clip(text, 16000);
                if phase != last_phase || last_update.elapsed() >= Duration::from_millis(50) {
                    emit(Progress {
                        run_id: run.id.clone(),
                        text: partial_text.clone(),
                        phase: phase.into(),
                        retry: None,
                    });
                    last_update = Instant::now();
                    last_phase = phase.into();
                }
            };
            tokio::select! {
                biased;
                _ = cell.cancellation() => Err(AppError::invalid_input("任务已取消")),
                result = protocol::streaming_completion(
                    &run.config, messages, Some(run.tools.definitions()), &mut on_progress,
                ) => result,
            }
        };
        match result {
            Err(error)
                if matches!(error.kind, ErrorKind::Network)
                    && attempt < run.config.limits.max_retries =>
            {
                run.check(cell)?;
                attempt += 1;
                let wait = delay(&error, attempt);
                emit(Progress {
                    run_id: run.id.clone(),
                    text: String::new(),
                    phase: "retrying".into(),
                    retry: Some(Notice {
                        attempt,
                        max: run.config.limits.max_retries,
                        retry_at: now() + wait.as_millis() as i64,
                        reason: error.message,
                    }),
                });
                tokio::select! {
                    biased;
                    _ = cell.cancellation() => return Err(AppError::invalid_input("任务已取消")),
                    _ = tokio::time::sleep(wait) => {},
                }
            }
            result => {
                if result.is_err() && !partial_text.is_empty() {
                    // Keep only the final failed attempt for viewing, never as
                    // complete model/tool history or executable tool arguments.
                    run.entry("assistant", partial_text, None);
                }
                return result;
            }
        }
    }
}
