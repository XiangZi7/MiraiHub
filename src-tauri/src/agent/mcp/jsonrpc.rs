//! Newline-delimited JSON-RPC 2.0, the framing MCP uses over stdio.
use super::jsonrpc_error;
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

pub const MAX_FRAME_BYTES: usize = 1_048_576;

#[derive(Default)]
pub struct Framer {
    buffer: Vec<u8>,
}

impl Framer {
    /// Feeds bytes and returns every complete frame. A single frame past the limit fails.
    pub fn push(&mut self, bytes: &[u8]) -> AppResult<Vec<Value>> {
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();
        loop {
            let Some(end) = self.buffer.iter().position(|byte| *byte == b'\n') else {
                if self.buffer.len() > MAX_FRAME_BYTES {
                    return Err(AppError::invalid_input("MCP 响应的单行超过 1 MB 限制"));
                }
                return Ok(frames);
            };
            let mut line: Vec<u8> = self.buffer.drain(..=end).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }
            if line.len() > MAX_FRAME_BYTES {
                return Err(AppError::invalid_input("MCP 响应的单行超过 1 MB 限制"));
            }
            frames.push(
                serde_json::from_slice(&line)
                    .map_err(|_| AppError::invalid_input("MCP 服务返回的不是 JSON"))?,
            );
        }
    }
}

pub fn request(id: u64, method: &str, params: Value) -> String {
    format!(
        "{}\n",
        json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
    )
}

pub fn notification(method: &str, params: Value) -> String {
    format!(
        "{}\n",
        json!({"jsonrpc":"2.0","method":method,"params":params})
    )
}

/// A JSON-RPC response: its `result`, or the server's error object as an `AppError`.
pub fn result(message: &Value) -> AppResult<Value> {
    if message["error"].is_object() {
        return Err(jsonrpc_error(&message["error"]));
    }
    Ok(message["result"].clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_frames_and_rejects_an_oversized_line() {
        let mut framer = Framer::default();
        assert!(framer
            .push(b"{\"jsonrpc\":\"2.0\",\"id\":1")
            .unwrap()
            .is_empty());
        let frames = framer
            .push(b",\"result\":{}}\n\n{\"jsonrpc\":\"2.0\",\"id\":2,\"error\":{\"code\":-1,\"message\":\"nope\"}}\n")
            .unwrap();
        assert_eq!(frames.len(), 2);
        assert!(result(&frames[0]).unwrap().is_object());
        assert!(result(&frames[1]).unwrap_err().message.contains("nope"));
        let mut framer = Framer::default();
        assert!(framer.push(&vec![b'x'; MAX_FRAME_BYTES + 1]).is_err());
    }

    #[test]
    fn requests_carry_an_id_and_notifications_do_not() {
        let request = request(7, "tools/call", json!({"name":"echo"}));
        let parsed: Value = serde_json::from_str(request.trim()).unwrap();
        assert_eq!(parsed["id"], 7);
        let notification = notification("notifications/initialized", json!({}));
        let parsed: Value = serde_json::from_str(notification.trim()).unwrap();
        assert!(parsed.get("id").is_none());
    }
}
