//! Local TCP forwarding over an existing SSH connection. Never binds a public interface.
use super::{session::SshSession, SessionManager};
use crate::error::{AppError, AppResult};
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
    net::TcpListener,
    sync::{Mutex, Notify},
    task::JoinSet,
};
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForwardRequest {
    session_id: String,
    bind_host: String,
    bind_port: u16,
    target_host: String,
    target_port: u16,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tunnel {
    pub id: String,
    pub session_id: String,
    pub endpoint: String,
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
fn validate(request: &ForwardRequest) -> AppResult<SocketAddr> {
    let ip: IpAddr = request
        .bind_host
        .parse()
        .map_err(|_| AppError::invalid_input("监听地址只能是 127.0.0.1 或 ::1"))?;
    if !ip.is_loopback() {
        return Err(AppError::invalid_input("隧道仅允许监听本机回环地址"));
    }
    if request.target_host.is_empty()
        || request.target_host.len() > 253
        || request
            .target_host
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
        || request.target_port == 0
    {
        return Err(AppError::invalid_input("请填写有效的目标主机和端口"));
    }
    Ok(SocketAddr::new(ip, request.bind_port))
}
impl TunnelManager {
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
}
async fn serve(listener: TcpListener, session: Arc<SshSession>, c: Arc<Control>) {
    let mut children = JoinSet::new();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let (host, port) = {
        let v = c.view.lock().await;
        (v.target_host.clone(), v.target_port)
    };
    loop {
        if c.stop.load(Ordering::SeqCst) {
            break;
        }
        tokio::select! {
            _=c.notify.notified()=>break,
            _=tick.tick()=>{if session.is_closed().await {c.view.lock().await.error="SSH 已断开".into();break;}},
            _=children.join_next(), if !children.is_empty()=>{},
            accepted=listener.accept()=>{
                let (mut local,origin)=match accepted {Ok(pair)=>pair,Err(error)=>{c.view.lock().await.error=error.to_string();break;}};
                if children.len()>=32 {c.view.lock().await.error="并发连接已达 32 个，已拒绝新连接".into();continue;}
                let session=session.clone();let child=c.clone();let host=host.clone();
                children.spawn(async move {
                    child.active.fetch_add(1,Ordering::SeqCst);
                    let result=tokio::time::timeout(Duration::from_secs(15),session.forward_stream(&host,port,origin)).await;
                    match result {
                        Ok(Ok(mut remote))=>{ if let Err(error)=tokio::io::copy_bidirectional(&mut local,&mut remote).await {child.view.lock().await.error=format!("转发连接结束：{error}");} },
                        Ok(Err(error))=>child.view.lock().await.error=error.to_string(),
                        Err(_)=>child.view.lock().await.error="连接远端目标超时（15 秒）".into(),
                    }
                    child.active.fetch_sub(1,Ordering::SeqCst);
                });
            }
        }
    }
    children.abort_all();
    while children.join_next().await.is_some() {}
    c.active.store(0, Ordering::SeqCst);
    c.view.lock().await.status = "stopped".into();
}
#[tauri::command]
pub async fn ssh_tunnel_start(
    window: WebviewWindow,
    manager: State<'_, SessionManager>,
    tunnels: State<'_, TunnelManager>,
    request: ForwardRequest,
) -> AppResult<Tunnel> {
    main_window(&window)?;
    let address = validate(&request)?;
    let session = manager.get(&request.session_id).await?;
    if session.is_closed().await {
        return Err(AppError::invalid_input("SSH 已断开"));
    }
    let mut entries = tunnels.tunnels.lock().await;
    if entries.len() >= 64 {
        return Err(AppError::invalid_input("隧道记录过多，请先移除已停止记录"));
    }
    let listener = TcpListener::bind(address)
        .await
        .map_err(|error| AppError::invalid_input(format!("无法监听本地端口：{error}")))?;
    let address = listener.local_addr()?;
    let view = Tunnel {
        id: random_id(),
        session_id: request.session_id,
        endpoint: session.config().endpoint(),
        bind_host: address.ip().to_string(),
        bind_port: address.port(),
        target_host: request.target_host,
        target_port: request.target_port,
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
    entries.insert(view.id.clone(), c.clone());
    tauri::async_runtime::spawn(serve(listener, session, c));
    Ok(view)
}
#[tauri::command]
pub async fn ssh_tunnel_list(
    window: WebviewWindow,
    tunnels: State<'_, TunnelManager>,
) -> AppResult<Vec<Tunnel>> {
    main_window(&window)?;
    let mut rows = Vec::new();
    for c in tunnels.tunnels.lock().await.values() {
        let mut view = c.view.lock().await.clone();
        view.connections = c.active.load(Ordering::SeqCst);
        rows.push(view);
    }
    rows.sort_by(|a, b| a.bind_port.cmp(&b.bind_port));
    Ok(rows)
}
#[tauri::command]
pub async fn ssh_tunnel_stop(
    window: WebviewWindow,
    tunnels: State<'_, TunnelManager>,
    id: String,
) -> AppResult<()> {
    main_window(&window)?;
    let c = tunnels
        .tunnels
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| AppError::not_found("隧道不存在"))?;
    c.stop.store(true, Ordering::SeqCst);
    c.notify.notify_one();
    Ok(())
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
    fn request() -> ForwardRequest {
        ForwardRequest {
            session_id: "s".into(),
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
}
