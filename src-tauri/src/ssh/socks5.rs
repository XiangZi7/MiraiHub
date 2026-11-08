//! 动态转发（-D）用的最小 SOCKS5 服务端握手（RFC 1928）。
//!
//! 只支持“无认证”方法与 CONNECT 命令；地址类型支持 IPv4、域名、IPv6。
//! 解析部分是纯函数，I/O 只负责按需读取字节并写回应答。

use std::net::{Ipv4Addr, Ipv6Addr};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const VERSION: u8 = 0x05;
const METHOD_NO_AUTH: u8 = 0x00;
const METHOD_NONE_ACCEPTABLE: u8 = 0xFF;
const CMD_CONNECT: u8 = 0x01;
const ATYP_IPV4: u8 = 0x01;
const ATYP_DOMAIN: u8 = 0x03;
const ATYP_IPV6: u8 = 0x04;
/// 问候最多 2+255 字节，请求最多 4+1+255+2 字节
const MAX_HANDSHAKE: usize = 262;

/// 应答码（RFC 1928 §6）。
pub const REPLY_SUCCEEDED: u8 = 0x00;
pub const REPLY_GENERAL_FAILURE: u8 = 0x01;
pub const REPLY_NOT_ALLOWED: u8 = 0x02;
pub const REPLY_HOST_UNREACHABLE: u8 = 0x04;
pub const REPLY_CONNECTION_REFUSED: u8 = 0x05;
pub const REPLY_COMMAND_NOT_SUPPORTED: u8 = 0x07;
pub const REPLY_ADDRESS_NOT_SUPPORTED: u8 = 0x08;

#[derive(Debug, PartialEq, Eq)]
pub enum SocksError {
    /// 版本号不是 5（含 SOCKS4 客户端）
    Version(u8),
    /// 客户端没有提供“无认证”方法
    NoAcceptableMethod,
    /// 仅支持 CONNECT，BIND / UDP ASSOCIATE 拒绝
    Command(u8),
    AddressType(u8),
    /// 域名为空或不是合法 UTF-8 等格式问题
    Malformed,
}

impl std::fmt::Display for SocksError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Version(v) => write!(f, "不支持的 SOCKS 版本 {v}"),
            Self::NoAcceptableMethod => write!(f, "客户端未提供无认证方式"),
            Self::Command(c) => write!(f, "不支持的 SOCKS 命令 {c}"),
            Self::AddressType(t) => write!(f, "不支持的地址类型 {t}"),
            Self::Malformed => write!(f, "SOCKS 请求格式错误"),
        }
    }
}

impl SocksError {
    /// 请求阶段的错误对应的应答码；问候阶段的错误不发请求应答。
    fn reply_code(&self) -> Option<u8> {
        match self {
            Self::Command(_) => Some(REPLY_COMMAND_NOT_SUPPORTED),
            Self::AddressType(_) => Some(REPLY_ADDRESS_NOT_SUPPORTED),
            Self::Malformed => Some(REPLY_GENERAL_FAILURE),
            Self::Version(_) | Self::NoAcceptableMethod => None,
        }
    }
}

/// CONNECT 的目标。IPv6 不带方括号，直接交给 direct-tcpip。
#[derive(Debug, PartialEq, Eq)]
pub struct SocksTarget {
    pub host: String,
    pub port: u16,
}

/// 解析问候 `VER NMETHODS METHODS...`。`Ok(None)` 表示数据还不完整，返回值为消耗的字节数。
pub fn parse_greeting(buf: &[u8]) -> Result<Option<usize>, SocksError> {
    let Some(&version) = buf.first() else {
        return Ok(None);
    };
    if version != VERSION {
        return Err(SocksError::Version(version));
    }
    let Some(&count) = buf.get(1) else {
        return Ok(None);
    };
    let end = 2 + count as usize;
    let Some(methods) = buf.get(2..end) else {
        return Ok(None);
    };
    if methods.contains(&METHOD_NO_AUTH) {
        Ok(Some(end))
    } else {
        Err(SocksError::NoAcceptableMethod)
    }
}

/// 解析请求 `VER CMD RSV ATYP DST.ADDR DST.PORT`。`Ok(None)` 表示数据还不完整。
pub fn parse_request(buf: &[u8]) -> Result<Option<(SocksTarget, usize)>, SocksError> {
    let Some(&version) = buf.first() else {
        return Ok(None);
    };
    if version != VERSION {
        return Err(SocksError::Version(version));
    }
    let Some(header) = buf.get(..4) else {
        return Ok(None);
    };
    if header[1] != CMD_CONNECT {
        return Err(SocksError::Command(header[1]));
    }
    let (host, address_end) = match header[3] {
        ATYP_IPV4 => {
            let Some(octets) = buf.get(4..8) else {
                return Ok(None);
            };
            let octets: [u8; 4] = octets.try_into().map_err(|_| SocksError::Malformed)?;
            (Ipv4Addr::from(octets).to_string(), 8)
        }
        ATYP_IPV6 => {
            let Some(octets) = buf.get(4..20) else {
                return Ok(None);
            };
            let octets: [u8; 16] = octets.try_into().map_err(|_| SocksError::Malformed)?;
            (Ipv6Addr::from(octets).to_string(), 20)
        }
        ATYP_DOMAIN => {
            let Some(&len) = buf.get(4) else {
                return Ok(None);
            };
            let end = 5 + len as usize;
            let Some(name) = buf.get(5..end) else {
                return Ok(None);
            };
            let name = std::str::from_utf8(name).map_err(|_| SocksError::Malformed)?;
            if name.is_empty() || name.chars().any(|c| c.is_whitespace() || c.is_control()) {
                return Err(SocksError::Malformed);
            }
            (name.to_owned(), end)
        }
        other => return Err(SocksError::AddressType(other)),
    };
    let Some(port) = buf.get(address_end..address_end + 2) else {
        return Ok(None);
    };
    let port = u16::from_be_bytes([port[0], port[1]]);
    if port == 0 {
        return Err(SocksError::Malformed);
    }
    Ok(Some((SocksTarget { host, port }, address_end + 2)))
}

/// 应答固定带 0.0.0.0:0 作为 BND 地址：经 SSH 转发时本端拿不到远端真实绑定地址。
pub fn reply(code: u8) -> [u8; 10] {
    [VERSION, code, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]
}

/// 反复读取直到解析函数给出完整结果；连接提前关闭或超长视为格式错误。
async fn read_until<S, T>(
    stream: &mut S,
    buf: &mut Vec<u8>,
    parse: impl Fn(&[u8]) -> Result<Option<T>, SocksError>,
) -> Result<T, HandshakeError>
where
    S: AsyncRead + Unpin,
{
    loop {
        if let Some(value) = parse(buf)? {
            return Ok(value);
        }
        if buf.len() >= MAX_HANDSHAKE {
            return Err(SocksError::Malformed.into());
        }
        let mut chunk = [0u8; MAX_HANDSHAKE];
        let room = MAX_HANDSHAKE - buf.len();
        let read = stream.read(&mut chunk[..room]).await?;
        if read == 0 {
            return Err(SocksError::Malformed.into());
        }
        buf.extend_from_slice(&chunk[..read]);
    }
}

#[derive(Debug)]
pub enum HandshakeError {
    Socks(SocksError),
    Io(std::io::Error),
}

impl From<SocksError> for HandshakeError {
    fn from(error: SocksError) -> Self {
        Self::Socks(error)
    }
}

impl From<std::io::Error> for HandshakeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl std::fmt::Display for HandshakeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Socks(error) => error.fmt(f),
            Self::Io(error) => write!(f, "SOCKS 握手失败：{error}"),
        }
    }
}

/// 完成服务端握手直到拿到 CONNECT 目标；成功应答由调用方在目标连通后发送。
///
/// 返回值第二项是紧跟在请求之后、已被读入缓冲的数据（个别客户端会抢先发送），
/// 调用方需先把它写给目标。
pub async fn accept<S>(stream: &mut S) -> Result<(SocksTarget, Vec<u8>), HandshakeError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut buf = Vec::with_capacity(MAX_HANDSHAKE);
    let consumed = match read_until(stream, &mut buf, parse_greeting).await {
        Ok(consumed) => consumed,
        Err(HandshakeError::Socks(SocksError::NoAcceptableMethod)) => {
            stream
                .write_all(&[VERSION, METHOD_NONE_ACCEPTABLE])
                .await?;
            return Err(SocksError::NoAcceptableMethod.into());
        }
        Err(error) => return Err(error),
    };
    stream.write_all(&[VERSION, METHOD_NO_AUTH]).await?;
    buf.drain(..consumed);
    match read_until(stream, &mut buf, parse_request).await {
        Ok((target, consumed)) => Ok((target, buf.split_off(consumed))),
        Err(HandshakeError::Socks(error)) => {
            if let Some(code) = error.reply_code() {
                stream.write_all(&reply(code)).await?;
            }
            Err(error.into())
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(atyp: u8, address: &[u8], port: u16) -> Vec<u8> {
        let mut buf = vec![VERSION, CMD_CONNECT, 0x00, atyp];
        buf.extend_from_slice(address);
        buf.extend_from_slice(&port.to_be_bytes());
        buf
    }

    #[test]
    fn greeting_requires_no_auth_method() {
        assert_eq!(parse_greeting(&[5, 2, 2, 0]), Ok(Some(4)));
        assert_eq!(parse_greeting(&[5, 1, 2]), Err(SocksError::NoAcceptableMethod));
        assert_eq!(parse_greeting(&[5, 2, 0]), Ok(None));
        assert_eq!(parse_greeting(&[5]), Ok(None));
        assert_eq!(parse_greeting(&[]), Ok(None));
        assert_eq!(parse_greeting(&[4, 1, 0]), Err(SocksError::Version(4)));
    }

    #[test]
    fn parses_every_address_type() {
        let ipv4 = request(ATYP_IPV4, &[10, 0, 0, 5], 5432);
        assert_eq!(
            parse_request(&ipv4),
            Ok(Some((
                SocksTarget {
                    host: "10.0.0.5".into(),
                    port: 5432
                },
                ipv4.len()
            )))
        );
        let mut domain = vec![11];
        domain.extend_from_slice(b"example.com");
        let domain = request(ATYP_DOMAIN, &domain, 443);
        assert_eq!(
            parse_request(&domain).unwrap().unwrap().0,
            SocksTarget {
                host: "example.com".into(),
                port: 443
            }
        );
        let ipv6 = request(ATYP_IPV6, &Ipv6Addr::LOCALHOST.octets(), 8080);
        assert_eq!(
            parse_request(&ipv6).unwrap().unwrap(),
            (
                SocksTarget {
                    host: "::1".into(),
                    port: 8080
                },
                22
            )
        );
    }

    #[test]
    fn incomplete_requests_wait_for_more_bytes() {
        let full = request(ATYP_IPV6, &Ipv6Addr::LOCALHOST.octets(), 22);
        for len in 0..full.len() {
            assert_eq!(parse_request(&full[..len]), Ok(None), "len {len}");
        }
    }

    #[test]
    fn rejects_invalid_requests() {
        let mut bad_version = request(ATYP_IPV4, &[127, 0, 0, 1], 80);
        bad_version[0] = 4;
        assert_eq!(parse_request(&bad_version), Err(SocksError::Version(4)));

        let mut bind = request(ATYP_IPV4, &[127, 0, 0, 1], 80);
        bind[1] = 0x02;
        assert_eq!(parse_request(&bind), Err(SocksError::Command(2)));
        let mut udp = bind.clone();
        udp[1] = 0x03;
        assert_eq!(parse_request(&udp), Err(SocksError::Command(3)));

        assert_eq!(
            parse_request(&request(0x09, &[1, 2, 3, 4], 80)),
            Err(SocksError::AddressType(9))
        );
        assert_eq!(
            parse_request(&request(ATYP_DOMAIN, &[0], 80)),
            Err(SocksError::Malformed)
        );
        assert_eq!(
            parse_request(&request(ATYP_DOMAIN, &[2, 0xff, 0xfe], 80)),
            Err(SocksError::Malformed)
        );
        assert_eq!(
            parse_request(&request(ATYP_IPV4, &[127, 0, 0, 1], 0)),
            Err(SocksError::Malformed)
        );
    }

    #[test]
    fn reply_codes_follow_rfc() {
        assert_eq!(reply(REPLY_SUCCEEDED)[..2], [5, 0]);
        assert_eq!(
            SocksError::Command(2).reply_code(),
            Some(REPLY_COMMAND_NOT_SUPPORTED)
        );
        assert_eq!(
            SocksError::AddressType(9).reply_code(),
            Some(REPLY_ADDRESS_NOT_SUPPORTED)
        );
        assert_eq!(SocksError::Version(4).reply_code(), None);
    }

    #[tokio::test]
    async fn handshake_over_a_stream() {
        let (mut client, mut server) = tokio::io::duplex(1024);
        let task = tokio::spawn(async move { accept(&mut server).await.map_err(|e| e.to_string()) });
        // 问候与请求分多次写入，验证跨包拼接
        client.write_all(&[5, 1]).await.unwrap();
        client.write_all(&[0]).await.unwrap();
        let mut method = [0u8; 2];
        client.read_exact(&mut method).await.unwrap();
        assert_eq!(method, [5, 0]);
        let mut domain = vec![8];
        domain.extend_from_slice(b"db.local");
        client
            .write_all(&request(ATYP_DOMAIN, &domain, 5432))
            .await
            .unwrap();
        let (target, rest) = task.await.unwrap().unwrap();
        assert!(rest.is_empty());
        assert_eq!(target.host, "db.local");
        assert_eq!(target.port, 5432);
    }

    #[tokio::test]
    async fn unsupported_command_gets_a_reply() {
        let (mut client, mut server) = tokio::io::duplex(1024);
        let task = tokio::spawn(async move { accept(&mut server).await.is_err() });
        client.write_all(&[5, 1, 0]).await.unwrap();
        let mut method = [0u8; 2];
        client.read_exact(&mut method).await.unwrap();
        let mut bind = request(ATYP_IPV4, &[127, 0, 0, 1], 80);
        bind[1] = 0x02;
        client.write_all(&bind).await.unwrap();
        let mut answer = [0u8; 10];
        client.read_exact(&mut answer).await.unwrap();
        assert_eq!(answer[1], REPLY_COMMAND_NOT_SUPPORTED);
        assert!(task.await.unwrap());
    }
}
