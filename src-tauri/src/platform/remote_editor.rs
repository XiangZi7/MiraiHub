//! Native, non-modal editor windows. Targets stay in Rust, never in URLs or storage.
use crate::{
    error::{AppError, AppResult},
    ssh::{
        editor::EditorManager,
        tunnels::{main_window, random_id},
        SessionManager,
    },
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const PREFIX: &str = "remote-editor-";
pub const CLOSE_EVENT: &str = "remote-editor-close-requested";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorTarget {
    pub session_id: String,
    pub path: String,
    pub connection_name: String,
}
struct EditorWindow {
    target: EditorTarget,
    ready: bool,
    dirty: bool,
    busy: bool,
}
#[derive(Default)]
pub struct RemoteEditorWindows {
    entries: Mutex<HashMap<String, EditorWindow>>,
    opening: tokio::sync::Mutex<()>,
}
impl RemoteEditorWindows {
    fn entries(&self) -> std::sync::MutexGuard<'_, HashMap<String, EditorWindow>> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
    fn register(&self, label: String, target: EditorTarget) {
        self.entries().insert(
            label,
            EditorWindow {
                target,
                ready: false,
                dirty: false,
                busy: true,
            },
        );
    }
    fn ready(&self, label: &str) -> bool {
        self.entries()
            .get(label)
            .map(|entry| entry.ready)
            .unwrap_or(false)
    }
    fn mark_ready(&self, label: &str) -> AppResult<EditorTarget> {
        let mut entries = self.entries();
        let entry = entries
            .get_mut(label)
            .ok_or_else(|| AppError::not_found("编辑窗口已关闭"))?;
        entry.ready = true;
        Ok(entry.target.clone())
    }
    pub fn target(&self, label: &str) -> AppResult<EditorTarget> {
        self.entries()
            .get(label)
            .map(|entry| entry.target.clone())
            .ok_or_else(|| AppError::not_found("远端编辑窗口已失效，请从文件列表重新打开"))
    }
    pub fn authorize(&self, label: &str, session_id: &str, path: &str) -> AppResult<()> {
        if label == "main" {
            return Ok(());
        }
        let target = self.target(label)?;
        if target.session_id != session_id || target.path != path {
            return Err(AppError::invalid_input(
                "编辑窗口只能读取绑定的服务器和文件",
            ));
        }
        Ok(())
    }
    fn existing(&self, target: &EditorTarget) -> Option<String> {
        self.entries()
            .iter()
            .find(|(_, entry)| {
                entry.target.session_id == target.session_id && entry.target.path == target.path
            })
            .map(|(label, _)| label.clone())
    }
    fn remove(&self, label: &str) {
        self.entries().remove(label);
    }
    fn update(&self, label: &str, dirty: bool, busy: bool) -> AppResult<EditorTarget> {
        let mut entries = self.entries();
        let entry = entries
            .get_mut(label)
            .ok_or_else(|| AppError::not_found("编辑窗口已关闭"))?;
        entry.dirty = dirty;
        entry.busy = busy;
        Ok(entry.target.clone())
    }
    pub fn needs_attention(&self) -> Option<String> {
        self.entries()
            .iter()
            .find(|(_, entry)| entry.ready && (entry.dirty || entry.busy))
            .map(|(label, _)| label.clone())
    }
}
fn validate_target(target: &EditorTarget) -> AppResult<()> {
    if target.session_id.is_empty()
        || target.session_id.len() > 256
        || !target.path.starts_with('/')
        || target.path.ends_with('/')
        || target.path.len() > 4096
        || target.path.contains('\0')
        || target.connection_name.len() > 1024
    {
        return Err(AppError::invalid_input("请选择有效的 SSH 会话和远端文件"));
    }
    Ok(())
}
fn title(target: &EditorTarget, dirty: bool) -> String {
    let name: String = target
        .path
        .rsplit('/')
        .next()
        .unwrap_or("远端文件")
        .chars()
        .filter(|c| !c.is_control())
        .take(120)
        .collect();
    let connection: String = target
        .connection_name
        .chars()
        .filter(|c| !c.is_control())
        .take(60)
        .collect();
    format!(
        "{}{} — {} — MiraiHub",
        if dirty { "● " } else { "" },
        name,
        connection
    )
}
fn native_error(error: tauri::Error) -> AppError {
    AppError::internal(error.to_string())
}

#[tauri::command]
pub async fn open_remote_editor_window(
    window: WebviewWindow,
    app: AppHandle,
    windows: State<'_, RemoteEditorWindows>,
    sessions: State<'_, SessionManager>,
    request: EditorTarget,
) -> AppResult<()> {
    main_window(&window)?;
    validate_target(&request)?;
    let _opening = windows.opening.lock().await;
    if let Some(label) = windows.existing(&request) {
        if let Some(editor) = app.get_webview_window(&label) {
            if editor.is_visible().map_err(native_error)? {
                editor.unminimize().map_err(native_error)?;
                editor.set_focus().map_err(native_error)?;
            }
            return Ok(());
        }
        windows.remove(&label);
    }
    sessions.get(&request.session_id).await?;
    if windows.entries().len() >= 16 {
        return Err(AppError::invalid_input(
            "最多同时打开 16 个远端编辑窗口，请先关闭部分窗口",
        ));
    }
    let label = format!("{PREFIX}{}", random_id());
    windows.register(label.clone(), request.clone());
    // Use the app's transparent title bar: the native caption paints an opaque strip over Acrylic.
    // No parent relationship: closing/hiding main must not destroy unsaved drafts.
    let result = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App("index.html?window=remote-editor".into()),
    )
    .title(title(&request, false))
    .inner_size(1040.0, 720.0)
    .min_inner_size(640.0, 420.0)
    .decorations(false)
    .resizable(true)
    .minimizable(true)
    .maximizable(true)
    .transparent(true)
    .background_color(tauri::webview::Color(0, 0, 0, 0))
    .theme(Some(tauri::Theme::Dark))
    .shadow(false)
    .visible(false)
    .center()
    .build();
    let editor = match result {
        Ok(editor) => editor,
        Err(error) => {
            windows.remove(&label);
            return Err(native_error(error));
        }
    };
    super::window::enable_window_shadow(&editor);
    let app_events = app.clone();
    let editor_events = editor.clone();
    let label_events = label.clone();
    editor.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            // Before the listener handshake there can be no draft: allow OS close even if loading failed.
            if app_events
                .state::<RemoteEditorWindows>()
                .ready(&label_events)
            {
                api.prevent_close();
                let _ = editor_events.emit(CLOSE_EVENT, ());
            }
        }
        tauri::WindowEvent::Destroyed => {
            app_events
                .state::<RemoteEditorWindows>()
                .remove(&label_events);
            let app = app_events.clone();
            let label = label_events.clone();
            tauri::async_runtime::spawn(async move {
                app.state::<EditorManager>().close_window(&label).await;
            });
        }
        _ => {}
    });
    // The page's window_ready handshake applies the user's material and reveals it.
    Ok(())
}
#[tauri::command]
pub async fn remote_editor_target(
    window: WebviewWindow,
    windows: State<'_, RemoteEditorWindows>,
) -> AppResult<EditorTarget> {
    // The frontend installs its close listener before requesting the target.
    windows.mark_ready(window.label())
}
#[tauri::command]
pub async fn remote_editor_status(
    window: WebviewWindow,
    windows: State<'_, RemoteEditorWindows>,
    dirty: bool,
    busy: bool,
) -> AppResult<()> {
    let target = windows.update(window.label(), dirty, busy)?;
    window
        .set_title(&title(&target, dirty))
        .map_err(native_error)
}
#[tauri::command]
pub async fn remote_editor_finish(
    window: WebviewWindow,
    windows: State<'_, RemoteEditorWindows>,
    editor: State<'_, EditorManager>,
) -> AppResult<()> {
    windows.target(window.label())?;
    editor.close_window(window.label()).await;
    // Called only after the UI's save/discard flow; ordinary OS close requests cannot bypass it.
    window.destroy().map_err(native_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target(session: &str, path: &str) -> EditorTarget {
        EditorTarget {
            session_id: session.into(),
            path: path.into(),
            connection_name: "测试服务器".into(),
        }
    }
    #[test]
    fn target_is_bound_to_registered_window_and_session() {
        let windows = RemoteEditorWindows::default();
        windows.register("remote-editor-a".into(), target("s1", "/etc/app.conf"));
        assert!(windows
            .authorize("remote-editor-a", "s1", "/etc/app.conf")
            .is_ok());
        assert!(windows
            .authorize("remote-editor-a", "s2", "/etc/app.conf")
            .is_err());
        assert!(windows
            .authorize("remote-editor-a", "s1", "/etc/passwd")
            .is_err());
        assert!(windows
            .authorize("remote-editor-fake", "s1", "/etc/app.conf")
            .is_err());
        assert!(windows.target("settings").is_err());
        windows.remove("remote-editor-a");
        assert!(windows
            .authorize("remote-editor-a", "s1", "/etc/app.conf")
            .is_err());
    }
    #[test]
    fn repeated_open_keeps_window_and_draft_state() {
        let windows = RemoteEditorWindows::default();
        let file = target("s1", "/目录/带空格 &?#.txt");
        windows.register("remote-editor-a".into(), file.clone());
        assert_eq!(windows.existing(&file).as_deref(), Some("remote-editor-a"));
        assert!(windows.existing(&target("s2", &file.path)).is_none());
        assert!(!windows.ready("remote-editor-a"));
        assert!(windows.needs_attention().is_none()); // failed page initialization must not trap the user
        windows.mark_ready("remote-editor-a").unwrap();
        assert!(windows.ready("remote-editor-a"));
        assert!(windows.needs_attention().is_some()); // reader is now attached and loading
        windows.update("remote-editor-a", false, false).unwrap();
        assert!(windows.needs_attention().is_none());
        windows.update("remote-editor-a", true, false).unwrap();
        assert!(windows.needs_attention().is_some());
        windows.remove("remote-editor-a");
        assert!(windows.needs_attention().is_none());
    }
    #[test]
    fn validation_accepts_literal_special_characters_but_rejects_invalid_targets() {
        assert!(validate_target(&target("s1", "/目录/带空格 &?#.txt")).is_ok());
        for path in ["", "etc/config", "/", "/etc/", "/etc/\0test"] {
            assert!(validate_target(&target("s1", path)).is_err());
        }
        assert!(!title(&target("s1", "/a\nb.txt"), true).contains('\n'));
    }
}
