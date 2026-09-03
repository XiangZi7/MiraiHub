//! SSH 的 Tauri 命令层。
//!
//! 这一层只做三件事：取托管状态、转调业务层、把 `SshError` 转成 `AppError`。
//! 任何实际逻辑都不该写在这里 —— 命令函数难以单独测试，
//! 逻辑放在 session/keys/manager 里才能被 `cargo test` 覆盖。

use tauri::{AppHandle, State};

use crate::error::AppResult;

use super::manager::SessionManager;
use super::models::{
    CommandOutput, GenerateKeyRequest, PtyOptions, SessionInfo, SshConfig, SshKeyInfo,
};
use super::{events, keys};

/// 建立连接，返回会话 id。
#[tauri::command]
pub async fn ssh_connect(
    manager: State<'_, SessionManager>,
    config: SshConfig,
) -> AppResult<String> {
    Ok(manager.connect(config).await?)
}

/// 断开会话。
#[tauri::command]
pub async fn ssh_disconnect(
    manager: State<'_, SessionManager>,
    session_id: String,
) -> AppResult<()> {
    Ok(manager.disconnect(&session_id).await?)
}

/// 列出活跃会话。
#[tauri::command]
pub async fn ssh_list_sessions(manager: State<'_, SessionManager>) -> AppResult<Vec<SessionInfo>> {
    Ok(manager.list().await)
}

/// 打开交互式 shell。开好后输出走 `ssh://output` 事件推送。
#[tauri::command]
pub async fn ssh_open_shell(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    session_id: String,
    pty: PtyOptions,
) -> AppResult<()> {
    let session = manager.get(&session_id).await?;
    session.open_shell(app.clone(), pty).await?;

    // shell 就绪后再报 connected：前端据此才开始接收输出、允许输入
    events::emit_status(&app, events::StatusEvent::connected(&session_id));

    Ok(())
}

/// 向 shell 写入用户输入。
#[tauri::command]
pub async fn ssh_write(
    manager: State<'_, SessionManager>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    let session = manager.get(&session_id).await?;
    session.write(data.as_bytes()).await?;
    Ok(())
}

/// 同步终端尺寸。
#[tauri::command]
pub async fn ssh_resize(
    manager: State<'_, SessionManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let session = manager.get(&session_id).await?;
    session.resize(cols, rows).await?;
    Ok(())
}

/// 执行单条命令并返回结果。
#[tauri::command]
pub async fn ssh_exec(
    manager: State<'_, SessionManager>,
    session_id: String,
    command: String,
) -> AppResult<CommandOutput> {
    let session = manager.get(&session_id).await?;
    Ok(session.exec(&command).await?)
}

/// 扫描 ~/.ssh 下的密钥。
///
/// 文件 IO 是阻塞的，丢到 blocking 线程池，不占用 async 运行时的工作线程。
#[tauri::command]
pub async fn ssh_list_keys() -> AppResult<Vec<SshKeyInfo>> {
    let result = tauri::async_runtime::spawn_blocking(keys::list_keys)
        .await
        .map_err(|err| crate::error::AppError::internal(format!("扫描密钥任务失败：{err}")))?;

    Ok(result?)
}

/// 生成新密钥。
#[tauri::command]
pub async fn ssh_generate_key(request: GenerateKeyRequest) -> AppResult<SshKeyInfo> {
    let result = tauri::async_runtime::spawn_blocking(move || keys::generate_key(&request))
        .await
        .map_err(|err| crate::error::AppError::internal(format!("生成密钥任务失败：{err}")))?;

    Ok(result?)
}

/// 删除密钥对。
#[tauri::command]
pub async fn ssh_delete_key(key_id: String) -> AppResult<()> {
    let result = tauri::async_runtime::spawn_blocking(move || keys::delete_key(&key_id))
        .await
        .map_err(|err| crate::error::AppError::internal(format!("删除密钥任务失败：{err}")))?;

    Ok(result?)
}
