//! 连接过程中需要用户当场确认的交互：未知/变更的主机密钥、键盘交互认证（含二次验证）。
//!
//! 后端发事件到主窗口后挂起等待，前端调用对应的 respond 命令回填结果；
//! 超时（120 秒）或连接被放弃时自动视为拒绝，并通知前端关掉对话框。

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use super::events::TERMINAL_WINDOW;
use crate::error::{AppError, AppResult};

/// 未知主机或主机密钥变化，等待用户决定是否信任。
pub const EVENT_HOST_KEY_PROMPT: &str = "ssh://host-key-prompt";
/// 服务器要求键盘交互认证（验证码、OTP 等）。
pub const EVENT_AUTH_PROMPT: &str = "ssh://auth-prompt";
/// 请求已超时或连接已放弃，前端据此关闭对应对话框。
pub const EVENT_PROMPT_CLOSED: &str = "ssh://prompt-closed";
/// 用户最长思考时间，超时按拒绝处理。
pub const PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

/// 用户对主机密钥的决定。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostKeyDecision {
    /// 是否继续连接
    pub accept: bool,
    /// 是否写入 known_hosts（密钥变化时替换旧记录）
    pub remember: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPrompt {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    /// SHA256 指纹
    pub fingerprint: String,
    /// `unknown` 首次见到；`changed` 与已保存的记录不一致
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPromptField {
    pub prompt: String,
    pub echo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPrompt {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub name: String,
    pub instructions: String,
    pub prompts: Vec<AuthPromptField>,
}

/// 事件出口。抽成 trait 是为了单元测试不必启动 Tauri。
pub trait PromptSink: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value) -> bool;
}

struct AppSink(AppHandle);

impl PromptSink for AppSink {
    fn emit(&self, event: &str, payload: serde_json::Value) -> bool {
        self.0.emit_to(TERMINAL_WINDOW, event, payload).is_ok()
    }
}

type Waiters<T> = Mutex<HashMap<String, oneshot::Sender<T>>>;

pub struct Prompter {
    sink: Arc<dyn PromptSink>,
    host_keys: Waiters<HostKeyDecision>,
    answers: Waiters<Option<Vec<String>>>,
    timeout: Duration,
}

static PROMPTER: OnceLock<Arc<Prompter>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();

/// 首次发起连接时安装；之后所有新建连接都能向主窗口弹确认框。重复调用无副作用。
pub fn install(app: &AppHandle) {
    if APP.set(app.clone()).is_ok() {
        let _ = PROMPTER.set(Arc::new(Prompter::new(
            Arc::new(AppSink(app.clone())),
            PROMPT_TIMEOUT,
        )));
    }
}

pub fn global() -> Option<Arc<Prompter>> {
    PROMPTER.get().cloned()
}

/// 后台任务（如死会话清理）推送事件用的应用句柄。
pub fn app_handle() -> Option<AppHandle> {
    APP.get().cloned()
}

/// 等待结束（超时、连接被放弃）时清掉登记项；仍未作答说明前端还开着对话框，需通知关闭。
struct Pending<'a, T> {
    waiters: &'a Waiters<T>,
    sink: &'a dyn PromptSink,
    id: String,
}

impl<T> Drop for Pending<'_, T> {
    fn drop(&mut self) {
        let stale = lock(self.waiters).remove(&self.id).is_some();
        if stale {
            self.sink.emit(
                EVENT_PROMPT_CLOSED,
                serde_json::json!({ "requestId": self.id }),
            );
        }
    }
}

fn lock<T>(waiters: &Waiters<T>) -> std::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<T>>> {
    waiters.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 请求 id 只需进程内唯一：毫秒时间戳 + 自增序号。
fn request_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis())
        .unwrap_or_default();
    format!("prompt-{millis}-{seq}")
}

impl Prompter {
    pub fn new(sink: Arc<dyn PromptSink>, timeout: Duration) -> Self {
        Self {
            sink,
            host_keys: Mutex::default(),
            answers: Mutex::default(),
            timeout,
        }
    }

    /// 返回用户的决定；Err 为未得到答复的原因。
    pub async fn host_key(&self, prompt: HostKeyPrompt) -> Result<HostKeyDecision, String> {
        self.ask(&self.host_keys, EVENT_HOST_KEY_PROMPT, prompt)
            .await
    }

    /// Ok(None) 表示用户取消。
    pub async fn auth(&self, prompt: AuthPrompt) -> Result<Option<Vec<String>>, String> {
        self.ask(&self.answers, EVENT_AUTH_PROMPT, prompt).await
    }

    pub fn respond_host_key(&self, id: &str, decision: HostKeyDecision) -> bool {
        lock(&self.host_keys)
            .remove(id)
            .is_some_and(|sender| sender.send(decision).is_ok())
    }

    pub fn respond_auth(&self, id: &str, answers: Option<Vec<String>>) -> bool {
        lock(&self.answers)
            .remove(id)
            .is_some_and(|sender| sender.send(answers).is_ok())
    }

    async fn ask<T, P: Serialize>(
        &self,
        waiters: &Waiters<T>,
        event: &str,
        payload: P,
    ) -> Result<T, String> {
        let mut payload = serde_json::to_value(payload)
            .map_err(|error| format!("确认请求序列化失败：{error}"))?;
        let id = request_id();
        payload["requestId"] = id.clone().into();
        let (sender, receiver) = oneshot::channel();
        lock(waiters).insert(id.clone(), sender);
        let _pending = Pending {
            waiters,
            sink: self.sink.as_ref(),
            id,
        };
        if !self.sink.emit(event, payload) {
            return Err("没有可显示确认框的窗口".into());
        }
        match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => Err("确认请求已失效".into()),
            Err(_) => Err(format!("{} 秒内未确认", self.timeout.as_secs())),
        }
    }
}

/// 连接超时的“暂停表”：等待用户输入的时间不计入连接超时。
#[derive(Default)]
pub struct PauseClock {
    prompting: AtomicUsize,
    paused_ms: AtomicU64,
}

struct Resume<'a> {
    clock: &'a PauseClock,
    started: Instant,
}

impl Drop for Resume<'_> {
    fn drop(&mut self) {
        let elapsed = self.started.elapsed().as_millis() as u64;
        self.clock.paused_ms.fetch_add(elapsed, Ordering::SeqCst);
        self.clock.prompting.fetch_sub(1, Ordering::SeqCst);
    }
}

impl PauseClock {
    pub async fn pause<F: Future>(&self, future: F) -> F::Output {
        self.prompting.fetch_add(1, Ordering::SeqCst);
        let _resume = Resume {
            clock: self,
            started: Instant::now(),
        };
        future.await
    }

    fn prompting(&self) -> bool {
        self.prompting.load(Ordering::SeqCst) > 0
    }

    fn paused(&self) -> Duration {
        Duration::from_millis(self.paused_ms.load(Ordering::SeqCst))
    }
}

/// 与 `tokio::time::timeout` 相同，但扣除 `clock` 记录的等待用户时间；超时返回 None。
pub async fn timeout_excluding_prompts<F: Future>(
    limit: Duration,
    clock: &PauseClock,
    future: F,
) -> Option<F::Output> {
    tokio::pin!(future);
    let started = Instant::now();
    loop {
        let deadline = started + limit + clock.paused();
        let wait = if clock.prompting() {
            Duration::from_millis(250)
        } else {
            deadline.saturating_duration_since(Instant::now())
        };
        tokio::select! {
            output = &mut future => return Some(output),
            _ = tokio::time::sleep(wait) => {
                if !clock.prompting() && Instant::now() >= started + limit + clock.paused() {
                    return None;
                }
            }
        }
    }
}

/// 回应主机密钥确认：accept 继续连接，remember 同时写入 known_hosts。
#[tauri::command]
pub fn ssh_host_key_respond(request_id: String, accept: bool, remember: bool) -> AppResult<()> {
    let decision = HostKeyDecision {
        accept,
        remember: accept && remember,
    };
    let answered =
        global().is_some_and(|prompter| prompter.respond_host_key(&request_id, decision));
    if answered {
        Ok(())
    } else {
        Err(AppError::not_found("确认请求已超时或已取消"))
    }
}

/// 回应键盘交互认证；answers 为 None 表示取消。
#[tauri::command]
pub fn ssh_auth_prompt_respond(request_id: String, answers: Option<Vec<String>>) -> AppResult<()> {
    let answered = global().is_some_and(|prompter| prompter.respond_auth(&request_id, answers));
    if answered {
        Ok(())
    } else {
        Err(AppError::not_found("验证请求已超时或已取消"))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tokio::sync::mpsc;

    /// 把事件转进通道，测试里扮演前端。
    pub(crate) struct ChannelSink(pub mpsc::UnboundedSender<(String, serde_json::Value)>);

    impl PromptSink for ChannelSink {
        fn emit(&self, event: &str, payload: serde_json::Value) -> bool {
            self.0.send((event.to_owned(), payload)).is_ok()
        }
    }

    pub(crate) fn test_prompter(
        timeout: Duration,
    ) -> (
        Arc<Prompter>,
        mpsc::UnboundedReceiver<(String, serde_json::Value)>,
    ) {
        let (sender, receiver) = mpsc::unbounded_channel();
        (
            Arc::new(Prompter::new(Arc::new(ChannelSink(sender)), timeout)),
            receiver,
        )
    }

    fn host_prompt() -> HostKeyPrompt {
        HostKeyPrompt {
            host: "example.com".into(),
            port: 22,
            algorithm: "ssh-ed25519".into(),
            fingerprint: "SHA256:abc".into(),
            status: "changed",
            old_fingerprint: Some("SHA256:old".into()),
        }
    }

    #[tokio::test]
    async fn host_key_answer_reaches_the_waiting_connection() {
        let (prompter, mut events) = test_prompter(Duration::from_secs(5));
        let responder = prompter.clone();
        tokio::spawn(async move {
            let (event, payload) = events.recv().await.unwrap();
            assert_eq!(event, EVENT_HOST_KEY_PROMPT);
            assert_eq!(payload["fingerprint"], "SHA256:abc");
            assert_eq!(payload["status"], "changed");
            assert_eq!(payload["oldFingerprint"], "SHA256:old");
            let id = payload["requestId"].as_str().unwrap().to_owned();
            let once = HostKeyDecision {
                accept: true,
                remember: false,
            };
            assert!(responder.respond_host_key(&id, once));
            // 同一请求只能答复一次
            assert!(!responder.respond_host_key(&id, once));
        });
        assert_eq!(
            prompter.host_key(host_prompt()).await,
            Ok(HostKeyDecision {
                accept: true,
                remember: false
            })
        );
    }

    #[tokio::test]
    async fn unanswered_prompt_times_out_and_closes_the_dialog() {
        let (prompter, mut events) = test_prompter(Duration::from_millis(50));
        let result = prompter.host_key(host_prompt()).await;
        assert!(result.is_err());
        let (_, opened) = events.recv().await.unwrap();
        let (event, closed) = events.recv().await.unwrap();
        assert_eq!(event, EVENT_PROMPT_CLOSED);
        assert_eq!(closed["requestId"], opened["requestId"]);
        let id = opened["requestId"].as_str().unwrap();
        let decision = HostKeyDecision {
            accept: true,
            remember: true,
        };
        assert!(!prompter.respond_host_key(id, decision));
    }

    #[tokio::test]
    async fn cancelled_auth_prompt_returns_none() {
        let (prompter, mut events) = test_prompter(Duration::from_secs(5));
        let responder = prompter.clone();
        tokio::spawn(async move {
            let (event, payload) = events.recv().await.unwrap();
            assert_eq!(event, EVENT_AUTH_PROMPT);
            responder.respond_auth(payload["requestId"].as_str().unwrap(), None);
        });
        let prompt = AuthPrompt {
            host: "h".into(),
            port: 22,
            username: "u".into(),
            name: String::new(),
            instructions: String::new(),
            prompts: vec![AuthPromptField {
                prompt: "Code:".into(),
                echo: true,
            }],
        };
        assert_eq!(prompter.auth(prompt).await, Ok(None));
    }

    #[tokio::test]
    async fn waiting_for_the_user_does_not_count_toward_the_timeout() {
        let clock = PauseClock::default();
        let slow_prompt = async {
            clock
                .pause(tokio::time::sleep(Duration::from_millis(300)))
                .await;
            tokio::time::sleep(Duration::from_millis(20)).await;
            "done"
        };
        assert_eq!(
            timeout_excluding_prompts(Duration::from_millis(100), &clock, slow_prompt).await,
            Some("done")
        );

        let clock = PauseClock::default();
        let started = Instant::now();
        let stuck = std::future::pending::<()>();
        assert!(
            timeout_excluding_prompts(Duration::from_millis(80), &clock, stuck)
                .await
                .is_none()
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
