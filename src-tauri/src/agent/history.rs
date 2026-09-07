//! Encrypted transcripts, independent of live runs and single-use approvals.
use super::*;
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Weak,
};

pub(super) struct Identity {
    pub id: String,
    pub title: String,
    pub scope: String,
    pub created_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub model: String,
    pub provider: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Record {
    #[serde(flatten)]
    pub summary: Summary,
    scope: String,
    target: String,
    status: String,
    pub entries: Vec<Entry>,
    pub messages: Vec<Value>,
}

impl Record {
    fn from_run(run: &Run, cell: &Cell) -> Self {
        Self {
            summary: Summary {
                id: run.history.id.clone(),
                title: run.history.title.clone(),
                model: run.config.model.clone(),
                provider: run.config.base_url.clone(),
                created_at: run.history.created_at,
                updated_at: now(),
            },
            scope: run.history.scope.clone(),
            target: run.target_label.clone(),
            status: run.snapshot(cell).status,
            entries: run.entries.clone(),
            // Rebuild the system policy on resume, and never serialize credentials or approvals.
            messages: run
                .messages
                .iter()
                .filter(|m| m["role"] != "system")
                .cloned()
                .collect(),
        }
    }
    pub fn identity(&self) -> Identity {
        Identity {
            id: self.summary.id.clone(),
            title: self.summary.title.clone(),
            scope: self.scope.clone(),
            created_at: self.summary.created_at,
        }
    }
    pub fn snapshot(self) -> Snapshot {
        Snapshot {
            id: String::new(),
            conversation_id: self.summary.id,
            target: self.target,
            model: self.summary.model,
            provider: self.summary.provider,
            status: match self.status.as_str() {
                "running" | "approval" => "cancelled".into(),
                _ => self.status,
            },
            entries: self.entries,
            approval: None,
            save_error: None,
        }
    }
}

#[derive(Default)]
pub(super) struct Store {
    // Only the newest live run may write a transcript. Late responses cannot resurrect a deleted
    // conversation or overwrite a resumed conversation. Weak handles do not retain API keys.
    owners: HashMap<String, Weak<Cell>>,
    // Title edits are independent of an in-flight model/tool response.
    titles: HashMap<String, String>,
}
fn directory(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::internal("无法定位聊天记录目录"))?
        .join("ai-conversations"))
}
fn record_path(dir: &Path, id: &str) -> AppResult<PathBuf> {
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::invalid_input("无效的聊天会话 ID"));
    }
    Ok(dir.join(format!("{id}.bin")))
}
fn read(dir: &Path, id: &str, scope: &str) -> AppResult<Record> {
    let path = record_path(dir, id)?;
    if std::fs::metadata(&path)?.len() > 16 * 1024 * 1024 {
        return Err(AppError::invalid_input("聊天记录文件过大"));
    }
    let bytes = config::protect(&std::fs::read(path)?, false)?;
    let record: Record =
        serde_json::from_slice(&bytes).map_err(|_| AppError::invalid_input("聊天记录已损坏"))?;
    if record.summary.id != id || record.scope != scope {
        return Err(AppError::invalid_input("此聊天记录不属于当前连接或数据库"));
    }
    Ok(record)
}
fn write(dir: &Path, record: &Record) -> AppResult<()> {
    let path = record_path(dir, &record.summary.id)?;
    std::fs::create_dir_all(dir)?;
    let bytes = serde_json::to_vec(record).map_err(|_| AppError::internal("无法保存聊天记录"))?;
    let encrypted = config::protect(&bytes, true)?;
    let temporary = path.with_extension("bin.tmp");
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(&encrypted)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(temporary, path)?;
    Ok(())
}
impl Store {
    pub fn register(&mut self, conversation_id: &str, cell: &Arc<Cell>) {
        self.owners
            .insert(conversation_id.into(), Arc::downgrade(cell));
    }
    pub fn save(&self, app: &AppHandle, run: &Run, cell: &Cell) -> AppResult<()> {
        self.save_at(&directory(app)?, run, cell)
    }
    fn save_at(&self, dir: &Path, run: &Run, cell: &Cell) -> AppResult<()> {
        if self
            .owners
            .get(&run.history.id)
            .and_then(Weak::upgrade)
            .is_some_and(|owner| std::ptr::eq(owner.as_ref(), cell))
        {
            let mut record = Record::from_run(run, cell);
            if let Some(title) = self.titles.get(&run.history.id) {
                record.summary.title = title.clone();
            }
            write(dir, &record)?;
        }
        Ok(())
    }
    fn rename_at(
        &mut self,
        dir: &Path,
        conversation_id: &str,
        scope: &str,
        title: &str,
    ) -> AppResult<Summary> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 60 || title.chars().any(char::is_control) {
            return Err(AppError::invalid_input(
                "请输入 1 至 60 个字符的会话名称，不能包含换行或控制字符",
            ));
        }
        let mut record = read(dir, conversation_id, scope)?;
        record.summary.title = title.into();
        write(dir, &record)?;
        self.titles.insert(conversation_id.into(), title.into());
        Ok(record.summary)
    }
    pub fn resume(&self, app: &AppHandle, conversation_id: &str, scope: &str) -> AppResult<Record> {
        let dir = directory(app)?;
        // Validate the scope before touching any live owner.
        let record = read(&dir, conversation_id, scope)?;
        if let Some(owner) = self.owners.get(conversation_id).and_then(Weak::upgrade) {
            let run = owner
                .run
                .try_lock()
                .map_err(|_| AppError::invalid_input("上一轮操作仍在结束中，请稍后继续此会话"))?;
            if !owner.cancelled.load(Ordering::SeqCst)
                && matches!(run.status.as_str(), "running" | "approval")
            {
                return Err(AppError::invalid_input(
                    "此会话仍在处理中，请先停止当前操作",
                ));
            }
            self.save(app, &run, &owner)?;
            owner.cancelled.store(true, Ordering::SeqCst);
            return read(&dir, conversation_id, scope);
        }
        Ok(record)
    }
}

// Missing tool results represent interrupted/denied work, never permission to replay it.
pub(super) fn resume_messages(messages: Vec<Value>) -> Vec<Value> {
    let mut result = Vec::new();
    let mut pending = Vec::<String>::new();
    for message in messages {
        if message["role"] == "system" {
            continue;
        }
        if message["role"] != "tool" {
            close_pending(&mut result, &mut pending);
        } else if let Some(id) = message["tool_call_id"].as_str() {
            pending.retain(|value| value != id);
        }
        if let Some(calls) = message["tool_calls"].as_array() {
            pending.extend(
                calls
                    .iter()
                    .filter_map(|call| call["id"].as_str().map(String::from)),
            );
        }
        result.push(message);
    }
    close_pending(&mut result, &mut pending);
    result
}
fn close_pending(messages: &mut Vec<Value>, pending: &mut Vec<String>) {
    for call_id in pending.drain(..) {
        messages.push(json!({"role":"tool", "tool_call_id":call_id, "content":"Previous operation was interrupted or denied. There is no confirmed result. Do not assume success or replay the operation; verify remote state and request fresh approval if the user wants to proceed."}));
    }
}
pub(super) async fn scope(app: &AppHandle, target: &Target) -> AppResult<String> {
    let (label, _) = bind(app, target).await?;
    let engine = if target.kind == "database" {
        format!(
            "{:?}",
            app.state::<db::DatabaseManager>()
                .describe_session(&target.session_id)
                .await?
                .kind
        )
    } else {
        String::new()
    };
    Ok(json!([target.kind, label, engine]).to_string())
}

#[tauri::command]
pub async fn ai_list_conversations(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AgentManager>,
    target: Target,
) -> AppResult<Vec<Summary>> {
    guard(&window, false)?;
    let scope = scope(&app, &target).await?;
    let _store = state.history.lock().await;
    let dir = directory(&app)?;
    let files = match std::fs::read_dir(&dir) {
        Ok(files) => files,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.into()),
    };
    let mut summaries = Vec::new();
    for file in files {
        let path = file?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("bin") {
            continue;
        }
        if std::fs::metadata(&path)?.len() > 16 * 1024 * 1024 {
            return Err(AppError::invalid_input("聊天记录文件过大"));
        }
        let bytes = config::protect(&std::fs::read(&path)?, false)?;
        let record: Record = serde_json::from_slice(&bytes)
            .map_err(|_| AppError::invalid_input("聊天记录已损坏，无法加载历史列表"))?;
        if record_path(&dir, &record.summary.id)? != path {
            return Err(AppError::invalid_input("聊天记录文件与会话 ID 不匹配"));
        }
        if record.scope == scope {
            summaries.push(record.summary);
        }
    }
    summaries.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(summaries)
}
#[tauri::command]
pub async fn ai_open_conversation(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AgentManager>,
    target: Target,
    conversation_id: String,
) -> AppResult<Snapshot> {
    guard(&window, false)?;
    let scope = scope(&app, &target).await?;
    let _store = state.history.lock().await;
    Ok(read(&directory(&app)?, &conversation_id, &scope)?.snapshot())
}
#[tauri::command]
pub async fn ai_rename_conversation(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AgentManager>,
    target: Target,
    conversation_id: String,
    title: String,
) -> AppResult<Summary> {
    guard(&window, false)?;
    let scope = scope(&app, &target).await?;
    state
        .history
        .lock()
        .await
        .rename_at(&directory(&app)?, &conversation_id, &scope, &title)
}
#[tauri::command]
pub async fn ai_delete_conversation(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AgentManager>,
    target: Target,
    conversation_id: String,
) -> AppResult<()> {
    guard(&window, false)?;
    let scope = scope(&app, &target).await?;
    let mut store = state.history.lock().await;
    let dir = directory(&app)?;
    read(&dir, &conversation_id, &scope)?;
    std::fs::remove_file(record_path(&dir, &conversation_id)?)?;
    store.titles.remove(&conversation_id);
    if let Some(owner) = store
        .owners
        .remove(&conversation_id)
        .and_then(|owner| owner.upgrade())
    {
        owner.cancelled.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cell(conversation_id: &str) -> Arc<Cell> {
        let mut run = super::super::tests::pending_run();
        run.id = id();
        run.history.id = conversation_id.into();
        run.config.api_key = "test-secret-never-stored".into();
        run.messages = vec![
            json!({"role":"system","content":"current policy"}),
            json!({"role":"user","content":"检查服务器"}),
        ];
        run.entry("user", "检查服务器", None);
        Arc::new(Cell {
            cancelled: AtomicBool::new(false),
            run: Mutex::new(run),
        })
    }
    #[test]
    fn resumes_context_without_replaying_unfinished_tools() {
        let messages = resume_messages(vec![
            json!({"role":"system","content":"old policy"}),
            json!({"role":"user","content":"check"}),
            json!({"role":"assistant","tool_calls":[{"id":"done"}]}),
            json!({"role":"tool","tool_call_id":"done","content":"confirmed result"}),
            json!({"role":"assistant","tool_calls":[{"id":"pending"}]}),
        ]);
        assert_eq!(messages.len(), 5);
        assert_eq!(messages[2]["content"], "confirmed result");
        assert_eq!(messages[4]["tool_call_id"], "pending");
        assert!(messages[4]["content"]
            .as_str()
            .unwrap()
            .contains("no confirmed result"));
        assert!(!messages.iter().any(|m| m["role"] == "system"));
    }
    #[test]
    fn rejects_paths_outside_the_history_directory() {
        for invalid in [
            "../other",
            "C:/secret",
            "",
            "abc",
            "0000000000000000000000000000000/",
        ] {
            assert!(record_path(Path::new("history"), invalid).is_err());
        }
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn encrypted_history_survives_reload_and_never_restores_execution_authority() {
        let conversation_id = id();
        let dir = std::env::temp_dir().join(format!("miraihub-history-test-{}", id()));
        let owner = cell(&conversation_id);
        let mut store = Store::default();
        store.register(&conversation_id, &owner);
        let mut run = owner.run.lock().await;
        store.save_at(&dir, &run, &owner).unwrap();
        run.entry("assistant", "**完成**", None);
        store.save_at(&dir, &run, &owner).unwrap();
        drop(store);
        let record = read(&dir, &conversation_id, "ssh-host").unwrap();
        assert_eq!(record.entries.len(), 2);
        let serialized = serde_json::to_string(&record).unwrap();
        assert!(!serialized.contains("test-secret-never-stored"));
        assert!(!serialized.contains("expiresAt"));
        assert!(!serialized.contains("current policy"));
        assert!(read(&dir, &conversation_id, "different-target").is_err());
        let snapshot = record.snapshot();
        assert!(snapshot.id.is_empty());
        assert!(snapshot.approval.is_none());
        assert_eq!(snapshot.status, "cancelled");
        let path = record_path(&dir, &conversation_id).unwrap();
        assert!(!std::fs::read(&path)
            .unwrap()
            .windows("检查服务器".len())
            .any(|v| v == "检查服务器".as_bytes()));
        assert!(!path.with_extension("bin.tmp").exists());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn renaming_survives_live_saves_and_preserves_the_transcript() {
        let conversation_id = id();
        let dir = std::env::temp_dir().join(format!("miraihub-history-test-{}", id()));
        let owner = cell(&conversation_id);
        let mut store = Store::default();
        store.register(&conversation_id, &owner);
        let mut run = owner.run.lock().await;
        store.save_at(&dir, &run, &owner).unwrap();
        let renamed = store
            .rename_at(&dir, &conversation_id, "ssh-host", "  服务器排查记录  ")
            .unwrap();
        assert_eq!(renamed.title, "服务器排查记录");
        for invalid in [String::new(), "  ".into(), "a".repeat(61), "a\nb".into()] {
            assert!(store
                .rename_at(&dir, &conversation_id, "ssh-host", &invalid)
                .is_err());
        }
        assert!(store
            .rename_at(&dir, &conversation_id, "another-host", "错误修改")
            .is_err());
        run.entry("assistant", "继续响应", None);
        store.save_at(&dir, &run, &owner).unwrap();
        drop(store);
        let restored = read(&dir, &conversation_id, "ssh-host").unwrap();
        assert_eq!(restored.summary.title, "服务器排查记录");
        assert_eq!(restored.entries.len(), 2);
        assert_eq!(restored.entries[0].text, "检查服务器");
        assert!(!owner.cancelled.load(Ordering::SeqCst));
        std::fs::remove_file(record_path(&dir, &conversation_id).unwrap()).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn stale_runs_cannot_overwrite_or_resurrect_a_conversation() {
        let conversation_id = id();
        let dir = std::env::temp_dir().join(format!("miraihub-history-test-{}", id()));
        let first = cell(&conversation_id);
        let second = cell(&conversation_id);
        let mut store = Store::default();
        store.register(&conversation_id, &first);
        store
            .save_at(&dir, &*first.run.lock().await, &first)
            .unwrap();
        store.register(&conversation_id, &second);
        let mut newer = second.run.lock().await;
        newer.entry("assistant", "new answer", None);
        store.save_at(&dir, &newer, &second).unwrap();
        store
            .save_at(&dir, &*first.run.lock().await, &first)
            .unwrap();
        assert_eq!(
            read(&dir, &conversation_id, "ssh-host")
                .unwrap()
                .entries
                .last()
                .unwrap()
                .text,
            "new answer"
        );
        std::fs::remove_file(record_path(&dir, &conversation_id).unwrap()).unwrap();
        store.owners.remove(&conversation_id);
        store.save_at(&dir, &newer, &second).unwrap();
        assert!(!record_path(&dir, &conversation_id).unwrap().exists());
        std::fs::remove_dir(dir).unwrap();
    }
}
