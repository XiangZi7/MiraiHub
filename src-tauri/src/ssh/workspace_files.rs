//! 双栏文件浏览与目录同步只读扫描，传输仍走原有队列。
use crate::error::{AppError, AppResult};
use super::SessionManager;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{State, WebviewWindow};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry { path: String, name: String, directory: bool, size: u64, modified_at: i64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalListing { path: String, parent: Option<String>, entries: Vec<FileEntry> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncScan { local_root: String, remote_root: String, local: Vec<FileEntry>, remote: Vec<FileEntry> }

/// 在阻塞线程读取本地目录，不跟随符号链接；空路径对应用户主目录。
fn local_listing(path: &Path) -> AppResult<LocalListing> {
    let path = std::fs::canonicalize(path)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path)? {
        let entry = entry?;
        let meta = std::fs::symlink_metadata(entry.path())?;
        if meta.is_symlink() || (!meta.is_dir() && !meta.is_file()) { continue; }
        if entries.len() >= 10000 { return Err(AppError::invalid_input("目录超过 10000 项，请选择更小的目录")); }
        entries.push(FileEntry { path: entry.path().to_string_lossy().into_owned(), name: entry.file_name().to_string_lossy().into_owned(), directory: meta.is_dir(), size: meta.len(), modified_at: meta.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |time| time.as_millis() as i64) });
    }
    entries.sort_by(|a, b| b.directory.cmp(&a.directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(LocalListing { parent: path.parent().map(|value| value.to_string_lossy().into_owned()), path: path.to_string_lossy().into_owned(), entries })
}

#[tauri::command]
pub async fn local_list_directory(window: WebviewWindow, path: String) -> AppResult<LocalListing> {
    super::tunnels::main_window(&window)?;
    let path = if path.is_empty() { dirs::home_dir().ok_or_else(|| AppError::internal("无法定位主目录"))? } else { PathBuf::from(path) };
    tokio::task::spawn_blocking(move || local_listing(&path)).await.map_err(|_| AppError::internal("读取本地目录失败"))?
}

/// 跨平台同步只接收单个文件名，避免远端名称在 Windows 上变成路径或备用数据流。
fn valid_name(name: &str) -> bool {
    !name.is_empty() && !matches!(name, "." | "..") && !name.contains(['/', '\\', ':', '<', '>', '"', '|', '?', '*']) && !name.ends_with([' ', '.']) && !name.chars().any(char::is_control)
}

/// 扫描整个本地树；存在链接时拒绝同步，避免写入根目录之外的目标。
fn local_tree(root: &Path) -> AppResult<Vec<FileEntry>> {
    let mut entries = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    while let Some((path, depth)) = pending.pop() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let meta = std::fs::symlink_metadata(entry.path())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !valid_name(&name) || meta.is_symlink() { return Err(AppError::invalid_input("同步目录包含链接或不兼容的文件名")); }
            if !meta.is_dir() && !meta.is_file() { continue; }
            if entries.len() >= 5000 || depth >= 32 { return Err(AppError::invalid_input("同步目录过大：最多 5000 项、32 层")); }
            if meta.is_dir() { pending.push((entry.path(), depth + 1)); }
            entries.push(FileEntry { path: entry.path().strip_prefix(root).map_err(|_| AppError::internal("目录边界无效"))?.to_string_lossy().replace('\\', "/"), name, directory: meta.is_dir(), size: meta.len(), modified_at: meta.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |time| time.as_millis() as i64) });
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn ssh_sync_scan(window: WebviewWindow, manager: State<'_, SessionManager>, session_id: String, local_path: String, remote_path: String) -> AppResult<SyncScan> {
    super::tunnels::main_window(&window)?;
    let root = std::fs::canonicalize(local_path)?;
    let local_root = root.to_string_lossy().into_owned();
    let local = tokio::task::spawn_blocking(move || local_tree(&root)).await.map_err(|_| AppError::internal("扫描本地目录失败"))??;
    let session = manager.get(&session_id).await?;
    let sftp = session.open_sftp().await?;
    let result = async {
        let remote_root = sftp.canonicalize(&remote_path).await.map_err(|error| AppError::internal(error.to_string()))?;
        let mut remote = Vec::new();
        let mut pending = vec![(String::new(), 0usize)];
        while let Some((relative, depth)) = pending.pop() {
            let path = format!("{}/{}", remote_root.trim_end_matches('/'), relative);
            for entry in sftp.read_dir(path).await.map_err(|error| AppError::internal(error.to_string()))? {
                let name = entry.file_name();
                if matches!(name.as_str(), "." | "..") { continue; }
                let meta = entry.metadata();
                if !valid_name(&name) || meta.is_symlink() { return Err(AppError::invalid_input("同步目录包含链接或不兼容的文件名")); }
                if !meta.is_dir() && !meta.is_regular() { continue; }
                if remote.len() >= 5000 || depth >= 32 { return Err(AppError::invalid_input("同步目录过大：最多 5000 项、32 层")); }
                let path = if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
                if meta.is_dir() { pending.push((path.clone(), depth + 1)); }
                remote.push(FileEntry { path, name, directory: meta.is_dir(), size: meta.size.unwrap_or(0), modified_at: meta.mtime.unwrap_or(0) as i64 * 1000 });
            }
        }
        Ok(SyncScan { local_root, remote_root, local, remote })
    }.await;
    let _ = sftp.close().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_names_that_can_escape_the_selected_directory() {
        for name in ["..", "a/b", "a\\b", "C:", "a:stream", "a\n"] { assert!(!valid_name(name)); }
        for name in ["hello.txt", "中文.log", ".env"] { assert!(valid_name(name)); }
    }
}
