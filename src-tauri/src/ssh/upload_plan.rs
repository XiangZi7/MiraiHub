//! 在写入远端前展开本地目录，保留空目录并计算整个任务的字节数。

use std::future::Future;
use std::path::{Path, PathBuf};

use futures_util::{stream::FuturesUnordered, StreamExt};

use super::error::{SshError, SshResult};
use super::transfers::TransferControl;

pub struct UploadEntry {
    pub local_path: PathBuf,
    pub remote_path: String,
    pub is_directory: bool,
}

pub struct UploadPlan {
    pub entries: Vec<UploadEntry>,
    pub total_bytes: u64,
}

/// 限制目录内并行上传数；出错后停止派发，等待已开始的文件完成清理。
pub async fn run_upload_jobs<I, F, Fut>(items: I, concurrency: usize, upload: F) -> SshResult<()>
where
    I: IntoIterator,
    F: Fn(I::Item) -> Fut,
    Fut: Future<Output = SshResult<()>>,
{
    let mut items = items.into_iter();
    let mut running = FuturesUnordered::new();
    for item in items.by_ref().take(concurrency.clamp(1, 8)) {
        running.push(upload(item));
    }
    let mut first_error = None;
    while let Some(result) = running.next().await {
        if let Err(error) = result {
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
        if first_error.is_none() {
            if let Some(item) = items.next() {
                running.push(upload(item));
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

pub async fn build_upload_plan(
    local_path: &Path,
    remote_path: &str,
    control: &TransferControl,
) -> SshResult<UploadPlan> {
    let mut plan = UploadPlan {
        entries: Vec::new(),
        total_bytes: 0,
    };
    let mut pending = vec![(local_path.to_path_buf(), remote_path.to_owned())];
    while let Some((local_path, remote_path)) = pending.pop() {
        control.checkpoint().await?;
        // 不跟随符号链接，避免目录循环或把所选目录以外的内容一起上传。
        let metadata = tokio::fs::symlink_metadata(&local_path).await?;
        if metadata.is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
            return Err(SshError::InvalidInput(format!(
                "无法上传符号链接或特殊文件：{}",
                local_path.display()
            )));
        }
        if metadata.is_dir() {
            let mut children = tokio::fs::read_dir(&local_path).await?;
            while let Some(child) = children.next_entry().await? {
                control.checkpoint().await?;
                let name = child
                    .file_name()
                    .into_string()
                    .map_err(|_| SshError::InvalidInput("上传文件名必须是有效的 UTF-8".into()))?;
                pending.push((
                    child.path(),
                    format!("{}/{name}", remote_path.trim_end_matches('/')),
                ));
            }
        } else {
            plan.total_bytes += metadata.len();
        }
        plan.entries.push(UploadEntry {
            local_path,
            remote_path,
            is_directory: metadata.is_dir(),
        });
    }
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::transfers::TransferManager;

    async fn scan(local: &Path, remote: &str) -> SshResult<UploadPlan> {
        let manager = TransferManager::new();
        let control = manager.begin("test", 0).await?;
        build_upload_plan(local, remote, &control).await
    }

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("miraihub-upload-{}", rand::random::<u64>()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn directory_plan_preserves_nested_empty_and_hidden_entries() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.0.join("子目录/empty")).unwrap();
        std::fs::write(fixture.0.join("子目录/a b.txt"), b"hello").unwrap();
        std::fs::write(fixture.0.join(".hidden"), b"hi").unwrap();
        let plan = scan(&fixture.0, "/uploads/project").await.unwrap();
        assert_eq!(plan.total_bytes, 7);
        assert_eq!(plan.entries.len(), 5);
        assert_eq!(plan.entries[0].remote_path, "/uploads/project");
        for (index, entry) in plan.entries.iter().enumerate().skip(1) {
            let parent = entry.remote_path.rsplit_once('/').unwrap().0;
            assert!(plan.entries[..index]
                .iter()
                .any(|entry| entry.is_directory && entry.remote_path == parent));
        }
        assert!(plan
            .entries
            .iter()
            .any(|entry| entry.is_directory && entry.remote_path.ends_with("/empty")));
        assert!(plan
            .entries
            .iter()
            .any(|entry| entry.remote_path.ends_with("/.hidden")));
        assert!(plan
            .entries
            .iter()
            .any(|entry| entry.remote_path.ends_with("/子目录/a b.txt")));
    }

    #[tokio::test]
    async fn single_file_and_empty_directory_are_valid_uploads() {
        let fixture = Fixture::new();
        let empty = scan(&fixture.0, "/empty").await.unwrap();
        assert_eq!(empty.entries.len(), 1);
        assert_eq!(empty.total_bytes, 0);
        assert!(empty.entries[0].is_directory);
        let file = fixture.0.join("a.txt");
        std::fs::write(&file, b"abc").unwrap();
        let plan = scan(&file, "/a.txt").await.unwrap();
        assert_eq!(plan.total_bytes, 3);
        assert_eq!(plan.entries.len(), 1);
        assert!(!plan.entries[0].is_directory);
        assert!(scan(&fixture.0.join("missing"), "/missing").await.is_err());
    }

    #[tokio::test]
    async fn cancelled_scan_stops_before_reading_local_files() {
        let fixture = Fixture::new();
        let manager = TransferManager::new();
        let control = manager.begin("cancel-scan", 0).await.unwrap();
        manager.cancel("cancel-scan").await.unwrap();
        assert!(matches!(
            build_upload_plan(&fixture.0.join("missing"), "/upload", &control).await,
            Err(SshError::TransferCancelled)
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlink_cycles_before_remote_writes() {
        let fixture = Fixture::new();
        std::os::unix::fs::symlink(&fixture.0, fixture.0.join("loop")).unwrap();
        assert!(scan(&fixture.0, "/upload").await.is_err());
    }
}

#[cfg(test)]
mod concurrency_tests {
    use super::*;
    use crate::ssh::transfers::TransferManager;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::sync::{mpsc, Semaphore};

    #[tokio::test]
    async fn upload_jobs_fill_the_limit_and_sum_progress() {
        let gate = Arc::new(Semaphore::new(0));
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let manager = TransferManager::new();
        let control = manager.begin("parallel", 35).await.unwrap();
        let (started, mut receiver) = mpsc::unbounded_channel();
        let worker = {
            let gate = gate.clone();
            let active = active.clone();
            let peak = peak.clone();
            let control = control.clone();
            tokio::spawn(async move {
                run_upload_jobs(0..7, 3, |index| {
                    let gate = gate.clone();
                    let active = active.clone();
                    let peak = peak.clone();
                    let control = control.clone();
                    let started = started.clone();
                    async move {
                        let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(count, Ordering::SeqCst);
                        started.send(index).unwrap();
                        gate.acquire().await.unwrap().forget();
                        control.add_transferred(5);
                        active.fetch_sub(1, Ordering::SeqCst);
                        Ok(())
                    }
                })
                .await
            })
        };
        for _ in 0..3 {
            receiver.recv().await.unwrap();
        }
        assert!(receiver.try_recv().is_err());
        gate.add_permits(1);
        assert_eq!(receiver.recv().await.unwrap(), 3);
        assert_eq!(peak.load(Ordering::SeqCst), 3);
        gate.add_permits(10);
        worker.await.unwrap().unwrap();
        assert_eq!(control.progress(), (35, 35));
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn upload_error_stops_new_jobs_and_drains_started_jobs() {
        let gate = Arc::new(Semaphore::new(0));
        let cleaned = Arc::new(AtomicUsize::new(0));
        let (started, mut receiver) = mpsc::unbounded_channel();
        let worker = {
            let gate = gate.clone();
            let cleaned = cleaned.clone();
            tokio::spawn(async move {
                run_upload_jobs(0..8, 3, |index| {
                    let gate = gate.clone();
                    let cleaned = cleaned.clone();
                    let started = started.clone();
                    async move {
                        started.send(index).unwrap();
                        if index == 0 {
                            return Err(SshError::TransferCancelled);
                        }
                        gate.acquire().await.unwrap().forget();
                        cleaned.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                })
                .await
            })
        };
        for _ in 0..3 {
            receiver.recv().await.unwrap();
        }
        assert!(!worker.is_finished());
        assert!(receiver.try_recv().is_err());
        gate.add_permits(2);
        assert!(matches!(
            worker.await.unwrap(),
            Err(SshError::TransferCancelled)
        ));
        assert_eq!(cleaned.load(Ordering::SeqCst), 2);
        assert!(receiver.try_recv().is_err());
    }

    #[tokio::test]
    async fn zero_concurrency_still_runs_and_empty_uploads_succeed() {
        run_upload_jobs(0..2, 0, |_| async { Ok(()) })
            .await
            .unwrap();
        run_upload_jobs(0..0, usize::MAX, |_| async { Ok(()) })
            .await
            .unwrap();
    }
}
