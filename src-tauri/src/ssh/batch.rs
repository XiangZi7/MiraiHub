//! Batch plans are immutable and approved once. Only already-connected sessions participate.
use super::{
    models::CommandOutput,
    tunnels::{main_window, random_id},
    SessionManager,
};
use crate::error::{AppError, AppResult};
use futures_util::{stream, StreamExt};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tokio::sync::Mutex;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTarget {
    pub session_id: String,
    pub endpoint: String,
    pub status: String,
    pub output: Option<CommandOutput>,
    pub error: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPlan {
    pub id: String,
    pub command: String,
    pub targets: Vec<BatchTarget>,
    pub status: String,
    pub expires_at: i64,
}
struct Batch {
    plan: Mutex<BatchPlan>,
    cancelled: AtomicBool,
    expires: Instant,
}
#[derive(Default)]
pub struct BatchManager {
    runs: Mutex<HashMap<String, Arc<Batch>>>,
}
impl BatchManager {
    async fn get(&self, id: &str) -> AppResult<Arc<Batch>> {
        self.runs
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::not_found("批量任务不存在"))
    }
    pub async fn shutdown(&self) {
        for b in self.runs.lock().await.values() {
            b.cancelled.store(true, Ordering::SeqCst);
        }
    }
}
fn validate_command(command: &str) -> AppResult<()> {
    if command.trim().is_empty()
        || command.len() > 8192
        || command.chars().any(|c| {
            (c.is_control() && c != '\n' && c != '\t')
                || matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}')
        })
    {
        Err(AppError::invalid_input("命令为空、过长或含隐藏控制字符"))
    } else {
        Ok(())
    }
}
fn approve(plan: &mut BatchPlan, expires: Instant) -> AppResult<()> {
    if plan.status != "pending" {
        return Err(AppError::invalid_input("此执行计划已使用或已取消"));
    }
    if Instant::now() >= expires {
        plan.status = "expired".into();
        return Err(AppError::invalid_input("执行计划已过期，请重新预览"));
    }
    plan.status = "running".into();
    Ok(())
}
#[tauri::command]
pub async fn ssh_batch_prepare(
    window: WebviewWindow,
    manager: State<'_, SessionManager>,
    batches: State<'_, BatchManager>,
    session_ids: Vec<String>,
    command: String,
) -> AppResult<BatchPlan> {
    main_window(&window)?;
    validate_command(&command)?;
    if session_ids.is_empty()
        || session_ids.len() > 20
        || session_ids.iter().collect::<HashSet<_>>().len() != session_ids.len()
    {
        return Err(AppError::invalid_input("请选择 1–20 台不同的已连接服务器"));
    }
    let mut targets = Vec::new();
    for id in session_ids {
        let session = manager.get(&id).await?;
        if session.is_closed().await {
            return Err(AppError::invalid_input("所选 SSH 已断开，请刷新列表"));
        }
        targets.push(BatchTarget {
            session_id: id,
            endpoint: session.config().endpoint(),
            status: "pending".into(),
            output: None,
            error: String::new(),
        });
    }
    let plan = BatchPlan {
        id: random_id(),
        command,
        targets,
        status: "pending".into(),
        expires_at: chrono::Utc::now().timestamp_millis() + 300000,
    };
    let mut runs = batches.runs.lock().await;
    if runs.len() >= 32 {
        return Err(AppError::invalid_input("批量任务过多，请先清空旧任务"));
    }
    runs.insert(
        plan.id.clone(),
        Arc::new(Batch {
            plan: Mutex::new(plan.clone()),
            cancelled: AtomicBool::new(false),
            expires: Instant::now() + Duration::from_secs(300),
        }),
    );
    Ok(plan)
}
#[tauri::command]
pub async fn ssh_batch_run(
    window: WebviewWindow,
    app: AppHandle,
    batches: State<'_, BatchManager>,
    id: String,
) -> AppResult<BatchPlan> {
    main_window(&window)?;
    let batch = batches.get(&id).await?;
    let mut plan = batch.plan.lock().await;
    if batch.cancelled.load(Ordering::SeqCst) {
        return Err(AppError::invalid_input("任务已取消"));
    }
    approve(&mut plan, batch.expires)?;
    let snapshot = plan.clone();
    drop(plan);
    tauri::async_runtime::spawn(async move {
        let targets = batch.plan.lock().await.targets.clone();
        let command = batch.plan.lock().await.command.clone();
        stream::iter(targets.into_iter().enumerate())
            .for_each_concurrent(3, |(index, target)| {
                let batch = batch.clone();
                let app = app.clone();
                let command = command.clone();
                async move {
                    if batch.cancelled.load(Ordering::SeqCst) {
                        batch.plan.lock().await.targets[index].status = "cancelled".into();
                        return;
                    }
                    batch.plan.lock().await.targets[index].status = "running".into();
                    let result = async {
                        let session = app
                            .state::<SessionManager>()
                            .get(&target.session_id)
                            .await?;
                        if batch.cancelled.load(Ordering::SeqCst) {
                            return Err(AppError::invalid_input("任务已取消"));
                        }
                        Ok::<_, AppError>(session.exec_agent(&command).await?)
                    }
                    .await;
                    let mut plan = batch.plan.lock().await;
                    let target = &mut plan.targets[index];
                    match result {
                        Ok(output) => {
                            target.status = if output.exit_code == Some(0) {
                                "success"
                            } else {
                                "failed"
                            }
                            .into();
                            target.output = Some(output);
                        }
                        Err(error) => {
                            target.status = "failed".into();
                            target.error = error.message;
                        }
                    }
                }
            })
            .await;
        batch.plan.lock().await.status = if batch.cancelled.load(Ordering::SeqCst) {
            "cancelled"
        } else {
            "completed"
        }
        .into();
    });
    Ok(snapshot)
}
#[tauri::command]
pub async fn ssh_batch_get(
    window: WebviewWindow,
    batches: State<'_, BatchManager>,
    id: String,
) -> AppResult<BatchPlan> {
    main_window(&window)?;
    let b = batches.get(&id).await?;
    let mut p = b.plan.lock().await;
    if p.status == "pending" && Instant::now() >= b.expires {
        p.status = "expired".into();
    }
    Ok(p.clone())
}
#[tauri::command]
pub async fn ssh_batch_cancel(
    window: WebviewWindow,
    batches: State<'_, BatchManager>,
    id: String,
) -> AppResult<()> {
    main_window(&window)?;
    let b = batches.get(&id).await?;
    b.cancelled.store(true, Ordering::SeqCst);
    let mut p = b.plan.lock().await;
    if p.status == "pending" {
        p.status = "cancelled".into();
    }
    Ok(())
}
#[tauri::command]
pub async fn ssh_batch_forget(
    window: WebviewWindow,
    batches: State<'_, BatchManager>,
    id: String,
) -> AppResult<()> {
    main_window(&window)?;
    if let Some(b) = batches.runs.lock().await.remove(&id) {
        b.cancelled.store(true, Ordering::SeqCst);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn approval_is_one_shot() {
        let mut p = BatchPlan {
            id: "1".into(),
            command: "id".into(),
            targets: vec![],
            status: "pending".into(),
            expires_at: 0,
        };
        let deadline = Instant::now() + Duration::from_secs(20);
        assert!(approve(&mut p, deadline).is_ok());
        assert!(approve(&mut p, deadline).is_err());
    }
    #[test]
    fn expired_plan_never_runs() {
        let mut p = BatchPlan {
            id: "1".into(),
            command: "id".into(),
            targets: vec![],
            status: "pending".into(),
            expires_at: 0,
        };
        assert!(approve(&mut p, Instant::now()).is_err());
        assert_eq!(p.status, "expired");
    }
    #[test]
    fn hidden_or_unbounded_commands_rejected() {
        for v in [
            String::new(),
            "x".repeat(8193),
            "echo ok\0rm -rf /".into(),
            "echo \u{202e}evil".into(),
        ] {
            assert!(validate_command(&v).is_err());
        }
        assert!(validate_command("df -h\nfree -m").is_ok());
    }
}
