//! 文件传输任务控制：暂停、继续与取消。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{Notify, RwLock};

use super::error::{SshError, SshResult};

/// 进度事件的最小间隔。每个数据块都推一次会让大文件传输被 IPC 序列化拖慢，
/// 前端进度条也用不到更高的刷新率。
const PROGRESS_REPORT_INTERVAL_MS: u64 = 40;

pub struct TransferControl {
    paused: AtomicBool,
    cancelled: AtomicBool,
    transferred: AtomicU64,
    total: AtomicU64,
    wake: Notify,
    started: Instant,
    last_report_ms: AtomicU64,
}

impl TransferControl {
    fn new(total: u64) -> Self {
        Self {
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            transferred: AtomicU64::new(0),
            total: AtomicU64::new(total),
            wake: Notify::new(),
            started: Instant::now(),
            last_report_ms: AtomicU64::new(0),
        }
    }

    /// 距上次进度推送是否已超过节流间隔。返回 true 时同时记下本次推送时间。
    pub fn should_report(&self) -> bool {
        let now = self.started.elapsed().as_millis() as u64;
        let last = self.last_report_ms.load(Ordering::Relaxed);
        if now.saturating_sub(last) < PROGRESS_REPORT_INTERVAL_MS {
            return false;
        }
        self.last_report_ms
            .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
    }

    pub async fn checkpoint(&self) -> SshResult<()> {
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                return Err(SshError::TransferCancelled);
            }
            if !self.paused.load(Ordering::SeqCst) {
                return Ok(());
            }

            let notified = self.wake.notified();
            if !self.paused.load(Ordering::SeqCst) {
                continue;
            }
            notified.await;
        }
    }

    pub fn set_transferred(&self, value: u64) {
        self.transferred.store(value, Ordering::Relaxed);
    }

    pub fn add_transferred(&self, value: u64) -> u64 {
        self.transferred.fetch_add(value, Ordering::Relaxed) + value
    }

    pub fn set_total(&self, total: u64) {
        self.total.store(total, Ordering::Relaxed);
    }

    pub fn progress(&self) -> (u64, u64) {
        (
            self.transferred.load(Ordering::Relaxed),
            self.total.load(Ordering::Relaxed),
        )
    }
}

#[derive(Default)]
pub struct TransferManager {
    controls: RwLock<HashMap<String, Arc<TransferControl>>>,
}

impl TransferManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn begin(&self, task_id: &str, total: u64) -> SshResult<Arc<TransferControl>> {
        let mut controls = self.controls.write().await;
        if controls.contains_key(task_id) {
            return Err(SshError::InvalidInput(format!("传输任务 {task_id} 已存在")));
        }
        let control = Arc::new(TransferControl::new(total));
        controls.insert(task_id.to_owned(), Arc::clone(&control));
        Ok(control)
    }

    pub async fn finish(&self, task_id: &str) {
        self.controls.write().await.remove(task_id);
    }

    pub async fn pause(&self, task_id: &str) -> SshResult<(u64, u64)> {
        let control = self.get(task_id).await?;
        control.paused.store(true, Ordering::SeqCst);
        Ok(control.progress())
    }

    pub async fn resume(&self, task_id: &str) -> SshResult<(u64, u64)> {
        let control = self.get(task_id).await?;
        control.paused.store(false, Ordering::SeqCst);
        control.wake.notify_waiters();
        Ok(control.progress())
    }

    pub async fn cancel(&self, task_id: &str) -> SshResult<(u64, u64)> {
        let control = self.get(task_id).await?;
        control.cancelled.store(true, Ordering::SeqCst);
        control.wake.notify_waiters();
        Ok(control.progress())
    }

    pub async fn cancel_all(&self) {
        for control in self.controls.read().await.values() {
            control.cancelled.store(true, Ordering::SeqCst);
            control.wake.notify_waiters();
        }
    }

    async fn get(&self, task_id: &str) -> SshResult<Arc<TransferControl>> {
        self.controls
            .read()
            .await
            .get(task_id)
            .cloned()
            .ok_or_else(|| SshError::InvalidInput(format!("传输任务 {task_id} 不存在或已结束")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn paused_transfer_resumes_from_checkpoint() {
        let manager = TransferManager::new();
        let control = manager.begin("one", 10).await.unwrap();
        manager.pause("one").await.unwrap();

        let waiter = tokio::spawn(async move { control.checkpoint().await });
        tokio::task::yield_now().await;
        assert!(!waiter.is_finished());

        manager.resume("one").await.unwrap();
        assert!(waiter.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn cancelled_transfer_leaves_checkpoint_with_cancelled_error() {
        let manager = TransferManager::new();
        let control = manager.begin("two", 10).await.unwrap();
        manager.pause("two").await.unwrap();
        manager.cancel("two").await.unwrap();

        assert!(matches!(
            control.checkpoint().await,
            Err(SshError::TransferCancelled)
        ));
    }
}
