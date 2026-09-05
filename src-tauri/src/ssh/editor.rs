//! UTF-8 editing with optimistic conflict checks, a retained backup and atomic replacement.
use super::{
    tunnels::{main_window, random_id},
    SessionManager,
};
use crate::error::{AppError, AppResult};
use russh_sftp::{
    client::SftpSession,
    protocol::{FileAttributes, OpenFlags, Packet, StatusCode},
};
use serde::Serialize;
use std::{collections::HashMap, time::Duration};
use tauri::{State, WebviewWindow};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};
const LIMIT: usize = 1024 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocument {
    pub id: String,
    pub session_id: String,
    pub endpoint: String,
    pub path: String,
    pub text: String,
    pub line_ending: String,
    pub bom: bool,
    pub backup_path: Option<String>,
}
struct Document {
    view: TextDocument,
    original: Vec<u8>,
    attrs: FileAttributes,
}
#[derive(Default)]
pub struct EditorManager {
    documents: Mutex<HashMap<String, Document>>,
}
fn sftp_error(error: impl std::fmt::Display) -> AppError {
    AppError::internal(format!("SFTP：{error}"))
}
fn decode(bytes: &[u8]) -> AppResult<(String, String, bool)> {
    if bytes.len() > LIMIT {
        return Err(AppError::invalid_input(
            "内置编辑器仅支持 1 MB 以内的文本文件",
        ));
    }
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let data = if bom { &bytes[3..] } else { bytes };
    let text = std::str::from_utf8(data)
        .map_err(|_| AppError::invalid_input("文件不是 UTF-8 文本，请下载后使用外部编辑器"))?;
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(AppError::invalid_input(
            "文件包含二进制控制字符，不能作为文本编辑",
        ));
    }
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count();
    if text.matches('\r').count() != crlf || (crlf > 0 && crlf != lf) {
        return Err(AppError::invalid_input(
            "文件含混合或旧式换行，请使用外部编辑器以保留原始格式",
        ));
    }
    Ok((
        text.replace("\r\n", "\n"),
        if crlf > 0 { "CRLF" } else { "LF" }.into(),
        bom,
    ))
}
fn encode(text: &str, ending: &str, bom: bool) -> AppResult<Vec<u8>> {
    if text.len() > LIMIT || text.contains('\r') {
        return Err(AppError::invalid_input("文本过长或换行格式无效"));
    }
    let content = if ending == "CRLF" {
        text.replace('\n', "\r\n")
    } else {
        text.into()
    };
    let mut bytes = if bom {
        vec![0xef, 0xbb, 0xbf]
    } else {
        Vec::new()
    };
    bytes.extend_from_slice(content.as_bytes());
    decode(&bytes)?;
    Ok(bytes)
}
fn same_metadata(a: &FileAttributes, b: &FileAttributes) -> bool {
    a.size == b.size
        && a.mtime == b.mtime
        && a.permissions == b.permissions
        && a.uid == b.uid
        && a.gid == b.gid
}
async fn read_file(sftp: &SftpSession, path: &str) -> AppResult<(Vec<u8>, FileAttributes)> {
    let attrs = sftp.symlink_metadata(path).await.map_err(sftp_error)?;
    if !attrs.is_regular() || attrs.is_symlink() {
        return Err(AppError::invalid_input(
            "仅可编辑普通文件；请直接打开符号链接的实际目标",
        ));
    }
    if attrs.size.unwrap_or(u64::MAX) > LIMIT as u64 {
        return Err(AppError::invalid_input(
            "文件超过 1 MB 或服务器未报告文件大小",
        ));
    }
    let file = sftp.open(path).await.map_err(sftp_error)?;
    let mut bytes = Vec::new();
    file.take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() > LIMIT {
        return Err(AppError::invalid_input("文件读取过程中超过 1 MB"));
    }
    let after = sftp.symlink_metadata(path).await.map_err(sftp_error)?;
    if !same_metadata(&attrs, &after) {
        return Err(AppError::invalid_input(
            "读取时远端文件发生变化，请重新加载",
        ));
    }
    Ok((bytes, after))
}
async fn create_file(sftp: &SftpSession, path: &str, bytes: &[u8]) -> AppResult<()> {
    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(0o600);
    let mut file = sftp
        .open_with_flags_and_attributes(
            path,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
            attrs,
        )
        .await
        .map_err(sftp_error)?;
    file.write_all(bytes).await?;
    file.flush().await?;
    file.sync_all().await.map_err(sftp_error)?;
    file.shutdown().await?;
    Ok(())
}
fn sibling(path: &str, kind: &str, id: &str) -> AppResult<String> {
    let (parent, name) = path
        .rsplit_once('/')
        .ok_or_else(|| AppError::invalid_input("远端路径无效"))?;
    if name.is_empty() {
        return Err(AppError::invalid_input("不能编辑目录"));
    }
    Ok(format!("{parent}/.{name}.mirai-{kind}-{id}"))
}
fn rename_packet(from: &str, to: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    for path in [from, to] {
        bytes.extend_from_slice(&(path.len() as u32).to_be_bytes());
        bytes.extend_from_slice(path.as_bytes());
    }
    bytes
}
#[tauri::command]
pub async fn ssh_text_open(
    window: WebviewWindow,
    manager: State<'_, SessionManager>,
    editor: State<'_, EditorManager>,
    session_id: String,
    path: String,
) -> AppResult<TextDocument> {
    main_window(&window)?;
    if !path.starts_with('/') || path.len() > 4096 || path.contains('\0') {
        return Err(AppError::invalid_input("请提供有效的远端绝对路径"));
    }
    let session = manager.get(&session_id).await?;
    let operation = async {
        let sftp = session.open_sftp().await?;
        let attrs = sftp.symlink_metadata(&path).await.map_err(sftp_error)?;
        if attrs.is_symlink() {
            return Err(AppError::invalid_input("请打开符号链接的实际目标文件"));
        }
        let path = sftp.canonicalize(path).await.map_err(sftp_error)?;
        let (bytes, attrs) = read_file(&sftp, &path).await?;
        let (text, line_ending, bom) = decode(&bytes)?;
        Ok::<_, AppError>((path, bytes, attrs, text, line_ending, bom))
    };
    let (path, original, attrs, text, line_ending, bom) =
        tokio::time::timeout(Duration::from_secs(20), operation)
            .await
            .map_err(|_| AppError::internal("读取远端文件超时"))??;
    let view = TextDocument {
        id: random_id(),
        session_id,
        endpoint: session.config().endpoint(),
        path,
        text,
        line_ending,
        bom,
        backup_path: None,
    };
    let mut documents = editor.documents.lock().await;
    if documents.len() >= 32 {
        return Err(AppError::invalid_input(
            "打开的远端文件过多，请关闭部分编辑器",
        ));
    }
    documents.insert(
        view.id.clone(),
        Document {
            view: view.clone(),
            original,
            attrs,
        },
    );
    Ok(view)
}
#[tauri::command]
pub async fn ssh_text_save(
    window: WebviewWindow,
    manager: State<'_, SessionManager>,
    editor: State<'_, EditorManager>,
    id: String,
    text: String,
) -> AppResult<TextDocument> {
    main_window(&window)?;
    // Serialize saves from this app; each document retains the exact bytes it originally read.
    let mut documents = editor.documents.lock().await;
    let document = documents
        .get_mut(&id)
        .ok_or_else(|| AppError::not_found("编辑会话已关闭，请重新打开文件"))?;
    let bytes = encode(&text, &document.view.line_ending, document.view.bom)?;
    let session = manager.get(&document.view.session_id).await?;
    let path = document.view.path.clone();
    let suffix = random_id();
    let temporary = sibling(&path, "edit", &suffix)?;
    let backup = sibling(&path, "backup", &suffix)?;
    let operation = async {
        let raw = session.open_raw_sftp().await?;
        let version = raw.init().await.map_err(sftp_error)?;
        if version
            .extensions
            .get("posix-rename@openssh.com")
            .map(String::as_str)
            != Some("1")
        {
            return Err(AppError::invalid_input(
                "服务器不支持原子替换扩展，已停止保存；请下载后使用外部编辑器",
            ));
        }
        let sftp = session.open_sftp().await?;
        if sftp.canonicalize(&path).await.map_err(sftp_error)? != path {
            return Err(AppError::invalid_input(
                "远端路径指向已改变，请重新打开文件",
            ));
        }
        let (current, attrs) = read_file(&sftp, &path).await?;
        if current != document.original || !same_metadata(&document.attrs, &attrs) {
            return Err(AppError::invalid_input(
                "保存冲突：远端文件已被其他程序修改。请复制当前草稿后重新加载，不会覆盖远端内容",
            ));
        }
        if current == bytes {
            return Ok::<_, AppError>((attrs, false));
        }
        create_file(&sftp, &backup, &current).await?;
        create_file(&sftp, &temporary, &bytes).await?;
        let mut permissions = FileAttributes::empty();
        permissions.permissions = attrs.permissions;
        permissions.uid = attrs.uid;
        permissions.gid = attrs.gid;
        sftp.set_metadata(&temporary, permissions)
            .await
            .map_err(sftp_error)?;
        let (check, latest) = read_file(&sftp, &path).await?;
        if check != current || !same_metadata(&attrs, &latest) {
            return Err(AppError::invalid_input(
                "保存冲突：上传期间远端文件改变，原文件未被替换",
            ));
        }
        match raw
            .extended("posix-rename@openssh.com", rename_packet(&temporary, &path))
            .await
            .map_err(sftp_error)?
        {
            Packet::Status(status) if status.status_code == StatusCode::Ok => {}
            Packet::Status(status) => return Err(sftp_error(status.error_message)),
            _ => return Err(AppError::internal("服务器未确认保存结果，请重新加载核对")),
        }
        let (written, attrs) = read_file(&sftp, &path).await?;
        if written != bytes {
            return Err(AppError::internal(
                "保存后内容再次改变，请重新加载并核对远端文件",
            ));
        }
        Ok((attrs, true))
    };
    let result = tokio::time::timeout(Duration::from_secs(45), operation).await;
    let (attrs, changed) = match result {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            return Err(AppError::internal(format!(
                "{}。若保存已开始，备份位置：{}",
                error.message, backup
            )))
        }
        Err(_) => {
            return Err(AppError::internal(format!(
                "保存超时，结果未确认；请重新加载核对。若备份已创建，位置：{backup}"
            )))
        }
    };
    document.original = bytes;
    document.attrs = attrs;
    document.view.text = text;
    if changed {
        document.view.backup_path = Some(backup);
    }
    Ok(document.view.clone())
}
#[tauri::command]
pub async fn ssh_text_close(
    window: WebviewWindow,
    editor: State<'_, EditorManager>,
    id: String,
) -> AppResult<()> {
    main_window(&window)?;
    editor.documents.lock().await.remove(&id);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_bom_crlf_and_unicode() {
        let original = b"\xef\xbb\xbfhello\r\nworld\r\n";
        let (text, ending, bom) = decode(original).unwrap();
        assert_eq!(text, "hello\nworld\n");
        assert_eq!(encode(&text, &ending, bom).unwrap(), original);
        assert_eq!(decode("中文\n".as_bytes()).unwrap().0, "中文\n");
    }
    #[test]
    fn rejects_binary_large_and_mixed_line_endings() {
        for data in [
            vec![0, 1, 2],
            vec![255],
            vec![b'x'; LIMIT + 1],
            b"a\r\nb\n".to_vec(),
        ] {
            assert!(decode(&data).is_err());
        }
    }
    #[test]
    fn metadata_change_is_a_conflict() {
        let mut a = FileAttributes::empty();
        a.size = Some(10);
        a.mtime = Some(4);
        let mut b = a.clone();
        assert!(same_metadata(&a, &b));
        b.mtime = Some(5);
        assert!(!same_metadata(&a, &b));
    }
    #[test]
    fn temporary_files_stay_beside_target() {
        assert_eq!(
            sibling("/etc/app.conf", "backup", "123").unwrap(),
            "/etc/.app.conf.mirai-backup-123"
        );
        assert!(sibling("/", "edit", "1").is_err());
    }
    #[test]
    fn rename_paths_use_sftp_string_encoding() {
        let packet = rename_packet("/a", "/b");
        assert_eq!(packet, vec![0, 0, 0, 2, b'/', b'a', 0, 0, 0, 2, b'/', b'b']);
    }
}
