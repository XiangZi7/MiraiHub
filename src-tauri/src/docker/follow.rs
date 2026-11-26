//! 窗口绑定的 Docker follow 日志流。每批输出在前端接收后才继续读，避免无限堆积。
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    ipc::{Channel, InvokeBody, Request},
    Manager, State, WebviewWindow,
};
use tokio::sync::{oneshot, Notify};
use tokio::time::{sleep_until, Instant};

use super::{connect, log_stream::LogDecoder, validate_window, with_window_tunnel, Kind, Target};
use crate::{
    error::{AppError, AppResult},
    ssh::{models::SshConfig, SessionManager},
};

struct Subscription {
    id: uuid::Uuid,
    _cancel: oneshot::Sender<()>,
    acknowledged: Arc<Notify>,
}

#[derive(Default)]
pub(crate) struct WindowFeed(Mutex<Option<Subscription>>);

impl WindowFeed {
    fn begin(&self, id: uuid::Uuid) -> (oneshot::Receiver<()>, Arc<Notify>) {
        let (cancel, cancelled) = oneshot::channel();
        let acknowledged = Arc::new(Notify::new());
        // 丢弃旧 sender 会唤醒正在等响应头、日志或前端确认的旧任务。
        *self.0.lock().unwrap() = Some(Subscription {
            id,
            _cancel: cancel,
            acknowledged: acknowledged.clone(),
        });
        (cancelled, acknowledged)
    }
    fn stop(&self, id: uuid::Uuid) {
        let mut active = self.0.lock().unwrap();
        if active.as_ref().is_some_and(|s| s.id == id) {
            active.take();
        }
    }
    fn acknowledge(&self, id: uuid::Uuid) {
        if let Some(active) = self.0.lock().unwrap().as_ref().filter(|s| s.id == id) {
            active.acknowledged.notify_one();
        }
    }
}

#[derive(Default)]
pub struct LogWindows(Mutex<HashMap<String, Arc<WindowFeed>>>);

impl LogWindows {
    pub(crate) fn open(&self, label: &str) -> Arc<WindowFeed> {
        let feed = Arc::new(WindowFeed::default());
        self.0
            .lock()
            .unwrap()
            .insert(label.to_owned(), feed.clone());
        feed
    }

    pub(crate) fn close(&self, label: &str, feed: &Arc<WindowFeed>) {
        let mut windows = self.0.lock().unwrap();
        if windows
            .get(label)
            .is_some_and(|current| Arc::ptr_eq(current, feed))
        {
            windows.remove(label);
        }
        feed.0.lock().unwrap().take();
    }

    fn get(&self, window: &WebviewWindow) -> AppResult<Arc<WindowFeed>> {
        self.0
            .lock()
            .unwrap()
            .get(window.label())
            .cloned()
            .ok_or_else(|| AppError::not_found("日志窗口已关闭"))
    }
}

#[derive(Serialize)]
#[serde(tag = "type", content = "text", rename_all = "lowercase")]
pub enum Event {
    Ready,
    Text(String),
}

#[derive(Clone, Copy, Deserialize)]
pub struct LogQuery {
    since: Option<i64>,
    until: Option<i64>,
    follow: bool,
}

impl Default for LogQuery {
    fn default() -> Self {
        Self {
            since: None,
            until: None,
            follow: true,
        }
    }
}

impl LogQuery {
    /// 有时间范围时让引擎遍历该段历史，避免 tail=200 先截掉旧日志。
    fn path(self, prefix: &str, id: &str) -> AppResult<String> {
        if matches!((self.since, self.until), (Some(s), Some(u)) if s >= u) {
            return Err(AppError::invalid_input("日志开始时间必须早于结束时间"));
        }
        if self.until.is_some()
            && prefix
                .strip_prefix("/v1.")
                .and_then(|v| v.parse::<u16>().ok())
                .is_some_and(|v| v < 35)
        {
            return Err(AppError::invalid_input(
                "按结束时间读取日志需要 Docker API 1.35 或更高版本",
            ));
        }
        let tail = if self.since.is_some() || self.until.is_some() {
            "all"
        } else {
            "200"
        };
        let mut path =
            format!("{prefix}/containers/{id}/logs?stdout=1&stderr=1&timestamps=1&tail={tail}");
        if self.follow {
            path.push_str("&follow=1");
        }
        if let Some(since) = self.since {
            path.push_str(&format!("&since={since}"));
        }
        if let Some(until) = self.until {
            path.push_str(&format!("&until={until}"));
        }
        Ok(path)
    }
}

/// 实时订阅和历史查询复用可取消的分块传输，时段再长也不把完整响应攒在内存里。
pub(super) async fn read_stream(
    target: Target,
    sessions: &SessionManager,
    id: &str,
    output: &Channel<Event>,
    acknowledged: &Notify,
    query: LogQuery,
) -> AppResult<()> {
    let (engine, prefix) = connect(target, sessions).await?;
    let path = query.path(&prefix, id)?;
    let (mut response, _drivers) = engine.stream(&path).await?;
    let mut decoder = LogDecoder::default();
    let mut batch = String::new();
    let mut flush_at = Instant::now();
    let send = async |text: String| -> AppResult<()> {
        if !text.is_empty() {
            output
                .send(Event::Text(text))
                .map_err(|e| AppError::internal(e.to_string()))?;
            acknowledged.notified().await;
        }
        Ok(())
    };
    loop {
        tokio::select! {
            biased;
            _ = sleep_until(flush_at), if !batch.is_empty() => {
                send(std::mem::take(&mut batch)).await?;
            }
            chunk = response.chunk() => {
                let Some(bytes) = chunk.map_err(|e| AppError::network(format!("Docker Engine: {e}")))? else {
                    batch.push_str(&decoder.finish()?);
                    return send(batch).await;
                };
                for part in bytes.chunks(16 * 1024) {
                    if batch.is_empty() {
                        flush_at = Instant::now() + Duration::from_millis(40);
                    }
                    batch.push_str(&decoder.push(part)?);
                    if batch.len() >= 16 * 1024 {
                        send(std::mem::take(&mut batch)).await?;
                    }
                }
            }
        }
    }
}

/// 沿用 WebView 发送的顶层字段，输出通道由 Tauri 单独解析并绑定到调用窗口。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowRequest {
    target: Target,
    id: String,
    connection_id: String,
    ssh_config: Option<SshConfig>,
    subscription_id: uuid::Uuid,
    query: Option<LogQuery>,
}

impl FollowRequest {
    fn from_body(body: &InvokeBody) -> AppResult<Self> {
        let InvokeBody::Json(json) = body else {
            return Err(AppError::invalid_input("日志订阅需要 JSON 参数"));
        };
        Self::deserialize(json).map_err(|error| AppError::invalid_input(error.to_string()))
    }
}

#[tauri::command]
pub async fn docker_logs_follow(
    window: WebviewWindow,
    manager: State<'_, SessionManager>,
    request: Request<'_>,
    output: Channel<Event>,
) -> AppResult<()> {
    let FollowRequest {
        target,
        id,
        connection_id,
        ssh_config,
        subscription_id,
        query,
    } = FollowRequest::from_body(request.body())?;
    validate_window(
        Kind::Logs,
        &window,
        &connection_id,
        &id,
        &target,
        ssh_config.as_ref(),
    )?;
    let windows = window.state::<LogWindows>();
    // 与销毁同步登记，关闭过的窗口不能在移除后新建订阅。
    let (feed, cancelled, acknowledged) = {
        let entries = windows.0.lock().unwrap();
        let feed = entries
            .get(window.label())
            .ok_or_else(|| AppError::not_found("日志窗口已关闭"))?
            .clone();
        let (cancelled, acknowledged) = feed.begin(subscription_id);
        (feed, cancelled, acknowledged)
    };
    let result = async {
        output
            .send(Event::Ready)
            .map_err(|e| AppError::internal(e.to_string()))?;
        with_window_tunnel(
            target,
            &manager,
            ssh_config,
            async {
                let _ = cancelled.await;
            },
            |target| {
                read_stream(
                    target,
                    &manager,
                    &id,
                    &output,
                    &acknowledged,
                    query.unwrap_or_default(),
                )
            },
        )
        .await
    }
    .await;
    feed.stop(subscription_id);
    result
}

#[tauri::command]
pub fn docker_logs_follow_stop(
    window: WebviewWindow,
    windows: State<'_, LogWindows>,
    subscription_id: uuid::Uuid,
) -> AppResult<()> {
    windows.get(&window)?.stop(subscription_id);
    Ok(())
}

#[tauri::command]
pub fn docker_logs_follow_ack(
    window: WebviewWindow,
    windows: State<'_, LogWindows>,
    subscription_id: uuid::Uuid,
) -> AppResult<()> {
    windows.get(&window)?.acknowledge(subscription_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscription_reads_the_existing_webview_payload() {
        let subscription_id = uuid::Uuid::new_v4();
        let mut payload = serde_json::json!({
            "target": { "protocol": "http", "transport": "direct", "endpoint": "http://localhost" },
            "id": "a".repeat(64),
            "connectionId": "local",
            "subscriptionId": subscription_id,
            "output": "__CHANNEL__:42"
        });
        let legacy = FollowRequest::from_body(&InvokeBody::Json(payload.clone())).unwrap();
        assert_eq!(legacy.subscription_id, subscription_id);
        assert_eq!(legacy.connection_id, "local");
        assert!(legacy.ssh_config.is_none() && legacy.query.unwrap_or_default().follow);

        payload["query"] = serde_json::json!({ "follow": false, "since": 100, "until": 200 });
        let query = FollowRequest::from_body(&InvokeBody::Json(payload))
            .unwrap()
            .query
            .unwrap();
        assert!(!query.follow);
        assert_eq!((query.since, query.until), (Some(100), Some(200)));
        assert!(FollowRequest::from_body(&InvokeBody::Raw(Vec::new())).is_err());
    }

    #[test]
    fn historical_bounds_are_applied_before_tailing_and_old_engines_never_ignore_until() {
        let mut range = LogQuery {
            since: Some(120),
            until: Some(180),
            follow: false,
        };
        let path = range.path("/v1.35", "id").unwrap();
        assert!(path.ends_with("tail=all&since=120&until=180"));
        assert!(range.path("/v1.34", "id").is_err());
        range.follow = true;
        assert!(range
            .path("/v1.35", "id")
            .unwrap()
            .contains("tail=all&follow=1&since=120&until=180"));
        range.until = Some(119);
        assert!(range.path("/v1.35", "id").is_err());
        range.until = None;
        assert!(range
            .path("/v1.24", "id")
            .unwrap()
            .ends_with("tail=all&follow=1&since=120"));
    }
    #[tokio::test]
    async fn cancelling_and_closing_are_scoped_to_the_current_window_and_run() {
        let windows = LogWindows::default();
        let first = windows.open("first");
        let second = windows.open("second");
        let id = uuid::Uuid::new_v4();
        let (old, _) = first.begin(id);
        let newer = uuid::Uuid::new_v4();
        let (mut current, ack) = first.begin(newer);
        let (mut other, _) = second.begin(id);
        old.await.unwrap_err();
        first.stop(id);
        assert!(matches!(
            current.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        first.acknowledge(newer);
        ack.notified().await;
        windows.close("first", &first);
        current.await.unwrap_err();
        assert!(matches!(
            other.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        second.stop(id);
        other.await.unwrap_err();
    }
}
