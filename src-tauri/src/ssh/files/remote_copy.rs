use super::{
    emit_transfer, is_missing, join_path, plan_remote_tree, sftp_error, transfer_buffer_size,
    validate_tree_root, FileAttributes, OpenFlags, SftpSession, SshError, SshResult, SshSession,
    TransferControl, TransferEvent, TransferManager,
};
use crate::ssh::models::RemoteCopyRequest;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// 按会话 ID 的固定顺序申请两端额度，双向同时复制时不会相互占住最后一个通道。
pub async fn copy_between_sessions(
    app: &AppHandle,
    source: &SshSession,
    target: &SshSession,
    transfers: &TransferManager,
    request: &RemoteCopyRequest,
) -> SshResult<()> {
    if source.id() == target.id() {
        return Err(SshError::InvalidInput("请选择另一个 SSH 会话".into()));
    }
    validate_tree_root(&request.source)?;
    validate_tree_root(&request.destination)?;
    let control = transfers.begin(&request.task_id, 0).await?;
    let result = async {
        let source_first = source.id() < target.id();
        let (first, second) = if source_first {
            (source, target)
        } else {
            (target, source)
        };
        let first_slot = control.wait_for(first.reserve_transfer_channel()).await?;
        let second_slot = control.wait_for(second.reserve_transfer_channel()).await?;
        control.checkpoint().await?;
        let (a, b) = tokio::try_join!(
            first.open_transfer_sftp(first_slot),
            second.open_transfer_sftp(second_slot)
        )?;
        let (reader, writer) = if source_first { (&a, &b) } else { (&b, &a) };
        let result = copy_tree(reader, writer, request, &control, |done, total| {
            emit_transfer(app, TransferEvent::progress(&request.task_id, done, total));
        })
        .await;
        let _ = tokio::join!(a.close(), b.close());
        result
    }
    .await;
    transfers.finish(&request.task_id).await;
    result
}

/// 使用 lstat 检查同名文件、目录和悬空链接，整项复制始终保留已有目标。
async fn require_absent(sftp: &SftpSession, path: &str) -> SshResult<()> {
    match sftp.symlink_metadata(path).await {
        Ok(_) => Err(SshError::RemoteFileExists(path.to_owned())),
        Err(error) if is_missing(&error) => Ok(()),
        Err(error) => Err(sftp_error(error)),
    }
}

/// 逐块中转到目标端的临时名称，整棵树完成后再改名，保留空目录和普通权限位。
async fn copy_tree(
    reader: &SftpSession,
    writer: &SftpSession,
    request: &RemoteCopyRequest,
    control: &TransferControl,
    report: impl Fn(u64, u64),
) -> SshResult<()> {
    let (parent, name) = request
        .destination
        .rsplit_once('/')
        .ok_or_else(|| SshError::InvalidInput("目标须为绝对路径".into()))?;
    if name.is_empty() || matches!(name, "." | "..") || name.contains(['\\', '\0']) {
        return Err(SshError::InvalidInput("无效的目标文件名".into()));
    }
    require_absent(writer, &request.destination).await?;
    let tree = plan_remote_tree(reader, &request.source, control).await?;
    let total = tree
        .iter()
        .filter(|entry| entry.attrs.file_type().is_file())
        .map(|entry| entry.attrs.len())
        .sum();
    control.set_total(total);
    report(0, total);
    let temp = join_path(
        parent,
        &format!(".miraihub-{:032x}.part", rand::random::<u128>()),
    );
    let mut created = Vec::new();
    let mut buffer = vec![0; transfer_buffer_size(request.buffer_size_kb)];
    let result = async {
        for entry in &tree {
            control.checkpoint().await?;
            let path = if entry.relative.is_empty() {
                temp.clone()
            } else {
                join_path(&temp, &entry.relative)
            };
            let directory = entry.attrs.file_type().is_dir();
            if directory {
                writer.create_dir(&path).await.map_err(sftp_error)?;
                created.push((path.clone(), directory));
                if entry.relative.is_empty() {
                    let mut private = FileAttributes::empty();
                    private.permissions = Some(0o700);
                    writer
                        .set_metadata(&path, private)
                        .await
                        .map_err(sftp_error)?;
                }
                continue;
            }
            let mut input = reader.open(&entry.remote_path).await.map_err(sftp_error)?;
            let mut private = FileAttributes::empty();
            private.permissions = Some(0o600);
            let mut output = writer
                .open_with_flags_and_attributes(
                    &path,
                    OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
                    private,
                )
                .await
                .map_err(sftp_error)?;
            created.push((path, directory));
            let mut size = 0;
            loop {
                control.checkpoint().await?;
                let count = input.read(&mut buffer).await?;
                if count == 0 {
                    break;
                }
                output.write_all(&buffer[..count]).await?;
                size += count as u64;
                let done = control.add_transferred(count as u64);
                if control.should_report() {
                    report(done, total);
                }
            }
            output.shutdown().await?;
            if size != entry.attrs.len() {
                return Err(SshError::InvalidInput(format!(
                    "传输期间源文件大小发生变化：{}",
                    entry.remote_path
                )));
            }
        }
        // 最后由内向外恢复权限，避免只读目录阻止写入子项。
        for (entry, (path, _)) in tree.iter().zip(&created).rev() {
            control.checkpoint().await?;
            let mut attrs = FileAttributes::empty();
            attrs.permissions = entry.attrs.permissions.map(|mode| mode & 0o777);
            attrs.atime = entry.attrs.atime;
            attrs.mtime = entry.attrs.mtime;
            writer.set_metadata(path, attrs).await.map_err(sftp_error)?;
        }
        control.checkpoint().await?;
        require_absent(writer, &request.destination).await?;
        writer
            .rename(&temp, &request.destination)
            .await
            .map_err(sftp_error)?;
        report(total, total);
        Ok(())
    }
    .await;
    if result.is_err() {
        // 只回收本次成功创建的临时路径；最外层目录先恢复写权限。
        for (path, directory) in &created {
            if *directory {
                let mut attrs = FileAttributes::empty();
                attrs.permissions = Some(0o700);
                let _ = writer.set_metadata(path, attrs).await;
            }
        }
        for (path, directory) in created.iter().rev() {
            if *directory {
                let _ = writer.remove_dir(path).await;
            } else {
                let _ = writer.remove_file(path).await;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::files::{download_to_path, local_download_path};
    use crate::ssh::models::DownloadFileRequest;
    use std::{path::Path, process::Stdio};
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tokio::process::{Child, Command};

    /// 用独立的 OpenSSH SFTP 子进程交换真实协议包，两端各以单独的临时目录为起点。
    async fn open_server(executable: &str, root: &Path) -> (Child, SftpSession) {
        let mut process = Command::new(executable)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let pipe = tokio::io::join(
            process.stdout.take().unwrap(),
            process.stdin.take().unwrap(),
        );
        (process, SftpSession::new(pipe).await.unwrap())
    }

    /// 显式指定 OpenSSH 的可执行文件，验证多块复制、自动创建空目录、下载及冲突保护。
    #[tokio::test]
    #[ignore = "requires MIRAIHUB_TEST_SFTP_SERVER pointing to an OpenSSH sftp-server executable"]
    async fn openssh_folder_copy_and_download() {
        let executable = std::env::var("MIRAIHUB_TEST_SFTP_SERVER").unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let folder = "folder with spaces";
        let source_folder = first.path().join(folder);
        std::fs::create_dir_all(source_folder.join("nested/empty")).unwrap();
        let bytes: Vec<_> = (0..250_000).map(|n| (n % 251) as u8).collect();
        std::fs::write(source_folder.join("nested/data.bin"), &bytes).unwrap();
        std::fs::write(source_folder.join(".hidden"), []).unwrap();
        let (_a, reader) = open_server(&executable, first.path()).await;
        let (_b, writer) = open_server(&executable, second.path()).await;
        let source = reader.canonicalize(folder).await.unwrap();
        let destination = join_path(&writer.canonicalize(".").await.unwrap(), folder);
        let mut copy = RemoteCopyRequest {
            source_session_id: "a".into(),
            target_session_id: "b".into(),
            source,
            destination,
            task_id: "copy".into(),
            buffer_size_kb: 32,
        };
        let manager = TransferManager::new();
        let control = manager.begin("copy", 0).await.unwrap();
        copy_tree(&reader, &writer, &copy, &control, |_, _| {})
            .await
            .unwrap();
        let copied = second.path().join(folder);
        assert_eq!(
            std::fs::read(copied.join("nested/data.bin")).unwrap(),
            bytes
        );
        assert_eq!(
            std::fs::read(source_folder.join("nested/data.bin")).unwrap(),
            bytes
        );
        assert!(copied.join("nested/empty").is_dir());
        assert!(copied.join(".hidden").is_file());
        assert_eq!(control.progress(), (250_000, 250_000));
        assert!(matches!(
            copy_tree(&reader, &writer, &copy, &control, |_, _| {}).await,
            Err(SshError::RemoteFileExists(_))
        ));
        let download = DownloadFileRequest {
            session_id: "b".into(),
            task_id: "download".into(),
            remote_path: copy.destination,
            local_path: local.path().to_str().unwrap().into(),
            into_directory: true,
            overwrite: false,
            resume: true,
            preserve_mtime: false,
            buffer_size_kb: 32,
        };
        let final_path = local_download_path(&download).unwrap();
        assert_eq!(final_path, local.path().join(folder));
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let control = manager.begin("download", 0).await.unwrap();
        download_to_path(app.handle(), &writer, &download, &final_path, &control)
            .await
            .unwrap();
        assert!(final_path.join("nested/empty").is_dir());
        assert!(final_path.join(".hidden").is_file());
        assert_eq!(
            std::fs::read(final_path.join("nested/data.bin")).unwrap(),
            bytes
        );
        assert!(
            download_to_path(app.handle(), &writer, &download, &final_path, &control)
                .await
                .is_err()
        );
        copy.source = join_path(&copy.source, "nested/data.bin");
        copy.destination = join_path(&writer.canonicalize(".").await.unwrap(), "single.bin");
        let control = manager.begin("single", 0).await.unwrap();
        copy_tree(&reader, &writer, &copy, &control, |_, _| {})
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(second.path().join("single.bin")).unwrap(),
            bytes
        );

        // 在探测与提交之间创建同名文件，失败时保留其内容并回收本次中转文件。
        copy.destination = join_path(&writer.canonicalize(".").await.unwrap(), "conflict");
        let conflict = second.path().join("conflict");
        let control = manager.begin("conflict", 0).await.unwrap();
        assert!(copy_tree(&reader, &writer, &copy, &control, |done, _| {
            if done == 0 {
                std::fs::write(&conflict, b"existing").unwrap();
            }
        })
        .await
        .is_err());
        assert_eq!(std::fs::read(conflict).unwrap(), b"existing");
        assert_eq!(std::fs::read_dir(second.path()).unwrap().count(), 3);
    }
}
