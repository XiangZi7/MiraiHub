//! 窗口绑定的 Docker follow 日志流。每批输出在前端接收后才继续读，避免无限堆积。
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{ipc::Channel, Manager, State, WebviewWindow};
use tokio::sync::{oneshot, Notify};
use tokio::time::{sleep_until, Instant};

use super::{connect, log_stream::LogDecoder, validate_log_window, with_log_tunnel, Target};
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

/// 同一请求先读取最近 200 行，然后继续接收新日志，无历史/实时切换间隙。
pub(super) async fn read_stream(
    target: Target,
    sessions: &SessionManager,
    id: &str,
    output: &Channel<Event>,
    acknowledged: &Notify,
) -> AppResult<()> {
    let (engine, prefix) = connect(target, sessions).await?;
    let path =
        format!("{prefix}/containers/{id}/logs?stdout=1&stderr=1&timestamps=1&tail=200&follow=1");
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

#[tauri::command]
pub async fn docker_logs_follow(
    window: WebviewWindow,
    target: Target,
    manager: State<'_, SessionManager>,
    id: String,
    connection_id: String,
    ssh_config: Option<SshConfig>,
    subscription_id: uuid::Uuid,
    output: Channel<Event>,
) -> AppResult<()> {
    validate_log_window(&window, &connection_id, &id, &target, ssh_config.as_ref())?;
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
        with_log_tunnel(
            target,
            &manager,
            ssh_config,
            async {
                let _ = cancelled.await;
            },
            |target| read_stream(target, &manager, &id, &output, &acknowledged),
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
