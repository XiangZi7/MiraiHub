//! TCP forwarding over an existing SSH connection. Never binds a public interface.
//!
//! - 本地转发（-L）：本机回环端口 → direct-tcpip → 远端目标
//! - 远程转发（-R）：服务器回环端口 → forwarded-tcpip → 本机可达的目标
//! - 动态转发（-D）：本机回环端口上的 SOCKS5 服务，每个 CONNECT 走一条 direct-tcpip
use super::{session::SshSession, socks5, SessionManager};
use crate::error::{AppError, AppResult};
use russh::client::Msg;

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{State, WebviewWindow};
use tokio::{
    io::AsyncWriteExt,
    net::{TcpListener, TcpStream},
    sync::{mpsc, Mutex, Notify},
    task::JoinSet,
};

/// 服务器为远程转发打开的一条 forwarded-tcpip 通道，附带对端地址与端口。
pub type ForwardedChannel = (russh::Channel<Msg>, String, u32);

/// 远程转发（-R）的路由表：服务器监听的 (地址, 端口) → 对应隧道的通道接收队列。
///
/// 由 `SshSession` 与其最终一跳的 ClientHandler 共享；回调运行在 russh 的会话循环里，
/// 只做查表和非阻塞投递，不能在这里等待。
#[derive(Clone, Default)]
pub struct RemoteForwardRoutes(
    Arc<std::sync::Mutex<HashMap<(String, u32), mpsc::Sender<ForwardedChannel>>>>,
);

impl RemoteForwardRoutes {
    pub(crate) fn insert(&self, address: &str, port: u32, sender: mpsc::Sender<ForwardedChannel>) {
        if let Ok(mut routes) = self.0.lock() {
            routes.insert((address.to_owned(), port), sender);
        }
    }

    /// 仅在 (地址, 端口) 尚未登记时写入，返回是否写入成功；避免覆盖正在运行的隧道路由。
    pub(crate) fn try_insert(
        &self,
        address: &str,
        port: u32,
        sender: mpsc::Sender<ForwardedChannel>,
    ) -> bool {
        let Ok(mut routes) = self.0.lock() else {
            return false;
        };
        match routes.entry((address.to_owned(), port)) {
            std::collections::hash_map::Entry::Occupied(_) => false,
            std::collections::hash_map::Entry::Vacant(slot) => {
                slot.insert(sender);
                true
            }
        }
    }

    pub(crate) fn remove(&self, address: &str, port: u32) {
        if let Ok(mut routes) = self.0.lock() {
            routes.remove(&(address.to_owned(), port));
        }
    }

    /// 先按 (地址, 端口) 精确匹配；服务器回报的地址写法可能与请求不同（如 localhost / 127.0.0.1），
    /// 端口唯一时再退回只按端口匹配。
    fn route(&self, address: &str, port: u32) -> Option<mpsc::Sender<ForwardedChannel>> {
        let routes = self.0.lock().ok()?;
        if let Some(sender) = routes.get(&(address.to_owned(), port)) {
            return Some(sender.clone());
        }
        let mut matches = routes.iter().filter(|((_, p), _)| *p == port);
        match (matches.next(), matches.next()) {
            (Some((_, sender)), None) => Some(sender.clone()),
            _ => None,
        }
    }

    /// 把服务器打开的转发通道交给对应隧道；找不到路由或隧道已满时把通道原样退回，
    /// 由调用方用 `Session::close` 同步关闭。
    ///
    /// 不能在这里 `channel.close().await`：它要写入会话循环自己的消息队列，
    /// 队列满时会话循环正卡在本回调里，会形成死锁。
    pub(crate) fn dispatch(
        &self,
        channel: russh::Channel<Msg>,
        address: &str,
        port: u32,
        originator: (&str, u32),
    ) -> Option<russh::Channel<Msg>> {
        let Some(sender) = self.route(address, port) else {
            log::warn!("收到未登记的远程转发连接 {address}:{port}，已拒绝");
            return Some(channel);
        };
        match sender.try_send((channel, originator.0.to_owned(), originator.1)) {
            Ok(()) => None,
            Err(error) => Some(error.into_inner().0),
        }
    }
}

/// 在会话循环之外关闭一条尚未转换成流的通道：转成流后丢弃，由 russh 异步发送 CLOSE。
/// 裸 `Channel` 被直接丢弃时不会通知服务器，远端会一直保留这条通道。
fn close_detached(channel: russh::Channel<Msg>) {
    drop(channel.into_stream());
}
/// 每条隧道的并发连接上限
const MAX_CONNECTIONS: usize = 32;
/// 远程转发时服务器允许监听的地址：只开放服务器自身的回环接口
const REMOTE_BIND_HOSTS: [&str; 3] = ["127.0.0.1", "::1", "localhost"];

/// 转发类型。旧版请求不带此字段，按本地转发处理。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelKind {
    #[default]
    Local,
    Remote,
    Dynamic,
}

/// 建立隧道的请求。各类型下字段含义：
/// - local：bind 为本机监听地址，target 为 SSH 服务器访问的目标
/// - remote：bind 为服务器监听地址，target 为本机访问的目标
/// - dynamic：只用 bind，target 忽略
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForwardRequest {
    session_id: String,
    #[serde(default)]
    kind: TunnelKind,
    bind_host: String,
    bind_port: u16,
    #[serde(default)]
    target_host: String,
    #[serde(default)]
    target_port: u16,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tunnel {
    pub id: String,
    pub session_id: String,
    pub endpoint: String,
    pub kind: TunnelKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub status: String,
    pub error: String,
    pub connections: usize,
}
struct Control {
    view: Mutex<Tunnel>,
    stop: AtomicBool,
    notify: Notify,
    active: AtomicUsize,
}
#[derive(Default)]
pub struct TunnelManager {
    tunnels: Mutex<HashMap<String, Arc<Control>>>,
}
pub(crate) fn main_window(window: &WebviewWindow) -> AppResult<()> {
    if window.label() != "main" {
        Err(AppError::invalid_input("仅主工作区可以执行此操作"))
    } else {
        Ok(())
    }
}
pub(crate) fn random_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|v| format!("{v:02x}")).collect()
}
fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.chars().any(|c| c.is_whitespace() || c.is_control())
}
/// 校验请求；本地与动态转发返回本机监听地址，远程转发由服务器监听，返回 None。
fn validate(request: &ForwardRequest) -> AppResult<Option<SocketAddr>> {
    if request.kind == TunnelKind::Remote {
        if !REMOTE_BIND_HOSTS.contains(&request.bind_host.as_str()) {
            return Err(AppError::invalid_input(
                "远程转发仅允许监听服务器回环地址（127.0.0.1、::1 或 localhost）",
            ));
        }
    } else {
        let ip: IpAddr = request
            .bind_host
            .parse()
            .map_err(|_| AppError::invalid_input("监听地址只能是 127.0.0.1 或 ::1"))?;
        if !ip.is_loopback() {
            return Err(AppError::invalid_input("隧道仅允许监听本机回环地址"));
        }
    }
    if request.kind != TunnelKind::Dynamic
        && (!valid_host(&request.target_host) || request.target_port == 0)
    {
        return Err(AppError::invalid_input("请填写有效的目标主机和端口"));
    }
    Ok(match request.kind {
        TunnelKind::Remote => None,
        _ => Some(SocketAddr::new(
            request.bind_host.parse().expect("已校验"),
            request.bind_port,
        )),
    })
}

/// 隧道的连接来源：本机监听端口，或服务器转来的 forwarded-tcpip 通道。
enum Source {
    Listener(TcpListener),
    Forwarded(mpsc::Receiver<ForwardedChannel>),
}
enum Incoming {
    Local(TcpStream, SocketAddr),
    Forwarded(ForwardedChannel),
}
impl Source {
    /// 两种来源的等待都可安全取消，可直接放进 select!。
    async fn next(&mut self) -> Result<Incoming, String> {
        match self {
            Self::Listener(listener) => listener
                .accept()
                .await
                .map(|(stream, origin)| Incoming::Local(stream, origin))
                .map_err(|error| error.to_string()),
            Self::Forwarded(receiver) => receiver
                .recv()
                .await
                .map(Incoming::Forwarded)
                .ok_or_else(|| "远程转发已被撤销".to_string()),
        }
    }
}
/// 拒绝超出并发上限的连接：本地连接直接丢弃，远程通道需显式关闭。
fn reject(incoming: Incoming) {
    if let Incoming::Forwarded((channel, ..)) = incoming {
        close_detached(channel);
    }
}
/// 把 direct-tcpip 打开失败映射成 SOCKS5 应答码。
fn socks_reply_for(error: &super::error::SshError) -> u8 {
    use russh::ChannelOpenFailure as F;
    match error {
        super::error::SshError::Protocol(russh::Error::ChannelOpenFailure(reason)) => {
            match reason {
                F::AdministrativelyProhibited => socks5::REPLY_NOT_ALLOWED,
                F::ConnectFailed => socks5::REPLY_CONNECTION_REFUSED,
                _ => socks5::REPLY_GENERAL_FAILURE,
            }
        }
        _ => socks5::REPLY_GENERAL_FAILURE,
    }
}
/// 处理单条连接，返回的错误写到隧道的 error 字段。
async fn relay(
    incoming: Incoming,
    session: &SshSession,
    kind: TunnelKind,
    host: &str,
    port: u16,
) -> Result<(), String> {
    let finished = |result: std::io::Result<(u64, u64)>| {
        result
            .map(|_| ())
            .map_err(|error| format!("转发连接结束：{error}"))
    };
    match incoming {
        Incoming::Local(mut local, origin) if kind == TunnelKind::Dynamic => {
            let (target, early) =
                tokio::time::timeout(Duration::from_secs(10), socks5::accept(&mut local))
                    .await
                    .map_err(|_| "SOCKS 握手超时（10 秒）".to_string())?
                    .map_err(|error| error.to_string())?;
            let opened = tokio::time::timeout(
                Duration::from_secs(15),
                session.forward_stream(&target.host, target.port, origin),
            )
            .await;
            let mut remote = match opened {
                Ok(Ok(remote)) => remote,
                Ok(Err(error)) => {
                    let _ = local.write_all(&socks5::reply(socks_reply_for(&error))).await;
                    return Err(format!("{}:{}：{error}", target.host, target.port));
                }
                Err(_) => {
                    let _ = local
                        .write_all(&socks5::reply(socks5::REPLY_HOST_UNREACHABLE))
                        .await;
                    return Err(format!(
                        "连接 {}:{} 超时（15 秒）",
                        target.host, target.port
                    ));
                }
            };
            local
                .write_all(&socks5::reply(socks5::REPLY_SUCCEEDED))
                .await
                .map_err(|error| error.to_string())?;
            if !early.is_empty() {
                remote
                    .write_all(&early)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            finished(tokio::io::copy_bidirectional(&mut local, &mut remote).await)
        }
        Incoming::Local(mut local, origin) => {
            let mut remote = tokio::time::timeout(
                Duration::from_secs(15),
                session.forward_stream(host, port, origin),
            )
            .await
            .map_err(|_| "连接远端目标超时（15 秒）".to_string())?
            .map_err(|error| error.to_string())?;
            finished(tokio::io::copy_bidirectional(&mut local, &mut remote).await)
        }
        Incoming::Forwarded((channel, ..)) => {
            // 先转成流：连接失败返回或隧道停止中止任务时，丢弃流即会通知服务器关闭通道
            let mut remote = channel.into_stream();
            let mut target =
                tokio::time::timeout(Duration::from_secs(15), TcpStream::connect((host, port)))
                    .await
                    .map_err(|_| "连接本地目标超时（15 秒）".to_string())?
                    .map_err(|error| format!("连接本地目标 {host}:{port} 失败：{error}"))?;
            finished(tokio::io::copy_bidirectional(&mut remote, &mut target).await)
        }
    }
}
async fn serve(mut source: Source, session: Arc<SshSession>, c: Arc<Control>) {
    let mut children = JoinSet::new();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let (kind, host, port) = {
        let v = c.view.lock().await;
        (v.kind, v.target_host.clone(), v.target_port)
    };
    loop {
        if c.stop.load(Ordering::SeqCst) {
            break;
        }
        tokio::select! {
            _ = c.notify.notified() => break,
            _ = tick.tick() => {
                if session.is_closed().await {
                    c.view.lock().await.error = "SSH 已断开".into();
                    break;
                }
            },
            _ = children.join_next(), if !children.is_empty() => {},
            incoming = source.next() => {
                let incoming = match incoming {
                    Ok(incoming) => incoming,
                    Err(error) => {
                        c.view.lock().await.error = error;
                        break;
                    }
                };
                if children.len() >= MAX_CONNECTIONS {
                    c.view.lock().await.error = "并发连接已达 32 个，已拒绝新连接".into();
                    reject(incoming);
                    continue;
                }
                let session = session.clone();
                let child = c.clone();
                let host = host.clone();
                children.spawn(async move {
                    child.active.fetch_add(1, Ordering::SeqCst);
                    if let Err(error) = relay(incoming, &session, kind, &host, port).await {
                        child.view.lock().await.error = error;
                    }
                    child.active.fetch_sub(1, Ordering::SeqCst);
                });
            }
        }
    }
    children.abort_all();
    while children.join_next().await.is_some() {}
    if kind == TunnelKind::Remote {
        // 停止时让服务器释放监听端口；会话已断开时无需撤销
        let (bind_host, bind_port) = {
            let v = c.view.lock().await;
            (v.bind_host.clone(), v.bind_port)
        };
        let cancel = session.cancel_remote_forward(&bind_host, bind_port);
        match tokio::time::timeout(Duration::from_secs(5), cancel).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => log::warn!("撤销远程转发 {bind_host}:{bind_port} 失败：{error}"),
            Err(_) => log::warn!("撤销远程转发 {bind_host}:{bind_port} 超时"),
        }
    }
    // 路由已摘除：关闭队列里还没来得及处理的转发通道，避免远端残留
    if let Source::Forwarded(mut receiver) = source {
        receiver.close();
        while let Ok((channel, ..)) = receiver.try_recv() {
            close_detached(channel);
        }
    }
    c.active.store(0, Ordering::SeqCst);
    c.view.lock().await.status = "stopped".into();
}
impl TunnelManager {
    /// 读取隧道列表，Agent 与工作区列表共用同一份状态快照。
    pub async fn snapshot(&self) -> Vec<Tunnel> {
        let mut rows = Vec::new();
        for control in self.tunnels.lock().await.values() {
            let mut row = control.view.lock().await.clone();
            row.connections = control.active.load(Ordering::SeqCst);
            rows.push(row);
        }
        rows.sort_by_key(|row| row.bind_port);
        rows
    }

    pub async fn stop_session(&self, id: &str) {
        for c in self.tunnels.lock().await.values() {
            if c.view.lock().await.session_id == id {
                c.stop.store(true, Ordering::SeqCst);
                c.notify.notify_one();
            }
        }
    }
    pub async fn shutdown(&self) {
        for c in self.tunnels.lock().await.values() {
            c.stop.store(true, Ordering::SeqCst);
            c.notify.notify_one();
        }
    }

    /// 在已连接的会话上建立隧道。远程转发需要等服务器应答，期间不持有隧道表的锁。
    async fn start(&self, session: Arc<SshSession>, request: ForwardRequest) -> AppResult<Tunnel> {
        let address = validate(&request)?;
        if session.is_closed().await {
            return Err(AppError::invalid_input("SSH 已断开"));
        }
        if self.tunnels.lock().await.len() >= 64 {
            return Err(AppError::invalid_input("隧道记录过多，请先移除已停止记录"));
        }
        let (source, bind_host, bind_port) = match address {
            Some(address) => {
                let listener = TcpListener::bind(address)
                    .await
                    .map_err(|error| AppError::invalid_input(format!("无法监听本地端口：{error}")))?;
                let address = listener.local_addr()?;
                (
                    Source::Listener(listener),
                    address.ip().to_string(),
                    address.port(),
                )
            }
            None => {
                let (sender, receiver) = mpsc::channel(MAX_CONNECTIONS);
                let forward = session.remote_forward(&request.bind_host, request.bind_port, sender);
                let port = match tokio::time::timeout(Duration::from_secs(15), forward).await {
                    Ok(result) => result?,
                    Err(_) => {
                        // 超时丢弃 future 不会走 remote_forward 的失败清理：摘掉预先登记的路由，
                        // 并尽力让服务器撤销可能已建立的监听（端口 0 时无从得知分配端口，只能等会话结束）
                        if request.bind_port != 0 {
                            let cancel =
                                session.cancel_remote_forward(&request.bind_host, request.bind_port);
                            if let Ok(Err(error)) =
                                tokio::time::timeout(Duration::from_secs(5), cancel).await
                            {
                                log::warn!("撤销超时的远程转发失败：{error}");
                            }
                        }
                        return Err(AppError::invalid_input("等待服务器应答远程转发超时（15 秒）"));
                    }
                };
                (Source::Forwarded(receiver), request.bind_host.clone(), port)
            }
        };
        let dynamic = request.kind == TunnelKind::Dynamic;
        let view = Tunnel {
            id: random_id(),
            session_id: request.session_id,
            endpoint: session.config().endpoint(),
            kind: request.kind,
            bind_host,
            bind_port,
            target_host: if dynamic {
                String::new()
            } else {
                request.target_host
            },
            target_port: if dynamic { 0 } else { request.target_port },
            status: "running".into(),
            error: String::new(),
            connections: 0,
        };
        let c = Arc::new(Control {
            view: Mutex::new(view.clone()),
            stop: AtomicBool::new(false),
            notify: Notify::new(),
            active: AtomicUsize::new(0),
        });
        self.tunnels.lock().await.insert(view.id.clone(), c.clone());
        tauri::async_runtime::spawn(serve(source, session, c));
        Ok(view)
    }

    async fn stop(&self, id: &str) -> AppResult<()> {
        let c = self
            .tunnels
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::not_found("隧道不存在"))?;
        c.stop.store(true, Ordering::SeqCst);
        c.notify.notify_one();
        Ok(())
    }
}
#[tauri::command]
pub async fn ssh_tunnel_start(
    window: WebviewWindow,
    manager: State<'_, SessionManager>,
    tunnels: State<'_, TunnelManager>,
    request: ForwardRequest,
) -> AppResult<Tunnel> {
    main_window(&window)?;
    validate(&request)?;
    let session = manager.get(&request.session_id).await?;
    tunnels.start(session, request).await
}
#[tauri::command]
pub async fn ssh_tunnel_list(
    window: WebviewWindow,
    tunnels: State<'_, TunnelManager>,
) -> AppResult<Vec<Tunnel>> {
    main_window(&window)?;
    Ok(tunnels.snapshot().await)
}
#[tauri::command]
pub async fn ssh_tunnel_stop(
    window: WebviewWindow,
    tunnels: State<'_, TunnelManager>,
    id: String,
) -> AppResult<()> {
    main_window(&window)?;
    tunnels.stop(&id).await
}
#[tauri::command]
pub async fn ssh_tunnel_remove(
    window: WebviewWindow,
    tunnels: State<'_, TunnelManager>,
    id: String,
) -> AppResult<()> {
    main_window(&window)?;
    let mut entries = tunnels.tunnels.lock().await;
    if let Some(c) = entries.get(&id) {
        if c.view.lock().await.status == "running" {
            return Err(AppError::invalid_input("请先停止隧道"));
        }
    }
    entries.remove(&id);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    fn request() -> ForwardRequest {
        ForwardRequest {
            session_id: "s".into(),
            kind: TunnelKind::Local,
            bind_host: "127.0.0.1".into(),
            bind_port: 0,
            target_host: "127.0.0.1".into(),
            target_port: 3306,
        }
    }
    #[test]
    fn forwarding_is_loopback_only() {
        assert!(validate(&request()).is_ok());
        for host in ["0.0.0.0", "::", "192.168.1.1", "example.com"] {
            let mut r = request();
            r.bind_host = host.into();
            assert!(validate(&r).is_err());
        }
    }
    #[test]
    fn invalid_destination_is_rejected() {
        let mut r = request();
        r.target_port = 0;
        assert!(validate(&r).is_err());
        r.target_port = 22;
        r.target_host = "host\nother".into();
        assert!(validate(&r).is_err());
    }
    #[test]
    fn kind_defaults_to_local_for_old_requests() {
        let old: ForwardRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "s", "bindHost": "127.0.0.1", "bindPort": 0,
            "targetHost": "db", "targetPort": 5432
        }))
        .unwrap();
        assert_eq!(old.kind, TunnelKind::Local);
        let dynamic: ForwardRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "s", "kind": "dynamic", "bindHost": "127.0.0.1", "bindPort": 1080
        }))
        .unwrap();
        assert_eq!(dynamic.kind, TunnelKind::Dynamic);
        assert!(validate(&dynamic).unwrap().is_some());
    }
    #[test]
    fn remote_forwarding_binds_server_loopback_only() {
        let mut r = request();
        r.kind = TunnelKind::Remote;
        for host in ["127.0.0.1", "::1", "localhost"] {
            r.bind_host = host.into();
            assert!(matches!(validate(&r), Ok(None)));
        }
        for host in ["0.0.0.0", "", "*", "10.0.0.1"] {
            r.bind_host = host.into();
            assert!(validate(&r).is_err());
        }
        r.bind_host = "localhost".into();
        r.target_host = String::new();
        assert!(validate(&r).is_err());
    }

    /// 支持 direct-tcpip 与 tcpip-forward 的临时 SSH 服务，只监听本机回环地址。
    #[derive(Default)]
    struct ForwardTestServer {
        listeners: HashMap<u32, tokio::task::JoinHandle<()>>,
    }
    impl russh::server::Handler for ForwardTestServer {
        type Error = russh::Error;
        async fn auth_password(
            &mut self,
            _: &str,
            _: &str,
        ) -> Result<russh::server::Auth, Self::Error> {
            Ok(russh::server::Auth::Accept)
        }
        async fn channel_open_direct_tcpip(
            &mut self,
            channel: russh::Channel<russh::server::Msg>,
            host: &str,
            port: u32,
            _: &str,
            _: u32,
            _: &mut russh::server::Session,
        ) -> Result<bool, Self::Error> {
            let Ok(mut stream) = TcpStream::connect((host, port as u16)).await else {
                return Ok(false);
            };
            tokio::spawn(async move {
                let _ =
                    tokio::io::copy_bidirectional(&mut channel.into_stream(), &mut stream).await;
            });
            Ok(true)
        }
        async fn tcpip_forward(
            &mut self,
            address: &str,
            port: &mut u32,
            session: &mut russh::server::Session,
        ) -> Result<bool, Self::Error> {
            let Ok(listener) = TcpListener::bind((address, *port as u16)).await else {
                return Ok(false);
            };
            *port = listener.local_addr().unwrap().port() as u32;
            let (handle, address, bound) = (session.handle(), address.to_owned(), *port);
            let task = tokio::spawn(async move {
                while let Ok((mut stream, peer)) = listener.accept().await {
                    let opened = handle
                        .channel_open_forwarded_tcpip(
                            address.clone(),
                            bound,
                            peer.ip().to_string(),
                            peer.port() as u32,
                        )
                        .await;
                    let Ok(channel) = opened else { continue };
                    tokio::spawn(async move {
                        let _ = tokio::io::copy_bidirectional(
                            &mut channel.into_stream(),
                            &mut stream,
                        )
                        .await;
                    });
                }
            });
            self.listeners.insert(bound, task);
            Ok(true)
        }
        async fn cancel_tcpip_forward(
            &mut self,
            _: &str,
            port: u32,
            _: &mut russh::server::Session,
        ) -> Result<bool, Self::Error> {
            Ok(self.listeners.remove(&port).map(|task| task.abort()).is_some())
        }
    }
    async fn forward_test_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let config = Arc::new(russh::server::Config {
            keys: vec![russh::keys::PrivateKey::random(
                &mut rand::rngs::OsRng,
                russh::keys::Algorithm::Ed25519,
            )
            .unwrap()],
            ..Default::default()
        });
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let config = config.clone();
                tokio::spawn(async move {
                    if let Ok(session) = russh::server::run_stream(
                        config,
                        stream,
                        ForwardTestServer::default(),
                    )
                    .await
                    {
                        let _ = session.await;
                    }
                });
            }
        });
        port
    }
    /// 回显服务，作为各类转发的最终目标。
    async fn echo_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let (mut read, mut write) = stream.split();
                    let _ = tokio::io::copy(&mut read, &mut write).await;
                });
            }
        });
        port
    }
    async fn connected_session() -> Arc<SshSession> {
        let port = forward_test_server().await;
        let config = super::super::models::SshConfig {
            jump_hosts: Vec::new(),
            host: "127.0.0.1".into(),
            port,
            username: "test".into(),
            auth: super::super::models::AuthMethod::Password {
                password: "test".into(),
            },
            timeout_secs: 5,
            keepalive_secs: 0,
            verify_host_key: false,
            proxy: None,
        };
        Arc::new(SshSession::connect("tunnel-test".into(), config).await.unwrap())
    }
    async fn assert_echo(stream: &mut TcpStream) {
        stream.write_all(b"ping").await.unwrap();
        let mut answer = [0u8; 4];
        tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut answer))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&answer, b"ping");
    }
    async fn socks_connect(proxy: u16, port: u16) -> (TcpStream, u8) {
        let mut stream = TcpStream::connect(("127.0.0.1", proxy)).await.unwrap();
        stream.write_all(&[5, 1, 0]).await.unwrap();
        let mut method = [0u8; 2];
        stream.read_exact(&mut method).await.unwrap();
        assert_eq!(method, [5, 0]);
        let mut connect = vec![5, 1, 0, 1, 127, 0, 0, 1];
        connect.extend_from_slice(&port.to_be_bytes());
        stream.write_all(&connect).await.unwrap();
        let mut reply = [0u8; 10];
        tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut reply))
            .await
            .unwrap()
            .unwrap();
        (stream, reply[1])
    }
    async fn wait_stopped(manager: &TunnelManager, id: &str) {
        for _ in 0..50 {
            if manager.snapshot().await.iter().any(|t| t.id == id && t.status == "stopped") {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("隧道未停止");
    }

    #[tokio::test]
    async fn dynamic_forwarding_speaks_socks5_over_direct_tcpip() {
        let echo = echo_server().await;
        let session = connected_session().await;
        let manager = TunnelManager::default();
        let mut r = request();
        r.kind = TunnelKind::Dynamic;
        r.target_host = String::new();
        r.target_port = 0;
        let tunnel = manager.start(session.clone(), r).await.unwrap();
        assert_eq!(tunnel.kind, TunnelKind::Dynamic);
        assert!(tunnel.target_host.is_empty());

        let (mut stream, code) = socks_connect(tunnel.bind_port, echo).await;
        assert_eq!(code, socks5::REPLY_SUCCEEDED);
        assert_echo(&mut stream).await;
        assert_eq!(manager.snapshot().await[0].connections, 1);

        // 服务器连不上目标时回复失败码，而不是直接断开
        let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);
        let (_, code) = socks_connect(tunnel.bind_port, closed_port).await;
        assert_ne!(code, socks5::REPLY_SUCCEEDED);

        manager.stop(&tunnel.id).await.unwrap();
        wait_stopped(&manager, &tunnel.id).await;
        session.disconnect().await.unwrap();
    }

    #[tokio::test]
    async fn remote_forwarding_routes_server_connections_to_local_target() {
        let echo = echo_server().await;
        let session = connected_session().await;
        let manager = TunnelManager::default();
        let mut r = request();
        r.kind = TunnelKind::Remote;
        r.target_port = echo;
        let tunnel = manager.start(session.clone(), r).await.unwrap();
        assert_eq!(tunnel.kind, TunnelKind::Remote);
        assert_ne!(tunnel.bind_port, 0, "端口 0 应由服务器分配");

        let mut stream = TcpStream::connect(("127.0.0.1", tunnel.bind_port))
            .await
            .unwrap();
        assert_echo(&mut stream).await;
        drop(stream);

        manager.stop(&tunnel.id).await.unwrap();
        wait_stopped(&manager, &tunnel.id).await;
        // 撤销后服务器不再监听该端口
        let mut refused = false;
        for _ in 0..50 {
            if TcpStream::connect(("127.0.0.1", tunnel.bind_port)).await.is_err() {
                refused = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(refused);
        session.disconnect().await.unwrap();
    }

    #[tokio::test]
    async fn local_forwarding_still_works() {
        let echo = echo_server().await;
        let session = connected_session().await;
        let manager = TunnelManager::default();
        let mut r = request();
        r.target_port = echo;
        let tunnel = manager.start(session.clone(), r).await.unwrap();
        assert_eq!(tunnel.kind, TunnelKind::Local);
        let mut stream = TcpStream::connect(("127.0.0.1", tunnel.bind_port))
            .await
            .unwrap();
        assert_echo(&mut stream).await;
        manager.stop(&tunnel.id).await.unwrap();
        wait_stopped(&manager, &tunnel.id).await;
        session.disconnect().await.unwrap();
    }
}
