//! 通过代理建立到 SSH 服务器的 TCP 连接。
//!
//! 手写 SOCKS5 与 HTTP CONNECT 握手，不引第三方 crate：
//! 两个协议的客户端侧都只有几十行，引依赖反而增加供应链与编译体积成本。
//!
//! 关键设计：目标地址一律以**域名**形式交给代理（SOCKS5 的 ATYP=0x03、
//! HTTP 的 `CONNECT host:port`），由代理去解析 DNS。
//! 本地先解析再把 IP 递过去会绕开代理自己的分流规则，
//! 也解决不了"本机 DNS 拿到的是被污染结果"这类问题。

use base64::Engine as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::error::{SshError, SshResult};
use super::models::{ProxyConfig, ProxyKind};

/// SOCKS5 协议版本号
const SOCKS5_VERSION: u8 = 0x05;
/// SOCKS5 子协商：用户名/密码认证的版本号
const SOCKS5_AUTH_VERSION: u8 = 0x01;
/// SOCKS5 认证方式：无需认证
const SOCKS5_AUTH_NONE: u8 = 0x00;
/// SOCKS5 认证方式：用户名/密码
const SOCKS5_AUTH_PASSWORD: u8 = 0x02;
/// SOCKS5 认证方式：服务端拒绝了所有我们支持的方式
const SOCKS5_AUTH_REJECTED: u8 = 0xFF;
/// SOCKS5 命令：CONNECT
const SOCKS5_CMD_CONNECT: u8 = 0x01;
/// SOCKS5 地址类型：IPv4
const SOCKS5_ATYP_IPV4: u8 = 0x01;
/// SOCKS5 地址类型：域名
const SOCKS5_ATYP_DOMAIN: u8 = 0x03;
/// SOCKS5 地址类型：IPv6
const SOCKS5_ATYP_IPV6: u8 = 0x04;

/// CONNECT 响应头的上限，防止恶意代理用不结束的响应把内存撑爆。
const MAX_HTTP_HEADER_BYTES: usize = 8 * 1024;

/// 握手过程中的失败原因。出口处再补上代理地址，内部只关心"哪一步错了"。
type Handshake = Result<(), String>;

/// 连到 `host:port`，按配置决定直连还是走代理。
///
/// 超时由调用方统一用 `tokio::time::timeout` 包住整段，这里只负责把握手做完。
pub async fn connect(host: &str, port: u16, proxy: Option<&ProxyConfig>) -> SshResult<TcpStream> {
    let Some(proxy) = proxy else {
        return direct(host, port).await;
    };

    let endpoint = format!("{}:{}", proxy.host, proxy.port);
    let mut stream = direct(&proxy.host, proxy.port)
        .await
        .map_err(|error| SshError::Proxy {
            endpoint: endpoint.clone(),
            reason: format!("连不上代理本身（{error}）"),
        })?;

    let outcome = match proxy.kind {
        ProxyKind::Socks5 => socks5_handshake(&mut stream, host, port, proxy).await,
        ProxyKind::Http => http_connect(&mut stream, host, port, proxy).await,
    };
    outcome.map_err(|reason| SshError::Proxy {
        endpoint: endpoint.clone(),
        reason,
    })?;

    log::info!(
        "已经由 {} 代理 {endpoint} 连到 {host}:{port}",
        proxy.kind.label()
    );
    Ok(stream)
}

/// 直连。Nagle 算法会把小按键攒起来再发，交互式终端必须关掉。
async fn direct(host: &str, port: u16) -> SshResult<TcpStream> {
    let stream = TcpStream::connect((host, port)).await?;
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

/// SOCKS5 握手：认证协商 → CONNECT 请求 → 读应答。
async fn socks5_handshake(
    stream: &mut TcpStream,
    host: &str,
    port: u16,
    proxy: &ProxyConfig,
) -> Handshake {
    let credentials = proxy.credentials();

    // 只在真配了账号时才声明支持密码认证：
    // 有些代理见到 0x02 就无条件要求认证，没配账号反而连不上。
    let greeting: &[u8] = if credentials.is_some() {
        &[SOCKS5_VERSION, 2, SOCKS5_AUTH_NONE, SOCKS5_AUTH_PASSWORD]
    } else {
        &[SOCKS5_VERSION, 1, SOCKS5_AUTH_NONE]
    };
    write_all(stream, greeting).await?;

    let mut choice = [0u8; 2];
    read_exact(stream, &mut choice).await?;
    if choice[0] != SOCKS5_VERSION {
        return Err(format!(
            "对端不是 SOCKS5 代理（应答版本 0x{:02x}），检查端口是不是填成了 HTTP 代理的",
            choice[0]
        ));
    }

    match choice[1] {
        SOCKS5_AUTH_NONE => {}
        SOCKS5_AUTH_PASSWORD => {
            let Some((username, password)) = credentials else {
                return Err("代理要求用户名和密码，但没有配置".into());
            };
            socks5_authenticate(stream, username, password).await?;
        }
        SOCKS5_AUTH_REJECTED => {
            return Err(if credentials.is_some() {
                "代理拒绝了用户名/密码认证".into()
            } else {
                "代理要求认证，请填写用户名和密码".into()
            })
        }
        other => return Err(format!("代理要求不支持的认证方式 0x{other:02x}")),
    }

    let domain = host.as_bytes();
    if domain.len() > u8::MAX as usize {
        return Err("主机名超过 255 字节".into());
    }

    let mut request = Vec::with_capacity(7 + domain.len());
    request.extend_from_slice(&[
        SOCKS5_VERSION,
        SOCKS5_CMD_CONNECT,
        0x00, // RSV
        SOCKS5_ATYP_DOMAIN,
        domain.len() as u8,
    ]);
    request.extend_from_slice(domain);
    request.extend_from_slice(&port.to_be_bytes());
    write_all(stream, &request).await?;

    let mut head = [0u8; 4];
    read_exact(stream, &mut head).await?;
    if head[1] != 0x00 {
        return Err(socks5_reply_message(head[1]).into());
    }

    // 应答尾部的 BND.ADDR / BND.PORT 用不上，但必须读完：
    // 残留字节会被当成 SSH 服务端标识，后面的握手直接错位。
    let rest = match head[3] {
        SOCKS5_ATYP_IPV4 => 4 + 2,
        SOCKS5_ATYP_IPV6 => 16 + 2,
        SOCKS5_ATYP_DOMAIN => {
            let mut length = [0u8; 1];
            read_exact(stream, &mut length).await?;
            length[0] as usize + 2
        }
        other => return Err(format!("代理返回未知地址类型 0x{other:02x}")),
    };
    let mut discard = vec![0u8; rest];
    read_exact(stream, &mut discard).await?;

    Ok(())
}

/// SOCKS5 的用户名/密码子协商（RFC 1929）。
async fn socks5_authenticate(stream: &mut TcpStream, username: &str, password: &str) -> Handshake {
    if username.len() > u8::MAX as usize || password.len() > u8::MAX as usize {
        return Err("代理用户名或密码超过 255 字节".into());
    }

    let mut message = Vec::with_capacity(3 + username.len() + password.len());
    message.push(SOCKS5_AUTH_VERSION);
    message.push(username.len() as u8);
    message.extend_from_slice(username.as_bytes());
    message.push(password.len() as u8);
    message.extend_from_slice(password.as_bytes());
    write_all(stream, &message).await?;

    let mut reply = [0u8; 2];
    read_exact(stream, &mut reply).await?;
    if reply[1] != 0x00 {
        return Err("代理用户名或密码不正确".into());
    }
    Ok(())
}

/// SOCKS5 应答码 → 人话。直接抛 0x05 这种数字对用户没有意义。
fn socks5_reply_message(code: u8) -> &'static str {
    match code {
        0x01 => "代理内部错误",
        0x02 => "代理的规则不允许连接该地址",
        0x03 => "代理报告网络不可达",
        0x04 => "代理报告主机不可达",
        0x05 => "目标主机拒绝连接",
        0x06 => "连接在代理侧超时",
        0x07 => "代理不支持 CONNECT 命令",
        0x08 => "代理不支持该地址类型",
        _ => "代理拒绝了连接",
    }
}

/// HTTP CONNECT 隧道。
async fn http_connect(
    stream: &mut TcpStream,
    host: &str,
    port: u16,
    proxy: &ProxyConfig,
) -> Handshake {
    let target = format!("{host}:{port}");
    let mut request = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if let Some((username, password)) = proxy.credentials() {
        let token =
            base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"));
        request.push_str(&format!("Proxy-Authorization: Basic {token}\r\n"));
    }
    request.push_str("\r\n");
    write_all(stream, request.as_bytes()).await?;

    let head = read_http_head(stream).await?;
    let status_line = head.lines().next().unwrap_or_default();
    // 形如 "HTTP/1.1 200 Connection established"
    let code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| format!("代理返回了无法解析的应答：{status_line}"))?;

    match code {
        200..=299 => Ok(()),
        403 => Err("代理拒绝连接该地址".into()),
        407 => Err("代理要求认证，请填写用户名和密码".into()),
        _ => Err(format!("代理返回 {status_line}")),
    }
}

/// 逐字节读到 `\r\n\r\n` 为止。
///
/// 不能按块读：CONNECT 成功后紧跟的就是 SSH 服务端标识，
/// 多读走一个字节都会让后面的 SSH 握手错位。
async fn read_http_head(stream: &mut TcpStream) -> Result<String, String> {
    let mut buffer = Vec::with_capacity(128);
    let mut byte = [0u8; 1];
    while !buffer.ends_with(b"\r\n\r\n") {
        if buffer.len() >= MAX_HTTP_HEADER_BYTES {
            return Err("代理响应头过长".into());
        }
        read_exact(stream, &mut byte).await?;
        buffer.push(byte[0]);
    }
    String::from_utf8(buffer).map_err(|_| "代理响应头不是合法文本".into())
}

async fn write_all(stream: &mut TcpStream, bytes: &[u8]) -> Handshake {
    stream
        .write_all(bytes)
        .await
        .map_err(|error| format!("发送握手数据失败：{error}"))
}

async fn read_exact(stream: &mut TcpStream, buffer: &mut [u8]) -> Handshake {
    stream
        .read_exact(buffer)
        .await
        .map(|_| ())
        .map_err(|error| format!("读取代理应答失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;
    use std::pin::Pin;
    use tokio::net::TcpListener;

    fn proxy(kind: ProxyKind, username: &str, password: &str, port: u16) -> ProxyConfig {
        ProxyConfig {
            kind,
            host: "127.0.0.1".into(),
            port,
            username: username.into(),
            password: password.into(),
        }
    }

    /// 起一个假代理，接一条连接后交给 `handler`，返回监听端口。
    async fn fake_proxy<F>(handler: F) -> u16
    where
        F: FnOnce(TcpStream) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            handler(stream).await;
        });
        port
    }

    /// 读到 CONNECT 请求头结束。
    async fn read_head(stream: &mut TcpStream) -> String {
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).await.unwrap();
            head.push(byte[0]);
        }
        String::from_utf8(head).unwrap()
    }

    #[tokio::test]
    async fn socks5_把目标按域名交给代理而不是本地解析() {
        let port = fake_proxy(|mut stream| {
            Box::pin(async move {
                let mut greeting = [0u8; 3];
                stream.read_exact(&mut greeting).await.unwrap();
                assert_eq!(greeting, [0x05, 0x01, 0x00]);
                stream.write_all(&[0x05, 0x00]).await.unwrap();

                let mut head = [0u8; 5];
                stream.read_exact(&mut head).await.unwrap();
                assert_eq!(head[3], SOCKS5_ATYP_DOMAIN);
                let mut domain = vec![0u8; head[4] as usize];
                stream.read_exact(&mut domain).await.unwrap();
                assert_eq!(&domain, b"example.com");
                let mut target = [0u8; 2];
                stream.read_exact(&mut target).await.unwrap();
                assert_eq!(u16::from_be_bytes(target), 22);

                stream
                    .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await
                    .unwrap();
            })
        })
        .await;

        let config = proxy(ProxyKind::Socks5, "", "", port);
        connect("example.com", 22, Some(&config)).await.unwrap();
    }

    #[tokio::test]
    async fn socks5_配了账号才协商密码认证() {
        let port = fake_proxy(|mut stream| {
            Box::pin(async move {
                let mut greeting = [0u8; 4];
                stream.read_exact(&mut greeting).await.unwrap();
                assert_eq!(greeting, [0x05, 0x02, 0x00, 0x02]);
                stream.write_all(&[0x05, 0x02]).await.unwrap();

                let mut version = [0u8; 2];
                stream.read_exact(&mut version).await.unwrap();
                let mut username = vec![0u8; version[1] as usize];
                stream.read_exact(&mut username).await.unwrap();
                assert_eq!(&username, b"kuriyama");
                let mut length = [0u8; 1];
                stream.read_exact(&mut length).await.unwrap();
                let mut password = vec![0u8; length[0] as usize];
                stream.read_exact(&mut password).await.unwrap();
                assert_eq!(&password, b"mirai");
                stream.write_all(&[0x01, 0x00]).await.unwrap();

                let mut head = [0u8; 5];
                stream.read_exact(&mut head).await.unwrap();
                let mut rest = vec![0u8; head[4] as usize + 2];
                stream.read_exact(&mut rest).await.unwrap();
                stream
                    .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await
                    .unwrap();
            })
        })
        .await;

        let config = proxy(ProxyKind::Socks5, "kuriyama", "mirai", port);
        connect("example.com", 22, Some(&config)).await.unwrap();
    }

    #[tokio::test]
    async fn socks5_拒绝码转成可读原因() {
        let port = fake_proxy(|mut stream| {
            Box::pin(async move {
                let mut greeting = [0u8; 3];
                stream.read_exact(&mut greeting).await.unwrap();
                stream.write_all(&[0x05, 0x00]).await.unwrap();
                let mut head = [0u8; 5];
                stream.read_exact(&mut head).await.unwrap();
                let mut rest = vec![0u8; head[4] as usize + 2];
                stream.read_exact(&mut rest).await.unwrap();
                stream
                    .write_all(&[0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await
                    .unwrap();
            })
        })
        .await;

        let config = proxy(ProxyKind::Socks5, "", "", port);
        let error = connect("example.com", 22, Some(&config))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("代理的规则不允许连接该地址"), "{error}");
    }

    #[tokio::test]
    async fn http_connect_成功且不吞掉隧道数据() {
        let port = fake_proxy(|mut stream| {
            Box::pin(async move {
                let text = read_head(&mut stream).await;
                assert!(
                    text.starts_with("CONNECT example.com:22 HTTP/1.1\r\n"),
                    "{text}"
                );
                assert!(text.contains("Proxy-Authorization: Basic "), "{text}");
                // 应答头后面紧跟隧道数据，客户端不能多读走
                stream
                    .write_all(b"HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-test")
                    .await
                    .unwrap();
            })
        })
        .await;

        let config = proxy(ProxyKind::Http, "kuriyama", "mirai", port);
        let mut stream = connect("example.com", 22, Some(&config)).await.unwrap();
        let mut banner = [0u8; 12];
        stream.read_exact(&mut banner).await.unwrap();
        assert_eq!(&banner, b"SSH-2.0-test");
    }

    #[tokio::test]
    async fn http_407_提示补认证() {
        let port = fake_proxy(|mut stream| {
            Box::pin(async move {
                read_head(&mut stream).await;
                stream
                    .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
                    .await
                    .unwrap();
            })
        })
        .await;

        let config = proxy(ProxyKind::Http, "", "", port);
        let error = connect("example.com", 22, Some(&config))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("代理要求认证"), "{error}");
    }

    #[tokio::test]
    async fn 代理不可达时报的是代理地址而不是目标机() {
        // 监听在随机端口后立刻关掉，确保该端口无人接听
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let config = proxy(ProxyKind::Socks5, "", "", port);
        let error = connect("example.com", 22, Some(&config))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("连不上代理本身"), "{error}");
        assert!(error.contains(&format!("127.0.0.1:{port}")), "{error}");
    }

    #[tokio::test]
    async fn 没配代理时直连() {
        let port = fake_proxy(|mut stream| {
            Box::pin(async move {
                stream.write_all(b"SSH-2.0-direct").await.unwrap();
            })
        })
        .await;

        let mut stream = connect("127.0.0.1", port, None).await.unwrap();
        let mut banner = [0u8; 14];
        stream.read_exact(&mut banner).await.unwrap();
        assert_eq!(&banner, b"SSH-2.0-direct");
    }
}
