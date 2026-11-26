use super::{
    emit_transfer, is_missing, join_path, plan_remote_tree, sftp_error, transfer_buffer_size,
    validate_copy_destination, validate_tree_root, FileAttributes, OpenFlags, SftpSession,
    SshError, SshResult, SshSession, TransferControl, TransferEvent, TransferManager,
};
use crate::ssh::models::{RemoteCopyRequest, SshConfig};
use crate::ssh::workspace_files::numbered_copy_name;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// 按会话 ID 的固定顺序申请两端额度，双向同时复制时不会相互占住最后一个通道。
pub async fn copy_between_sessions(
    app: &AppHandle,
    source: &SshSession,
    target: &SshSession,
    transfers: &TransferManager,
    request: &RemoteCopyRequest,
) -> SshResult<String> {
    validate_tree_root(&request.source)?;
    validate_tree_root(&request.destination)?;
    let control = transfers.begin(&request.task_id, 0).await?;
    let result = async {
        let report = |done, total| {
            emit_transfer(app, TransferEvent::progress(&request.task_id, done, total));
        };
        if source.id() == target.id() {
            let slot = control.wait_for(source.reserve_transfer_channel()).await?;
            let sftp = source.open_transfer_sftp(slot).await?;
            let result = copy_tree(&sftp, &sftp, request, true, &control, report).await;
            let _ = sftp.close().await;
            return result;
        }
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
        let same_host = same_endpoint(source.config(), target.config());
        let result = copy_tree(reader, writer, request, same_host, &control, report).await;
        let _ = tokio::join!(a.close(), b.close());
        result
    }
    .await;
    transfers.finish(&request.task_id).await;
    result
}

/// 两个会话可能连接到同一远端账户；比较代理和跳板，避免误认为不同服务器共享目录。
fn same_endpoint(left: &SshConfig, right: &SshConfig) -> bool {
    let same_proxy = match (&left.proxy, &right.proxy) {
        (Some(a), Some(b)) => {
            a.kind == b.kind
                && a.host.eq_ignore_ascii_case(&b.host)
                && a.port == b.port
                && a.username == b.username
        }
        (None, None) => true,
        _ => false,
    };
    left.host.eq_ignore_ascii_case(&right.host)
        && left.port == right.port
        && left.username == right.username
        && same_proxy
        && left.jump_hosts.len() == right.jump_hosts.len()
        && left
            .jump_hosts
            .iter()
            .zip(&right.jump_hosts)
            .all(|(a, b)| same_endpoint(a, b))
}

/// 使用 lstat 检查同名文件、目录和悬空链接，整项复制始终保留已有目标。
async fn require_absent(sftp: &SftpSession, path: &str) -> SshResult<()> {
    match sftp.symlink_metadata(path).await {
        Ok(_) => Err(SshError::RemoteFileExists(path.to_owned())),
        Err(error) if is_missing(&error) => Ok(()),
        Err(error) => Err(sftp_error(error)),
    }
}

/// 将完整副本发布到首个可用目标，另一个粘贴在检查后抢占名称时继续编号。
async fn publish_copy(
    writer: &SftpSession,
    temp: &str,
    parent: &str,
    name: &str,
    directory: bool,
    auto_rename: bool,
    control: &TransferControl,
) -> SshResult<String> {
    for sequence in 0..=u32::MAX {
        control.checkpoint().await?;
        let candidate = numbered_copy_name(name.as_ref(), directory, sequence);
        let path = join_path(parent, &candidate.to_string_lossy());
        match require_absent(writer, &path).await {
            Err(SshError::RemoteFileExists(_)) if auto_rename => continue,
            other => other?,
        }
        // SFTP v3 的普通 RENAME 拒绝覆盖，不使用 posix-rename 扩展。
        match writer.rename(temp, &path).await {
            Ok(()) => return Ok(path),
            Err(error) => {
                if auto_rename
                    && matches!(
                        require_absent(writer, &path).await,
                        Err(SshError::RemoteFileExists(_))
                    )
                {
                    continue;
                }
                return Err(sftp_error(error));
            }
        }
    }
    Err(SshError::InvalidInput("没有可用的副本名称".into()))
}

/// 逐块中转到目标端的临时名称，整棵树完成后再改名，保留空目录和普通权限位。
async fn copy_tree(
    reader: &SftpSession,
    writer: &SftpSession,
    request: &RemoteCopyRequest,
    same_host: bool,
    control: &TransferControl,
    report: impl Fn(u64, u64),
) -> SshResult<String> {
    let (parent, name) = request
        .destination
        .rsplit_once('/')
        .ok_or_else(|| SshError::InvalidInput("目标须为绝对路径".into()))?;
    if name.is_empty() || matches!(name, "." | "..") || name.contains(['\\', '\0']) {
        return Err(SshError::InvalidInput("无效的目标文件名".into()));
    }
    if !request.auto_rename {
        require_absent(writer, &request.destination).await?;
    }
    if same_host
        && reader
            .symlink_metadata(&request.source)
            .await
            .map_err(sftp_error)?
            .is_dir()
    {
        let source = reader
            .canonicalize(&request.source)
            .await
            .map_err(sftp_error)?;
        let parent = writer
            .canonicalize(if parent.is_empty() { "/" } else { parent })
            .await
            .map_err(sftp_error)?;
        validate_copy_destination(&source, &parent)?;
    }
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
        let candidate = publish_copy(
            writer,
            &temp,
            parent,
            name,
            tree[0].attrs.is_dir(),
            request.auto_rename,
            control,
        )
        .await?;
        report(total, total);
        Ok(candidate)
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
    use crate::ssh::session::tests::config_with;
    use std::{path::Path, process::Stdio};
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tokio::process::{Child, Command};

    /// 只有账户与连接路线一致时才按同一服务器检查目标是否落在源目录内。
    #[test]
    fn distinguishes_duplicate_sessions_from_different_routes() {
        let mut first = config_with("node", "user", 22);
        let mut other = config_with("NODE", "user", 22);
        assert!(same_endpoint(&first, &other));
        other.username = "another-user".into();
        assert!(!same_endpoint(&first, &other));
        other.username = first.username.clone();
        first.jump_hosts.push(config_with("gateway-a", "user", 22));
        other.jump_hosts.push(config_with("gateway-b", "user", 22));
        assert!(!same_endpoint(&first, &other));
    }

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
            auto_rename: false,
            buffer_size_kb: 32,
        };
        let manager = TransferManager::new();
        let control = manager.begin("copy", 0).await.unwrap();
        copy_tree(&reader, &writer, &copy, false, &control, |_, _| {})
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
            copy_tree(&reader, &writer, &copy, false, &control, |_, _| {}).await,
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
        copy_tree(&reader, &writer, &copy, false, &control, |_, _| {})
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
        assert!(
            copy_tree(&reader, &writer, &copy, false, &control, |done, _| {
                if done == 0 {
                    std::fs::write(&conflict, b"existing").unwrap();
                }
            })
            .await
            .is_err()
        );
        assert_eq!(std::fs::read(conflict).unwrap(), b"existing");
        assert_eq!(std::fs::read_dir(second.path()).unwrap().count(), 3);
    }

    /// 在同一 SFTP 通道粘贴目录和跨端并发粘贴文件，验证重名、保留原件和子目录检查。
    #[tokio::test]
    #[ignore = "requires MIRAIHUB_TEST_SFTP_SERVER pointing to an OpenSSH sftp-server executable"]
    async fn openssh_clipboard_paste() {
        let executable = std::env::var("MIRAIHUB_TEST_SFTP_SERVER").unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(first.path().join("folder.conf/child")).unwrap();
        std::fs::write(first.path().join("folder.conf/note.txt"), b"copied").unwrap();
        let (_a, source) = open_server(&executable, first.path()).await;
        let (_b, target) = open_server(&executable, second.path()).await;
        let root = source.canonicalize(".").await.unwrap();
        let folder = join_path(&root, "folder.conf");
        let mut copy = RemoteCopyRequest {
            source_session_id: "a".into(),
            target_session_id: "a".into(),
            task_id: "paste".into(),
            source: folder.clone(),
            destination: folder.clone(),
            auto_rename: true,
            buffer_size_kb: 32,
        };
        let manager = TransferManager::new();
        let control = manager.begin("folder", 0).await.unwrap();
        assert_eq!(
            copy_tree(&source, &source, &copy, true, &control, |_, _| {})
                .await
                .unwrap(),
            format!("{folder}1")
        );
        assert!(first.path().join("folder.conf1/child").is_dir());
        assert_eq!(
            std::fs::read(first.path().join("folder.conf1/note.txt")).unwrap(),
            b"copied"
        );
        copy.destination = join_path(&folder, "child/folder.conf");
        assert!(matches!(
            copy_tree(&source, &source, &copy, true, &control, |_, _| {}).await,
            Err(SshError::InvalidInput(_))
        ));
        assert_eq!(
            std::fs::read_dir(first.path().join("folder.conf/child"))
                .unwrap()
                .count(),
            0
        );

        // 占用原名与第一个编号，两个同时发布的副本必须获得不同的最终名称。
        for name in ["note.txt", "note1.txt"] {
            std::fs::write(second.path().join(name), b"keep").unwrap();
        }
        let target_root = target.canonicalize(".").await.unwrap();
        copy.source = join_path(&folder, "note.txt");
        copy.destination = join_path(&target_root, "note.txt");
        copy.target_session_id = "b".into();
        let a = manager.begin("file-a", 0).await.unwrap();
        let b = manager.begin("file-b", 0).await.unwrap();
        let (a, b) = tokio::try_join!(
            copy_tree(&source, &target, &copy, false, &a, |_, _| {}),
            copy_tree(&source, &target, &copy, false, &b, |_, _| {}),
        )
        .unwrap();
        let mut names = [a, b];
        names.sort();
        assert_eq!(
            names,
            [
                join_path(&target_root, "note2.txt"),
                join_path(&target_root, "note3.txt")
            ]
        );
        assert_eq!(
            std::fs::read(second.path().join("note.txt")).unwrap(),
            b"keep"
        );
        assert_eq!(
            std::fs::read(second.path().join("note1.txt")).unwrap(),
            b"keep"
        );
        assert_eq!(
            std::fs::read(second.path().join("note2.txt")).unwrap(),
            b"copied"
        );
        assert_eq!(
            std::fs::read(second.path().join("note3.txt")).unwrap(),
            b"copied"
        );
    }
}
