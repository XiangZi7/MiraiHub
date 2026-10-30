//! 数据库结果文件沿用文件传输控制与进度事件，取消时不覆盖已有文件。
use std::path::Path;

use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};
use crate::ssh::events::{emit_transfer, TransferEvent};
use crate::ssh::TransferManager;

pub async fn write<R: tauri::Runtime>(
    app: &AppHandle<R>,
    transfers: &TransferManager,
    task_id: &str,
    path: &str,
    bytes: &[u8],
) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::invalid_input("导出路径不能为空"));
    }
    let control = transfers.control(task_id).await?;
    control.checkpoint().await?;
    control.set_total(bytes.len() as u64);
    emit_transfer(app, TransferEvent::progress(task_id, 0, bytes.len() as u64));
    let target = Path::new(path);
    let temporary =
        target.with_file_name(format!(".miraihub-{:032x}.part", rand::random::<u128>()));
    let result: AppResult<()> = async {
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await?;
        for chunk in bytes.chunks(256 * 1024) {
            control.checkpoint().await?;
            file.write_all(chunk).await?;
            let written = control.add_transferred(chunk.len() as u64);
            if control.should_report() {
                emit_transfer(
                    app,
                    TransferEvent::progress(task_id, written, bytes.len() as u64),
                );
            }
        }
        file.flush().await?;
        drop(file);
        control.checkpoint().await?;
        tokio::fs::rename(&temporary, target).await?;
        emit_transfer(
            app,
            TransferEvent::progress(task_id, bytes.len() as u64, bytes.len() as u64),
        );
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

struct ChunkFile {
    path: String,
    temporary: std::path::PathBuf,
    file: tokio::fs::File,
    written: u64,
}
type ChunkFiles = tokio::sync::Mutex<std::collections::HashMap<String, ChunkFile>>;
static CHUNK_FILES: std::sync::OnceLock<ChunkFiles> = std::sync::OnceLock::new();

/// 按传输任务持有临时文件，最多同时执行一个数据库文件任务；每次只接收至多 256 KB。
/// 最后一块成功后才重命名，失败或取消的部分文件由 finish 清理。
pub async fn write_chunk<R: tauri::Runtime>(
    app: &AppHandle<R>,
    transfers: &TransferManager,
    task_id: &str,
    path: &str,
    bytes: &[u8],
    complete: bool,
) -> AppResult<()> {
    if path.trim().is_empty() || bytes.len() > 256 * 1024 {
        return Err(AppError::invalid_input("导出路径无效或文件块超过 256 KB"));
    }
    let control = transfers.control(task_id).await?;
    control.checkpoint().await?;
    let mut files = CHUNK_FILES.get_or_init(Default::default).lock().await;
    if !files.contains_key(task_id) {
        let target = Path::new(path);
        let temporary =
            target.with_file_name(format!(".miraihub-{:032x}.part", rand::random::<u128>()));
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await?;
        files.insert(
            task_id.into(),
            ChunkFile {
                path: path.into(),
                temporary,
                file,
                written: 0,
            },
        );
    }
    let entry = files.get_mut(task_id).unwrap();
    if entry.path != path {
        return Err(AppError::invalid_input("任务中的文件路径不能变化"));
    }
    entry.file.write_all(bytes).await?;
    entry.written += bytes.len() as u64;
    control.set_transferred(entry.written);
    if complete {
        control.set_total(entry.written);
    }
    if control.should_report() || complete {
        emit_transfer(
            app,
            TransferEvent::progress(
                task_id,
                entry.written,
                if complete { entry.written } else { 0 },
            ),
        );
    }
    if complete {
        entry.file.flush().await?;
        control.checkpoint().await?;
        let entry = files.remove(task_id).unwrap();
        drop(entry.file);
        if let Err(error) = tokio::fs::rename(&entry.temporary, Path::new(path)).await {
            let _ = tokio::fs::remove_file(&entry.temporary).await;
            return Err(error.into());
        }
    }
    Ok(())
}

/// 任务退出时清理没有完成重命名的临时文件，保留原来的目标文件。
pub async fn discard(task_id: &str) {
    let Some(files) = CHUNK_FILES.get() else {
        return;
    };
    if let Some(entry) = files.lock().await.remove(task_id) {
        drop(entry.file);
        let _ = tokio::fs::remove_file(&entry.temporary).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[tokio::test]
    async fn chunks_commit_only_after_complete_and_replace_existing_file() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let transfers = TransferManager::new();
        let id = format!("chunk-test-{}", rand::random::<u128>());
        transfers.begin(&id, 0).await.unwrap();
        let target = std::env::temp_dir().join(format!("{id}.csv"));
        tokio::fs::write(&target, b"original").await.unwrap();
        let path = target.to_str().unwrap();
        write_chunk(app.handle(), &transfers, &id, path, b"first,", false)
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"original");
        write_chunk(app.handle(), &transfers, &id, path, b"second", true)
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"first,second");
        discard(&id).await;
        transfers.finish(&id).await;
        tokio::fs::remove_file(target).await.unwrap();
    }

    #[tokio::test]
    async fn cancelled_chunks_leave_original_file_and_remove_partial_file() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let transfers = TransferManager::new();
        let id = format!("cancel-chunk-{}", rand::random::<u128>());
        transfers.begin(&id, 0).await.unwrap();
        let target = std::env::temp_dir().join(format!("{id}.csv"));
        tokio::fs::write(&target, b"original").await.unwrap();
        write_chunk(
            app.handle(),
            &transfers,
            &id,
            target.to_str().unwrap(),
            b"partial",
            false,
        )
        .await
        .unwrap();
        let temporary = CHUNK_FILES
            .get()
            .unwrap()
            .lock()
            .await
            .get(&id)
            .unwrap()
            .temporary
            .clone();
        transfers.cancel(&id).await.unwrap();
        assert!(write_chunk(
            app.handle(),
            &transfers,
            &id,
            target.to_str().unwrap(),
            b"end",
            true
        )
        .await
        .is_err());
        discard(&id).await;
        assert!(!temporary.exists());
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"original");
        transfers.finish(&id).await;
        tokio::fs::remove_file(target).await.unwrap();
    }
}
