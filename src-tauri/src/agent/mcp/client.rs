//! One handshake per server, reused across tool calls and dropped when the
//! configuration changes.
use super::{jsonrpc, servers::McpServer, transport::Transport, CallOutcome};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;

const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(20);
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

struct Session {
    transport: Transport,
    next_id: u64,
}

impl Session {
    async fn handshake(server: &McpServer) -> AppResult<(Self, Value)> {
        let mut session = Self {
            transport: Transport::connect(server).await?,
            next_id: 1,
        };
        let init = session
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "MiraiHub", "version": env!("CARGO_PKG_VERSION")},
                }),
                INITIALIZE_TIMEOUT,
            )
            .await?;
        session
            .transport
            .notify(
                &jsonrpc::notification("notifications/initialized", json!({})),
                INITIALIZE_TIMEOUT,
            )
            .await?;
        Ok((session, init))
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> AppResult<Value> {
        let id = self.next_id;
        self.next_id += 1;
        self.transport
            .roundtrip(&jsonrpc::request(id, method, params), id, timeout)
            .await
    }

    async fn call(&mut self, name: &str, arguments: Value) -> AppResult<CallOutcome> {
        let result = self
            .request(
                "tools/call",
                json!({"name": name, "arguments": arguments}),
                CALL_TIMEOUT,
            )
            .await?;
        let text = result["content"]
            .as_array()
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|part| part["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        Ok(CallOutcome {
            text,
            is_error: result["isError"] == true,
        })
    }
}

/// Live sessions keyed by server id. A failed call drops the session so the next
/// one reconnects instead of reusing a broken pipe.
#[derive(Default)]
pub struct Pool {
    sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
}

impl Pool {
    pub async fn call(
        &self,
        server: &McpServer,
        tool: &str,
        arguments: Value,
    ) -> AppResult<CallOutcome> {
        let cell = self.session(server).await?;
        let mut session = cell.lock().await;
        match session.call(tool, arguments).await {
            Ok(outcome) => Ok(outcome),
            Err(error) => {
                let detail = session.transport.stderr().await;
                drop(session);
                self.sessions.lock().await.remove(&server.id);
                Err(with_stderr(error, &detail))
            }
        }
    }

    /// Handshake plus `tools/list`, used by the settings page's test button.
    pub async fn probe(&self, server: &McpServer) -> AppResult<Value> {
        let (mut session, init) = Session::handshake(server).await?;
        let listed = match session
            .request("tools/list", json!({}), INITIALIZE_TIMEOUT)
            .await
        {
            Ok(listed) => listed,
            Err(error) => return Err(explain(&session, error).await),
        };
        let tools: Vec<String> = listed["tools"]
            .as_array()
            .map(|tools| {
                tools
                    .iter()
                    .filter_map(|tool| tool["name"].as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        Ok(json!({
            "serverInfo": init["serverInfo"],
            "protocolVersion": init["protocolVersion"],
            "tools": tools,
        }))
    }

    /// Forgets every session. Called when MCP configuration changes, which also
    /// kills the underlying stdio processes.
    pub async fn reset(&self) {
        self.sessions.lock().await.clear();
    }

    async fn session(&self, server: &McpServer) -> AppResult<Arc<Mutex<Session>>> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(&server.id) {
            return Ok(session.clone());
        }
        let (session, _) = Session::handshake(server).await?;
        let session = Arc::new(Mutex::new(session));
        sessions.insert(server.id.clone(), session.clone());
        Ok(session)
    }
}

/// Reads stderr while the transport is still alive, then attaches it to the error.
async fn explain(session: &Session, error: AppError) -> AppError {
    with_stderr(error, &session.transport.stderr().await)
}

fn with_stderr(mut error: AppError, stderr: &str) -> AppError {
    let stderr = stderr.trim();
    if !stderr.is_empty() {
        error.message = format!("{}\n{}", error.message, super::clip(stderr, 500));
    }
    error
}
