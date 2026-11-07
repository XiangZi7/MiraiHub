//! 数据库专用 SSH 本地端口转发。
//!
//! 隧道跟着数据库会话走：配置克隆时共享同一个 `Arc`，最后一个持有者释放后
//! 监听任务被中止、SSH 会话断开。SSH 掉线不立即报错，下一条新 TCP 连接到来时
//! 先重连 SSH 再转发，配合连接池的 `test_before_acquire` 就是自动重连。

use std::fmt;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::ssh::models::SshConfig;
use crate::ssh::session::SshSession;

use super::error::{DatabaseError, DatabaseResult};

/// 同一条隧道上同时转发的 TCP 连接上限，与连接池上限（50）留出余量。
const MAX_FORWARDS: usize = 64;

static NEXT_TUNNEL: AtomicU64 = AtomicU64::new(1);

type SharedSession = Arc<Mutex<Option<Arc<SshSession>>>>;

pub struct DatabaseTunnel {
    local: SocketAddr,
    target_host: String,
    target_port: u16,
    via: String,
    session: SharedSession,
    task: JoinHandle<()>,
}

impl fmt::Debug for DatabaseTunnel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DatabaseTunnel")
            .field("local", &self.local)
            .field("target", &self.target())
            .field("via", &self.via)
            .finish()
    }
}

impl DatabaseTunnel {
    /// 先建立一次 SSH 连接，认证或网络问题在连接阶段就报给用户；
    /// 随后只监听本机回环的随机端口。
    pub async fn start(
        ssh: SshConfig,
        target_host: &str,
        target_port: u16,
    ) -> DatabaseResult<Arc<Self>> {
        let target_host = target_host.trim().to_owned();
        if target_host.is_empty() || target_port == 0 {
            return Err(DatabaseError::InvalidInput(
                "请填写有效的数据库主机和端口".to_owned(),
            ));
        }

        let via = ssh.endpoint();
        let first = open_session(&ssh).await?;
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .await
            .map_err(|error| DatabaseError::Tunnel(format!("无法监听本地端口：{error}")))?;
        let local = listener
            .local_addr()
            .map_err(|error| DatabaseError::Tunnel(error.to_string()))?;
        let session: SharedSession = Arc::new(Mutex::new(Some(first)));

        let task = tokio::spawn(serve(
            listener,
            ssh,
            session.clone(),
            target_host.clone(),
            target_port,
        ));
        log::info!("数据库 SSH 隧道已建立：{local} → {via} → {target_host}:{target_port}");

        Ok(Arc::new(Self {
            local,
            target_host,
            target_port,
            via,
            session,
            task,
        }))
    }

    pub fn local_port(&self) -> u16 {
        self.local.port()
    }

    pub fn target(&self) -> String {
        format!("{}:{}", self.target_host, self.target_port)
    }

    pub fn via(&self) -> &str {
        &self.via
    }
}

impl Drop for DatabaseTunnel {
    fn drop(&mut self) {
        self.task.abort();
        let session = self.session.clone();
        // Drop 里不能 await，断开放到后台；运行时已关闭时直接放弃即可。
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Some(session) = session.lock().await.take() {
                    let _ = session.disconnect().await;
                }
            });
        }
        log::info!("数据库 SSH 隧道已释放：{}", self.local);
    }
}

async fn open_session(ssh: &SshConfig) -> DatabaseResult<Arc<SshSession>> {
    let id = format!("db-tunnel-{}", NEXT_TUNNEL.fetch_add(1, Ordering::Relaxed));
    SshSession::connect(id, ssh.clone())
        .await
        .map(Arc::new)
        .map_err(|error| DatabaseError::Tunnel(error.to_string()))
}

/// 取一个可用的 SSH 会话；已断开时就地重连。持锁重连，避免并发连接各自重连一遍。
async fn live_session(ssh: &SshConfig, shared: &SharedSession) -> DatabaseResult<Arc<SshSession>> {
    let mut guard = shared.lock().await;
    if let Some(session) = guard.as_ref() {
        if !session.is_closed().await {
            return Ok(session.clone());
        }
        log::warn!("数据库 SSH 隧道已断开，正在重连 {}", ssh.endpoint());
    }
    let session = open_session(ssh).await?;
    *guard = Some(session.clone());
    Ok(session)
}

async fn serve(
    listener: TcpListener,
    ssh: SshConfig,
    shared: SharedSession,
    target_host: String,
    target_port: u16,
) {
    let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    loop {
        let (mut local, origin) = match listener.accept().await {
            Ok(pair) => pair,
            Err(error) => {
                log::warn!("数据库 SSH 隧道接受连接失败：{error}");
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
        };
        if active.load(Ordering::SeqCst) >= MAX_FORWARDS {
            log::warn!("数据库 SSH 隧道并发连接已达 {MAX_FORWARDS}，拒绝新连接");
            continue;
        }

        let ssh = ssh.clone();
        let shared = shared.clone();
        let host = target_host.clone();
        let active = active.clone();
        tokio::spawn(async move {
            active.fetch_add(1, Ordering::SeqCst);
            let forward = async {
                let session = live_session(&ssh, &shared).await?;
                let opened = tokio::time::timeout(
                    Duration::from_secs(ssh.timeout_secs.clamp(1, 60)),
                    session.forward_stream(&host, target_port, origin),
                )
                .await;
                match opened {
                    Ok(Ok(stream)) => Ok(stream),
                    Ok(Err(error)) => Err(DatabaseError::Tunnel(error.to_string())),
                    Err(_) => Err(DatabaseError::Tunnel("经 SSH 连接数据库超时".to_owned())),
                }
            };
            match forward.await {
                Ok(mut remote) => {
                    if let Err(error) = tokio::io::copy_bidirectional(&mut local, &mut remote).await
                    {
                        log::debug!("数据库隧道连接结束：{error}");
                    }
                }
                Err(error) => log::warn!("数据库隧道转发失败：{error}"),
            }
            active.fetch_sub(1, Ordering::SeqCst);
        });
    }
}
