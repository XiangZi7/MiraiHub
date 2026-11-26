use std::{
    fmt::Display,
    sync::{Arc, OnceLock},
    time::Duration,
};

use hyper::{client::conn::http1, Request};
use hyper_util::rt::TokioIo;
use reqwest::{Client, Method, Response, StatusCode, Url};
use serde::Deserialize;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::task::JoinSet;

use crate::error::{AppError, AppResult};
use crate::ssh::{session::SshSession, SessionManager};

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Unix,
    Npipe,
    Http,
    Https,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    Direct,
    Ssh,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub protocol: Protocol,
    pub endpoint: String,
    pub transport: Access,
    pub ssh_session_id: Option<String>,
    pub proxy_url: Option<String>,
}

enum Route {
    Direct(Client),
    SshSocket(Arc<SshSession>, String),
    SshTcp(Arc<SshSession>),
}

pub(super) struct Engine {
    route: Route,
    origin: Url,
}

const DEADLINE: Duration = Duration::from_secs(60);
const ERROR_LIMIT: usize = 4096;
const PIPE_PREFIX: &str = r"\\.\pipe\";

fn network(err: impl Display) -> AppError {
    AppError::network(format!("Docker Engine: {err}"))
}

/// HTTP 端点和代理只接受 origin，避免路径、凭据或查询被带入容器操作。
fn http_origin(value: &str) -> AppResult<Url> {
    let authority = value
        .split_once("://")
        .map(|(_, rest)| rest.strip_suffix('/').unwrap_or(rest))
        .unwrap_or_default();
    let url = Url::parse(value).map_err(|_| AppError::invalid_input("无效的 Docker HTTP 地址"))?;
    if authority.is_empty()
        || authority.contains(['/', '\\', '@', '?', '#'])
        || value.chars().any(char::is_whitespace)
        || !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || value.chars().any(char::is_control)
    {
        return Err(AppError::invalid_input(
            "Docker HTTP 地址只支持协议、主机与端口",
        ));
    }
    Ok(url)
}

impl Engine {
    /// 解析配置后固定本次操作的路径，SSH 路径缺失或不可用时不回退至本机。
    pub(super) async fn connect(target: Target, sessions: &SessionManager) -> AppResult<Self> {
        let endpoint = target.endpoint.as_str();
        if endpoint.is_empty() || endpoint.chars().any(char::is_control) {
            return Err(AppError::invalid_input("无效的 Docker 端点"));
        }
        let origin = match target.protocol {
            Protocol::Http | Protocol::Https => {
                let origin = http_origin(endpoint)?;
                if (target.protocol == Protocol::Https) != (origin.scheme() == "https") {
                    return Err(AppError::invalid_input("Docker 端点的协议与 URL 不一致"));
                }
                origin
            }
            Protocol::Unix | Protocol::Npipe => {
                if target.protocol == Protocol::Unix && !endpoint.starts_with('/') {
                    return Err(AppError::invalid_input("Docker Unix Socket 需要绝对路径"));
                }
                if target.protocol == Protocol::Npipe {
                    let name = endpoint
                        .split_at_checked(PIPE_PREFIX.len())
                        .filter(|(prefix, _)| prefix.eq_ignore_ascii_case(PIPE_PREFIX))
                        .map(|(_, name)| name)
                        .unwrap_or_default();
                    if name.is_empty()
                        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
                    {
                        return Err(AppError::invalid_input("Docker 命名管道需要本机管道路径"));
                    }
                }
                Url::parse("http://localhost").unwrap()
            }
        };
        let proxy = target.proxy_url.as_deref().filter(|url| !url.is_empty());
        if proxy.is_some()
            && (target.transport != Access::Direct
                || !matches!(target.protocol, Protocol::Http | Protocol::Https))
        {
            return Err(AppError::invalid_input(
                "HTTP 代理仅支持直连 Docker HTTP 端点",
            ));
        }
        let route = match target.transport {
            Access::Ssh => {
                let id = target
                    .ssh_session_id
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| AppError::invalid_input("缺少 Docker SSH 会话"))?;
                let session = sessions.get(&id).await?;
                match target.protocol {
                    Protocol::Unix => Route::SshSocket(session, endpoint.to_owned()),
                    Protocol::Http | Protocol::Https => Route::SshTcp(session),
                    Protocol::Npipe => {
                        return Err(AppError::invalid_input("命名管道仅支持本机直连"))
                    }
                }
            }
            Access::Direct => {
                let _ = rustls::crypto::ring::default_provider().install_default();
                let mut builder = Client::builder()
                    .no_proxy()
                    .redirect(reqwest::redirect::Policy::none())
                    .retry(reqwest::retry::never())
                    .connect_timeout(DEADLINE);
                builder = match target.protocol {
                    Protocol::Unix => {
                        #[cfg(unix)]
                        {
                            builder.unix_socket(endpoint.to_owned())
                        }
                        #[cfg(not(unix))]
                        {
                            return Err(AppError::invalid_input(
                                "本机不支持 Unix Socket，请使用 SSH 隧道或命名管道",
                            ));
                        }
                    }
                    Protocol::Npipe => {
                        #[cfg(windows)]
                        {
                            builder.windows_named_pipe(endpoint.to_owned())
                        }
                        #[cfg(not(windows))]
                        {
                            return Err(AppError::invalid_input("命名管道仅支持 Windows 本机"));
                        }
                    }
                    Protocol::Http | Protocol::Https => match proxy {
                        Some(url) => {
                            builder.proxy(reqwest::Proxy::all(http_origin(url)?).map_err(network)?)
                        }
                        None => builder,
                    },
                };
                Route::Direct(builder.build().map_err(network)?)
            }
        };
        Ok(Self { route, origin })
    }

    /// 对所有传输统一限制时长、响应大小和 HTTP 状态码，生命周期请求不自动重发。
    pub(super) async fn request(
        &self,
        method: Method,
        path: &str,
        limit: usize,
        allow_unchanged: bool,
    ) -> AppResult<Vec<u8>> {
        tokio::time::timeout(DEADLINE, async {
            let (response, _drivers) = self.open(method, path).await?;
            read_response(response, limit, allow_unchanged).await
        })
        .await
        .map_err(|_| AppError::network("Docker Engine 请求超时"))?
    }

    /// 仅握手、响应头和错误响应有超时；成功的 follow 请求允许容器长时间不产生日志。
    pub(super) async fn stream(&self, path: &str) -> AppResult<(Response, JoinSet<()>)> {
        tokio::time::timeout(DEADLINE, async {
            let (response, drivers) = self.open(Method::GET, path).await?;
            if !response.status().is_success() {
                return Err(response_error(response).await?);
            }
            Ok((response, drivers))
        })
        .await
        .map_err(|_| AppError::network("Docker Engine 请求超时"))?
    }

    async fn open(&self, method: Method, path: &str) -> AppResult<(Response, JoinSet<()>)> {
        let mut drivers = JoinSet::new();
        let response = match &self.route {
            Route::Direct(client) => {
                let url = self.origin.join(path).map_err(network)?;
                client.request(method, url).send().await.map_err(network)?
            }
            Route::SshSocket(session, socket) => {
                let stream = session.forward_socket(socket).await?;
                channel_request(stream, &self.origin, method, path, &mut drivers).await?
            }
            Route::SshTcp(session) => {
                let host = self.origin.host_str().unwrap().trim_matches(['[', ']']);
                let port = self.origin.port_or_known_default().unwrap();
                let stream = session
                    .forward_stream(host, port, ([127, 0, 0, 1], 0).into())
                    .await?;
                if self.origin.scheme() == "https" {
                    let name = rustls::pki_types::ServerName::try_from(host.to_owned())
                        .map_err(network)?;
                    let stream = tls_connector()?
                        .connect(name, stream)
                        .await
                        .map_err(network)?;
                    channel_request(stream, &self.origin, method, path, &mut drivers).await?
                } else {
                    channel_request(stream, &self.origin, method, path, &mut drivers).await?
                }
            }
        };
        Ok((response, drivers))
    }
}

/// 将 HTTP/1.1 原封不动送入 SSH 通道，避免依赖远端 CLI 或在本机开放转发端口。
async fn channel_request(
    stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static,
    origin: &Url,
    method: Method,
    path: &str,
    drivers: &mut JoinSet<()>,
) -> AppResult<Response> {
    let (mut sender, connection) = http1::handshake(TokioIo::new(stream))
        .await
        .map_err(network)?;
    drivers.spawn(async move {
        let _ = connection.await;
    });
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Host", origin.authority())
        .header("Connection", "close")
        .body(reqwest::Body::default())
        .map_err(network)?;
    let response = sender.send_request(request).await.map_err(network)?;
    Ok(Response::from(response.map(reqwest::Body::wrap)))
}

/// 隧道内的 HTTPS 仍验证 Docker 主机名与系统信任链。
fn tls_connector() -> AppResult<tokio_rustls::TlsConnector> {
    static CONFIG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    if let Some(config) = CONFIG.get() {
        return Ok(config.clone().into());
    }
    let mut roots = rustls::RootCertStore::empty();
    roots.add_parsable_certificates(rustls_native_certs::load_native_certs().certs);
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(network)?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(CONFIG.get_or_init(|| Arc::new(config)).clone().into())
}

/// 有限读取分块或定长响应，只向调用方返回 Engine 的简短错误信息。
async fn read_response(
    mut response: Response,
    limit: usize,
    allow_unchanged: bool,
) -> AppResult<Vec<u8>> {
    let status = response.status();
    let success = status.is_success() || (allow_unchanged && status == StatusCode::NOT_MODIFIED);
    if !success {
        return Err(response_error(response).await?);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        if chunk.len() > limit - bytes.len() {
            return Err(AppError::network("Docker Engine 响应超出大小限制"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn response_error(mut response: Response) -> AppResult<AppError> {
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        let remaining = ERROR_LIMIT - bytes.len();
        if chunk.len() > remaining {
            bytes.extend_from_slice(&chunk[..remaining]);
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    let detail = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|body| body["message"].as_str().map(str::to_owned))
        .unwrap_or_else(|| String::from_utf8_lossy(&bytes).trim().to_owned());
    Ok(network(format!("HTTP {status} {detail}")))
}
