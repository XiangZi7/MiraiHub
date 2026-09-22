//! The two MCP transports: newline-framed stdio and Streamable HTTP.
use super::{jsonrpc, servers, servers::McpServer};
use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::time::Duration;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::Mutex,
};

const MAX_RESPONSE_BYTES: usize = 1_048_576;
/// Keeps the console window from flashing every time a server starts.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub enum Transport {
    Stdio(StdioTransport),
    Http(HttpTransport),
}

impl Transport {
    pub async fn connect(server: &McpServer) -> AppResult<Self> {
        match server.transport {
            servers::Transport::Stdio => Ok(Self::Stdio(StdioTransport::spawn(server).await?)),
            servers::Transport::Http => Ok(Self::Http(HttpTransport::new(server)?)),
        }
    }

    /// A notification has no response. HTTP notifications are sent as their own request.
    pub async fn notify(&mut self, frame: &str, timeout: Duration) -> AppResult<()> {
        match self {
            Self::Stdio(transport) => transport.send(frame).await,
            Self::Http(transport) => {
                transport.roundtrip(frame, 0, timeout).await?;
                Ok(())
            }
        }
    }

    pub async fn roundtrip(&mut self, frame: &str, id: u64, timeout: Duration) -> AppResult<Value> {
        match self {
            Self::Stdio(transport) => {
                transport.send(frame).await?;
                transport.recv(id, timeout).await
            }
            Self::Http(transport) => transport.roundtrip(frame, id, timeout).await,
        }
    }

    /// The trailing stderr of a stdio server, empty for HTTP. Surfaced on failure so
    /// "command not found" and similar startup errors stay visible.
    pub async fn stderr(&self) -> String {
        match self {
            Self::Stdio(transport) => transport.stderr_tail().await,
            Self::Http(_) => String::new(),
        }
    }
}

pub struct StdioTransport {
    child: Child,
    stdin: ChildStdin,
    lines: Mutex<BufReader<tokio::process::ChildStdout>>,
    stderr: std::sync::Arc<Mutex<String>>,
}

impl StdioTransport {
    async fn spawn(server: &McpServer) -> AppResult<Self> {
        let mut command = Command::new(&server.command);
        command
            .args(&server.args)
            .env_clear()
            .envs(server.env.iter().map(|secret| (&secret.key, &secret.value)))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|error| {
            AppError::internal(format!("无法启动 MCP 服务（{}）：{error}", server.command))
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::internal("MCP 服务的标准输入不可用"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::internal("MCP 服务的标准输出不可用"))?;
        let stderr = child.stderr.take();
        let tail = std::sync::Arc::new(Mutex::new(String::new()));
        if let Some(stderr) = stderr {
            drain_stderr(stderr, tail.clone());
        }
        Ok(Self {
            child,
            stdin,
            lines: Mutex::new(BufReader::new(stdout)),
            stderr: tail,
        })
    }

    async fn send(&mut self, frame: &str) -> AppResult<()> {
        self.stdin.write_all(frame.as_bytes()).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn recv(&self, id: u64, timeout: Duration) -> AppResult<Value> {
        let read = async {
            let mut reader = self.lines.lock().await;
            let mut pending = jsonrpc::Framer::default();
            let mut total = 0usize;
            loop {
                let mut line = String::new();
                let count = reader.read_line(&mut line).await?;
                if count == 0 {
                    return Err(AppError::internal("MCP 服务已退出"));
                }
                total += count;
                if total > MAX_RESPONSE_BYTES {
                    return Err(AppError::invalid_input("MCP 响应超过 1 MB 限制"));
                }
                for message in pending.push(line.as_bytes())? {
                    if message["id"].as_u64() == Some(id) {
                        return jsonrpc::result(&message);
                    }
                }
            }
        };
        tokio::time::timeout(timeout, read)
            .await
            .map_err(|_| AppError::internal("MCP 服务响应超时"))?
    }

    async fn stderr_tail(&self) -> String {
        self.stderr.lock().await.clone()
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

/// Stderr is diagnostic only. Keep the tail so a failure can quote the real reason
/// (`npx: command not found`) without letting it grow without bound.
fn drain_stderr(stderr: tokio::process::ChildStderr, tail: std::sync::Arc<Mutex<String>>) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let mut buffer = tail.lock().await;
                    buffer.push_str(&line);
                    if buffer.len() > 4096 {
                        let start = buffer.len() - 4096;
                        *buffer = buffer[start..].to_owned();
                    }
                }
            }
        }
    });
}

pub struct HttpTransport {
    url: String,
    headers: Vec<(String, String)>,
    session: Option<String>,
    client: reqwest::Client,
}

impl HttpTransport {
    fn new(server: &McpServer) -> AppResult<Self> {
        Ok(Self {
            url: server.url.clone(),
            headers: server
                .headers
                .iter()
                .map(|secret| (secret.key.clone(), secret.value.clone()))
                .collect(),
            session: None,
            client: super::super::config::client()?,
        })
    }

    async fn roundtrip(&mut self, frame: &str, id: u64, timeout: Duration) -> AppResult<Value> {
        let mut request = self
            .client
            .post(&self.url)
            .timeout(timeout)
            .header("accept", "application/json, text/event-stream")
            .header("content-type", "application/json")
            .header("mcp-protocol-version", "2025-06-18")
            .body(frame.trim().to_owned());
        for (key, value) in &self.headers {
            request = request.header(key, value);
        }
        if let Some(session) = &self.session {
            request = request.header("mcp-session-id", session);
        }
        let response = request.send().await.map_err(|error| {
            AppError::internal(format!("MCP 服务请求失败：{}", error.without_url()))
        })?;
        if !response.status().is_success() {
            return Err(AppError::internal(format!(
                "MCP 服务返回 HTTP {}",
                response.status().as_u16()
            )));
        }
        if let Some(session) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
        {
            self.session = Some(session.to_owned());
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let body = response
            .bytes()
            .await
            .map_err(|_| AppError::internal("读取 MCP 服务响应失败"))?;
        if body.len() > MAX_RESPONSE_BYTES {
            return Err(AppError::invalid_input("MCP 响应超过 1 MB 限制"));
        }
        if content_type.contains("text/event-stream") {
            return sse_result(&body, id);
        }
        let message: Value = serde_json::from_slice(&body)
            .map_err(|_| AppError::invalid_input("MCP 服务返回的不是 JSON"))?;
        jsonrpc::result(&message)
    }
}

/// Streamable HTTP may answer with one SSE stream; read `data:` lines until the id matches.
fn sse_result(body: &[u8], id: u64) -> AppResult<Value> {
    for line in String::from_utf8_lossy(body).lines() {
        let Some(data) = line.trim().strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let message: Value = serde_json::from_str(data)
            .map_err(|_| AppError::invalid_input("MCP 服务返回的不是 JSON"))?;
        if message["id"].as_u64() == Some(id) {
            return jsonrpc::result(&message);
        }
    }
    Err(AppError::internal("MCP 服务的事件流没有返回匹配的响应"))
}
