//! 会话注册表：持有所有活跃会话，按 id 寻址。
//!
//! 作为 Tauri 的托管状态注入，命令层通过它拿到具体会话。
//! 后续数据库模块会有一个结构相同的连接池，两者互不耦合。

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use super::error::{SshError, SshResult};
use super::models::{SessionInfo, SessionStatus, SshConfig};
use super::session::SshSession;

/// 全局会话管理器。
///
/// 用 RwLock 而非 Mutex：列表查询远多于增删，
/// 且查询期间不该挡住其他会话的读操作。
#[derive(Default)]
pub struct SessionManager {
    sessions: RwLock<HashMap<String, SessionEntry>>,
}

struct SessionEntry {
    session: Arc<SshSession>,
    connected_at: i64,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 建立新会话并登记，返回会话 id。
    pub async fn connect(&self, config: SshConfig) -> SshResult<String> {
        let id = new_session_id();
        let session = SshSession::connect(id.clone(), config).await?;

        let entry = SessionEntry {
            session: Arc::new(session),
            connected_at: now_millis(),
        };

        self.sessions.write().await.insert(id.clone(), entry);

        Ok(id)
    }

    /// 按 id 取会话。
    ///
    /// 返回 Arc 而不是持有读锁的引用：调用方常要 await 会话上的异步操作，
    /// 握着锁 await 会把整张表卡住，别的会话连列表都查不了。
    pub async fn get(&self, id: &str) -> SshResult<Arc<SshSession>> {
        self.sessions
            .read()
            .await
            .get(id)
            .map(|entry| Arc::clone(&entry.session))
            .ok_or_else(|| SshError::SessionNotFound(id.to_owned()))
    }

    /// 断开并移除会话。
    pub async fn disconnect(&self, id: &str) -> SshResult<()> {
        let entry = self.sessions.write().await.remove(id);

        match entry {
            Some(entry) => {
                // 已经移出表了，断开失败也只记日志：
                // 对调用方而言"这个会话没了"这个结果已经达成
                if let Err(err) = entry.session.disconnect().await {
                    log::warn!("断开会话 {id} 时出错：{err}");
                }
                Ok(())
            }
            None => Err(SshError::SessionNotFound(id.to_owned())),
        }
    }

    /// 列出所有活跃会话。
    pub async fn list(&self) -> Vec<SessionInfo> {
        let sessions: Vec<_> = self
            .sessions
            .read()
            .await
            .values()
            .map(|entry| (entry.session.clone(), entry.connected_at))
            .collect();
        let mut result = Vec::new();
        for (session, connected_at) in sessions {
            if session.is_closed().await {
                continue;
            }
            let config = session.config();
            result.push(SessionInfo {
                id: session.id().to_owned(),
                host: config.host.clone(),
                port: config.port,
                username: config.username.clone(),
                status: SessionStatus::Connected,
                connected_at,
            });
        }
        result.sort_by_key(|session| session.connected_at);
        result
    }

    /// 断开全部会话。应用退出时调用，给远端一个干净的 disconnect。
    pub async fn shutdown(&self) {
        let entries: Vec<_> = self.sessions.write().await.drain().collect();

        for (id, entry) in entries {
            if let Err(err) = entry.session.disconnect().await {
                log::warn!("退出时断开会话 {id} 失败：{err}");
            }
        }
    }
}

/// 生成会话 id。
///
/// 用「毫秒时间戳 + 进程内自增序号」而不是引入 uuid 依赖：
/// id 只需在本进程内唯一，自增序号已经保证了这一点，
/// 时间戳前缀则让日志里的 id 天然按时间有序，排查问题时好读。
fn new_session_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);

    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("ssh-{}-{seq}", now_millis())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_are_unique() {
        let a = new_session_id();
        let b = new_session_id();
        assert_ne!(a, b);
        assert!(a.starts_with("ssh-"));
    }

    #[tokio::test]
    async fn get_missing_session_reports_not_found() {
        let manager = SessionManager::new();

        // 用 match 而不是 unwrap_err()：后者要求 Ok 分支实现 Debug，
        // 而 SshSession 里握着连接句柄，不该为了一行测试给它派生 Debug
        match manager.get("nope").await {
            Err(SshError::SessionNotFound(id)) => assert_eq!(id, "nope"),
            Err(other) => panic!("期望 SessionNotFound，实际是 {other}"),
            Ok(_) => panic!("空管理器不该返回会话"),
        }
    }
}
