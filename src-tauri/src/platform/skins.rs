//! 皮肤资源目录。
//!
//! 内置皮肤（背景图 + 样式表 + 清单）随安装包一起放在
//! `<安装目录>/skins/<id>/`，用户打开这个文件夹改图片、改 CSS 就能换皮，
//! 不用重新打包。前端通过 asset 协议直接读文件，Rust 只负责告诉它目录在哪。

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};

/// 资源目录下放皮肤的子目录名，与 `tauri.conf.json` 的 `bundle.resources` 对应。
const SKINS_DIR: &str = "skins";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinFolder {
    /// 皮肤 id，同时是子目录名。
    pub id: String,
    /// 该皮肤目录的绝对路径。
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinDirectory {
    /// 皮肤根目录的绝对路径。
    pub root: String,
    /// 根目录下存在的皮肤子目录。
    pub skins: Vec<SkinFolder>,
}

fn skins_root(app: &AppHandle) -> AppResult<PathBuf> {
    // Windows 上 resource_dir 就是 exe 所在目录；开发时是 target/debug。
    let root = app
        .path()
        .resource_dir()
        .map_err(|_| AppError::internal("无法定位资源目录"))?
        .join(SKINS_DIR);
    Ok(root)
}

/// 列出皮肤根目录与其中的皮肤子目录。
///
/// 只认「有 skin.json 的子目录」：用户在旁边随手建的临时文件夹不会被当成皮肤。
#[tauri::command]
pub fn skin_directory(app: AppHandle) -> AppResult<SkinDirectory> {
    let root = skins_root(&app)?;
    let mut skins = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("skin.json").is_file() {
                if let Some(id) = path.file_name().and_then(|name| name.to_str()) {
                    skins.push(SkinFolder {
                        id: id.to_owned(),
                        path: path.to_string_lossy().into_owned(),
                    });
                }
            }
        }
    }
    skins.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(SkinDirectory {
        root: root.to_string_lossy().into_owned(),
        skins,
    })
}

/// 在系统文件管理器里打开皮肤目录（或某个皮肤的子目录）。
#[tauri::command]
pub fn open_skin_directory(app: AppHandle, id: Option<String>) -> AppResult<()> {
    let root = skins_root(&app)?;
    // 只允许打开根目录或它的直接子目录，id 里的路径分隔符一律拒绝。
    let target = match id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) if id.contains(['/', '\\', '.']) => {
            return Err(AppError::invalid_input("皮肤 id 不合法"));
        }
        Some(id) => root.join(id),
        None => root,
    };
    if !target.is_dir() {
        return Err(AppError::not_found("皮肤目录不存在"));
    }
    app.opener()
        .open_path(target.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| AppError::internal(error.to_string()))
}
