//! UTF-8 editing of remote regular files.
use super::{tunnels::random_id, SessionManager};
use crate::{
    error::{AppError, AppResult, ErrorKind},
    platform::remote_editor::RemoteEditorWindows,
};
use russh_sftp::{
    client::SftpSession,
    protocol::{FileAttributes, OpenFlags},
};
use serde::Serialize;
use std::{collections::HashMap, time::Duration};
use tauri::{Manager, State, WebviewWindow};
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
}
struct Document {
    owner: String,
    view: TextDocument,
    /// 打开或最近一次保存后远端文件的版本（大小 + 修改时间），保存前据此检测冲突
    version: RemoteVersion,
}
/// 远端文件版本指纹。SFTP v3 的 mtime 精度为秒，配合大小一起比较。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RemoteVersion {
    size: Option<u64>,
    mtime: Option<u32>,
}
impl RemoteVersion {
    fn of(attrs: &FileAttributes) -> Self {
        Self {
            size: attrs.size,
            mtime: attrs.mtime,
        }
    }
}
/// 远端在打开后被他人修改时返回的冲突错误，前端据此提供覆盖 / 重新加载选项。
fn remote_changed() -> AppError {
    AppError::new(
        ErrorKind::Conflict,
        "远端文件已被修改，请选择覆盖保存或重新加载",
    )
}
/// 原子保存使用的同目录临时文件：`.<name>.miraihub.tmp`。
fn temp_path(path: &str) -> String {
    let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
    format!("{parent}/.{name}.miraihub.tmp")
}
#[derive(Default)]
pub struct EditorManager {
    documents: Mutex<HashMap<String, Document>>,
}
impl EditorManager {
    pub async fn close_window(&self, label: &str) {
        self.documents
            .lock()
            .await
            .retain(|_, document| document.owner != label);
    }
}
fn authorize_document(owner: &str, label: &str) -> AppResult<()> {
    if owner != label {
        return Err(AppError::invalid_input("不能访问其他窗口的远端编辑会话"));
    }
    Ok(())
}
fn sftp_error(error: impl std::fmt::Display) -> AppError {
    AppError::internal(format!("SFTP：{error}"))
}
pub(crate) fn decode(bytes: &[u8]) -> AppResult<(String, String, bool)> {
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
pub(crate) fn encode(text: &str, ending: &str, bom: bool) -> AppResult<Vec<u8>> {
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
pub(crate) async fn read_file(
    sftp: &SftpSession,
    path: &str,
) -> AppResult<(Vec<u8>, FileAttributes)> {
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
pub(crate) async fn write_file(sftp: &SftpSession, path: &str, bytes: &[u8]) -> AppResult<()> {
    let mut file = sftp
        .open_with_flags(path, OpenFlags::WRITE | OpenFlags::TRUNCATE)
        .await
        .map_err(sftp_error)?;
    file.write_all(bytes).await?;
    file.flush().await?;
    file.sync_all().await.map_err(sftp_error)?;
    file.shutdown().await?;
    Ok(())
}
/// 把内容完整写入临时文件并返回其属性；失败时尽力清理残留。
async fn write_temp(
    sftp: &SftpSession,
    temp: &str,
    bytes: &[u8],
    permissions: Option<u32>,
) -> AppResult<FileAttributes> {
    let mut attrs = FileAttributes::empty();
    attrs.permissions = permissions;
    let result = async {
        // 先清掉上次中断残留的临时文件，再以 O_EXCL 独占创建：
        // 目录可被他人写入时，预先放置的同名软链不会被跟随截断到别处。
        let _ = sftp.remove_file(temp).await;
        let mut file = sftp
            .open_with_flags_and_attributes(
                temp,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
                attrs,
            )
            .await
            .map_err(sftp_error)?;
        file.write_all(bytes).await?;
        file.flush().await?;
        file.sync_all().await.map_err(sftp_error)?;
        file.shutdown().await?;
        // 创建时的权限会被远端 umask 削减，写完后再显式设置一次
        if permissions.is_some() {
            let mut mode = FileAttributes::empty();
            mode.permissions = permissions;
            sftp.set_metadata(temp, mode).await.map_err(sftp_error)?;
        }
        sftp.symlink_metadata(temp).await.map_err(sftp_error)
    }
    .await;
    if result.is_err() {
        let _ = sftp.remove_file(temp).await;
    }
    result
}
/// 用临时文件替换目标：先直接 rename（部分服务器允许覆盖），
/// 不允许时把原文件挪成备份再落位，落位失败则还原备份。
async fn replace_with_temp(sftp: &SftpSession, temp: &str, path: &str) -> AppResult<()> {
    if sftp.rename(temp, path).await.is_ok() {
        return Ok(());
    }
    let backup = format!("{}.bak", temp.trim_end_matches(".tmp"));
    let _ = sftp.remove_file(&backup).await;
    sftp.rename(path, &backup).await.map_err(sftp_error)?;
    if let Err(error) = sftp.rename(temp, path).await {
        let _ = sftp.rename(&backup, path).await;
        return Err(sftp_error(error));
    }
    let _ = sftp.remove_file(&backup).await;
    Ok(())
}
/// 原子保存：写入同目录临时文件后 rename 覆盖，尽量保留原权限。
///
/// 以下情况回退为直接截断写入原文件：
/// - 目录不可写，临时文件建不出来；
/// - 临时文件的属主 / 属组与原文件不同（rename 会悄悄改变文件归属）；
/// - rename 失败。
pub(crate) async fn save_atomic(
    sftp: &SftpSession,
    path: &str,
    bytes: &[u8],
    original: &FileAttributes,
) -> AppResult<()> {
    let temp = temp_path(path);
    let permissions = original.permissions.map(|mode| mode & 0o7777);
    let replaced = match write_temp(sftp, &temp, bytes, permissions).await {
        Ok(written) => {
            let same_owner = (original.uid.is_none() || written.uid == original.uid)
                && (original.gid.is_none() || written.gid == original.gid);
            same_owner && replace_with_temp(sftp, &temp, path).await.is_ok()
        }
        Err(_) => false,
    };
    if !replaced {
        let _ = sftp.remove_file(&temp).await;
        write_file(sftp, path, bytes).await?;
    }
    Ok(())
}
#[tauri::command]
pub async fn ssh_text_open(
    window: WebviewWindow,
    manager: State<'_, SessionManager>,
    editor: State<'_, EditorManager>,
    session_id: String,
    path: String,
) -> AppResult<TextDocument> {
    window
        .state::<RemoteEditorWindows>()
        .authorize(window.label(), &session_id, &path)?;
    let requested_path = path.clone();
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
        Ok::<_, AppError>((path, text, line_ending, bom, RemoteVersion::of(&attrs)))
    };
    let (path, text, line_ending, bom, version) = tokio::time::timeout(Duration::from_secs(20), operation)
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
    };
    let mut documents = editor.documents.lock().await;
    // The window may have closed while its SFTP read was in flight.
    window.state::<RemoteEditorWindows>().authorize(
        window.label(),
        &view.session_id,
        &requested_path,
    )?;
    if documents.len() >= 32 {
        return Err(AppError::invalid_input(
            "打开的远端文件过多，请关闭部分编辑器",
        ));
    }
    documents.insert(
        view.id.clone(),
        Document {
            owner: window.label().to_owned(),
            view: view.clone(),
            version,
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
    force: Option<bool>,
) -> AppResult<TextDocument> {
    // Serialize saves from this editor window.
    let mut documents = editor.documents.lock().await;
    let document = documents
        .get_mut(&id)
        .ok_or_else(|| AppError::not_found("编辑会话已关闭，请重新打开文件"))?;
    authorize_document(&document.owner, window.label())?;
    let bytes = encode(&text, &document.view.line_ending, document.view.bom)?;
    let session = manager.get(&document.view.session_id).await?;
    let path = document.view.path.clone();
    let expected = document.version;
    let force = force.unwrap_or(false);
    // 放进独立任务：超时只停止等待，不会在“原文件已挪成备份、临时文件尚未落位”
    // 的中间状态取消替换流程，否则远端会短暂乃至永久缺失原文件。
    let operation = tokio::spawn(async move {
        let sftp = session.open_sftp().await?;
        let attrs = sftp.symlink_metadata(&path).await.map_err(sftp_error)?;
        if !attrs.is_regular() || attrs.is_symlink() {
            return Err(AppError::invalid_input("仅可保存普通文件"));
        }
        // 打开后远端被他人改过：除非用户明确选择覆盖，否则拒绝保存
        if !force && RemoteVersion::of(&attrs) != expected {
            return Err(remote_changed());
        }
        save_atomic(&sftp, &path, &bytes, &attrs).await?;
        let saved = sftp.symlink_metadata(&path).await.map_err(sftp_error)?;
        Ok::<_, AppError>(RemoteVersion::of(&saved))
    });
    let version = tokio::time::timeout(Duration::from_secs(45), operation)
        .await
        .map_err(|_| AppError::internal("保存超时，请重新加载核对远端文件"))?
        .map_err(|_| AppError::internal("保存任务异常中止，请重新加载核对远端文件"))??;
    document.version = version;
    document.view.text = text;
    Ok(document.view.clone())
}
#[tauri::command]
pub async fn ssh_text_close(
    window: WebviewWindow,
    editor: State<'_, EditorManager>,
    id: String,
) -> AppResult<()> {
    let mut documents = editor.documents.lock().await;
    if let Some(document) = documents.get(&id) {
        authorize_document(&document.owner, window.label())?;
    }
    documents.remove(&id);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn documents_cannot_be_saved_or_closed_by_another_window() {
        assert!(authorize_document("remote-editor-a", "remote-editor-a").is_ok());
        assert!(authorize_document("remote-editor-a", "remote-editor-b").is_err());
        assert!(authorize_document("remote-editor-a", "main").is_err());
        assert!(authorize_document("main", "remote-editor-a").is_err());
    }
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
    fn detects_a_change_while_reading() {
        let mut a = FileAttributes::empty();
        a.size = Some(10);
        a.mtime = Some(4);
        let mut b = a.clone();
        assert!(same_metadata(&a, &b));
        b.mtime = Some(5);
        assert!(!same_metadata(&a, &b));
    }
    #[test]
    fn remote_version_tracks_size_and_mtime() {
        let mut a = FileAttributes::empty();
        a.size = Some(10);
        a.mtime = Some(4);
        let mut b = a.clone();
        b.permissions = Some(0o600);
        assert_eq!(RemoteVersion::of(&a), RemoteVersion::of(&b));
        b.size = Some(11);
        assert_ne!(RemoteVersion::of(&a), RemoteVersion::of(&b));
        assert!(matches!(remote_changed().kind, ErrorKind::Conflict));
    }
    #[test]
    fn temp_file_sits_next_to_target() {
        assert_eq!(temp_path("/etc/nginx.conf"), "/etc/.nginx.conf.miraihub.tmp");
        assert_eq!(temp_path("/a.txt"), "/.a.txt.miraihub.tmp");
    }
}
