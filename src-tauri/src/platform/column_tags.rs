//! 数据库列「标签化显示」设置窗口。
//!
//! 与连接配置窗口一样由 Rust 创建原生模态子窗口：请求内容（列名、当前规则、
//! 取值样本）留在 Rust 状态里，子窗口按窗口身份读取；保存结果通过事件回传主窗，
//! 不经过 URL，也不依赖两个 WebView 共享 localStorage 的时序。

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};
use crate::ssh::tunnels::main_window;

use super::window::{enable_window_shadow, to_app_error};

/// 子窗口 label。
pub const WINDOW: &str = "column-tags";
/// 保存结果回传主窗口的事件名。
pub const RESULT_EVENT: &str = "database-column-tags";

/// 取值样本的上限：只用于“从当前页取值”，多了没有意义。
const MAX_SAMPLE_VALUES: usize = 200;
/// 单个样本值的最大长度，更长的值不可能是枚举。
const MAX_SAMPLE_LENGTH: usize = 256;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColumnTagsRequest {
    /// 前端的列宽/标签作用域（通常是表的标识），原样回传。
    pub scope: String,
    pub column: String,
    /// 现有规则，结构由前端定义，Rust 只负责转手。
    #[serde(default)]
    pub initial: Option<serde_json::Value>,
    #[serde(default)]
    pub sample_values: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnTagsResult {
    pub scope: String,
    pub column: String,
    /// None 表示取消该列的标签化。
    pub config: Option<serde_json::Value>,
}

#[derive(Default)]
pub struct ColumnTagsWindow {
    request: Mutex<Option<ColumnTagsRequest>>,
    opening: tokio::sync::Mutex<()>,
}

impl ColumnTagsWindow {
    fn request(&self) -> std::sync::MutexGuard<'_, Option<ColumnTagsRequest>> {
        self.request
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

fn validate(request: &mut ColumnTagsRequest) -> AppResult<()> {
    if request.scope.is_empty()
        || request.scope.len() > 512
        || request.column.is_empty()
        || request.column.len() > 256
        || request.column.chars().any(char::is_control)
    {
        return Err(AppError::invalid_input("请选择有效的表格列"));
    }
    request
        .sample_values
        .retain(|value| !value.is_empty() && value.len() <= MAX_SAMPLE_LENGTH);
    request.sample_values.truncate(MAX_SAMPLE_VALUES);
    Ok(())
}

fn ensure_dialog(window: &WebviewWindow) -> AppResult<()> {
    if window.label() != WINDOW {
        return Err(AppError::invalid_input("仅标签设置窗口可以执行此操作"));
    }
    Ok(())
}

#[tauri::command]
pub async fn open_column_tags_window(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, ColumnTagsWindow>,
    mut request: ColumnTagsRequest,
) -> AppResult<()> {
    main_window(&window)?;
    validate(&mut request)?;
    let _opening = state.opening.lock().await;

    if let Some(dialog) = app.get_webview_window(WINDOW) {
        // 主窗在弹窗期间是禁用的，正常到不了这里；兜底把已有窗口带到前台。
        if dialog.is_visible().map_err(to_app_error)? {
            dialog.set_focus().map_err(to_app_error)?;
        }
        return Ok(());
    }
    *state.request() = Some(request);

    let main = app.get_webview_window("main");
    let mut builder = WebviewWindowBuilder::new(
        &app,
        WINDOW,
        WebviewUrl::App("index.html?window=column-tags".into()),
    )
    .title("标签化显示")
    .inner_size(760.0, 640.0)
    .min_inner_size(640.0, 520.0)
    .resizable(true)
    .minimizable(false)
    .maximizable(false)
    .decorations(false)
    // 与其他子窗口一致：透明 WebView 透出系统材质，阴影交给 DWM。
    .transparent(true)
    .background_color(tauri::webview::Color(0, 0, 0, 0))
    .shadow(false)
    .skip_taskbar(true)
    .visible(false)
    .center();

    if let Some(parent) = main.as_ref() {
        builder = builder.parent(parent).map_err(to_app_error)?;
    }

    #[cfg(windows)]
    {
        builder = builder.effects(super::window::windows_window_effects());
    }

    let dialog = match builder.build() {
        Ok(dialog) => dialog,
        Err(error) => {
            *state.request() = None;
            return Err(to_app_error(error));
        }
    };
    enable_window_shadow(&dialog);

    // 先注册销毁监听，再由 window_ready 禁用父窗；顺序反了主窗可能永久卡在禁用态。
    let app_events = app.clone();
    dialog.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            *app_events.state::<ColumnTagsWindow>().request() = None;
            if let Some(parent) = app_events.get_webview_window("main") {
                let _ = parent.set_enabled(true);
                let _ = parent.set_focus();
            }
        }
    });
    Ok(())
}

/// 子窗口读取自己要编辑的列。
#[tauri::command]
pub async fn column_tags_target(
    window: WebviewWindow,
    state: State<'_, ColumnTagsWindow>,
) -> AppResult<ColumnTagsRequest> {
    ensure_dialog(&window)?;
    state
        .request()
        .clone()
        .ok_or_else(|| AppError::not_found("标签设置已失效，请重新从表头打开"))
}

/// 子窗口提交结果：转发给主窗口并关闭自己。`config` 为 null 表示取消标签化。
#[tauri::command]
pub async fn column_tags_submit(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, ColumnTagsWindow>,
    config: Option<serde_json::Value>,
) -> AppResult<()> {
    ensure_dialog(&window)?;
    let request = state
        .request()
        .clone()
        .ok_or_else(|| AppError::not_found("标签设置已失效，请重新从表头打开"))?;
    app.emit_to(
        "main",
        RESULT_EVENT,
        ColumnTagsResult {
            scope: request.scope,
            column: request.column,
            config,
        },
    )
    .map_err(to_app_error)?;
    window.close().map_err(to_app_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(column: &str) -> ColumnTagsRequest {
        ColumnTagsRequest {
            scope: "table:public.users".into(),
            column: column.into(),
            initial: None,
            sample_values: vec![
                "POST".into(),
                String::new(),
                "x".repeat(MAX_SAMPLE_LENGTH + 1),
                "GET".into(),
            ],
        }
    }

    #[test]
    fn validation_drops_unusable_samples_and_rejects_bad_columns() {
        let mut ok = request("method");
        validate(&mut ok).unwrap();
        assert_eq!(ok.sample_values, vec!["POST".to_owned(), "GET".to_owned()]);
        assert!(validate(&mut request("")).is_err());
        assert!(validate(&mut request("bad\ncolumn")).is_err());
        let mut empty_scope = request("method");
        empty_scope.scope.clear();
        assert!(validate(&mut empty_scope).is_err());
    }
}
