//! 连接存活状态：russh 后台任务结束时给出信号与可读的断开原因，
//! 会话表据此清理死会话并通知前端。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use russh::client::DisconnectReason;
use tokio::sync::watch;

/// 一条 SSH 传输连接的生命周期状态，由 ClientHandler 与会话共享。
pub struct LinkState {
    closed: watch::Sender<bool>,
    /// 断开原因，只保留第一次写入的（最接近根因）
    reason: Mutex<Option<String>>,
    /// 用户拒绝主机密钥 / 取消二次验证时的说明，用来替换 russh 的笼统报错
    declined: Mutex<Option<String>>,
    /// 用户主动断开：不再当作异常断线上报
    manual: AtomicBool,
}

impl Default for LinkState {
    fn default() -> Self {
        Self {
            closed: watch::channel(false).0,
            reason: Mutex::new(None),
            declined: Mutex::new(None),
            manual: AtomicBool::new(false),
        }
    }
}

impl LinkState {
    pub fn set_reason(&self, reason: impl Into<String>) {
        let mut slot = self.reason.lock().unwrap_or_else(|p| p.into_inner());
        if slot.is_none() {
            *slot = Some(reason.into());
        }
    }

    pub fn reason(&self) -> String {
        self.reason
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
            .unwrap_or_else(|| "连接已断开".into())
    }

    pub fn decline(&self, reason: impl Into<String>) {
        *self.declined.lock().unwrap_or_else(|p| p.into_inner()) = Some(reason.into());
    }

    pub fn take_declined(&self) -> Option<String> {
        self.declined.lock().unwrap_or_else(|p| p.into_inner()).take()
    }

    pub fn mark_manual(&self) {
        self.manual.store(true, Ordering::SeqCst);
    }

    pub fn is_manual(&self) -> bool {
        self.manual.load(Ordering::SeqCst)
    }

    pub fn mark_closed(&self) {
        self.closed.send_replace(true);
    }

    pub fn is_closed(&self) -> bool {
        *self.closed.borrow()
    }

    /// 等到连接结束。
    pub async fn closed(&self) {
        let mut receiver = self.closed.subscribe();
        let _ = receiver.wait_for(|closed| *closed).await;
    }

    /// 最多等 `limit`，返回连接是否已结束。
    pub async fn wait_closed(&self, limit: Duration) -> bool {
        tokio::time::timeout(limit, self.closed()).await.is_ok()
    }
}

/// 把 russh 的断开原因翻成用户能看懂的一句话。
pub fn describe(reason: &DisconnectReason<russh::Error>) -> String {
    match reason {
        DisconnectReason::ReceivedDisconnect(info) => {
            let title = match info.reason_code {
                russh::Disconnect::NoMoreAuthMethodsAvailable
                | russh::Disconnect::AuthCancelledByUser
                | russh::Disconnect::IllegalUserName => "认证失败",
                _ => "远端关闭连接",
            };
            let message = info.message.trim();
            if message.is_empty() {
                title.into()
            } else {
                format!("{title}：{message}")
            }
        }
        DisconnectReason::Error(error) => describe_error(error),
    }
}

fn describe_error(error: &russh::Error) -> String {
    match error {
        russh::Error::KeepaliveTimeout => "网络超时：心跳无响应".into(),
        russh::Error::InactivityTimeout
        | russh::Error::ConnectionTimeout
        | russh::Error::Elapsed(_) => "网络超时".into(),
        // 对端直接关掉 TCP（没发 SSH_MSG_DISCONNECT）时 russh 报的就是 Disconnect
        russh::Error::HUP | russh::Error::Disconnect => "远端关闭连接".into(),
        russh::Error::IO(io) => match io.kind() {
            std::io::ErrorKind::UnexpectedEof => "远端关闭连接".into(),
            std::io::ErrorKind::TimedOut => "网络超时".into(),
            _ => format!("网络错误：{io}"),
        },
        russh::Error::NotAuthenticated | russh::Error::NoAuthMethod => "认证失败".into(),
        other => format!("连接异常：{other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_reasons() {
        assert_eq!(
            describe(&DisconnectReason::Error(russh::Error::KeepaliveTimeout)),
            "网络超时：心跳无响应"
        );
        assert_eq!(
            describe(&DisconnectReason::Error(russh::Error::HUP)),
            "远端关闭连接"
        );
        let info = russh::client::RemoteDisconnectInfo {
            reason_code: russh::Disconnect::ByApplication,
            message: "bye".into(),
            lang_tag: String::new(),
        };
        assert_eq!(
            describe(&DisconnectReason::ReceivedDisconnect(info)),
            "远端关闭连接：bye"
        );
        let info = russh::client::RemoteDisconnectInfo {
            reason_code: russh::Disconnect::NoMoreAuthMethodsAvailable,
            message: String::new(),
            lang_tag: String::new(),
        };
        assert_eq!(describe(&DisconnectReason::ReceivedDisconnect(info)), "认证失败");
    }

    #[test]
    fn first_reason_wins() {
        let link = LinkState::default();
        assert_eq!(link.reason(), "连接已断开");
        link.set_reason("网络超时");
        link.set_reason("连接已断开");
        assert_eq!(link.reason(), "网络超时");
    }

    #[tokio::test]
    async fn closed_signal_wakes_waiters() {
        let link = std::sync::Arc::new(LinkState::default());
        assert!(!link.wait_closed(Duration::from_millis(10)).await);
        let waiter = {
            let link = link.clone();
            tokio::spawn(async move { link.closed().await })
        };
        link.mark_closed();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        assert!(link.is_closed());
        assert!(link.wait_closed(Duration::from_millis(10)).await);
    }
}
