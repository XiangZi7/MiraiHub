//! 命令输入解析与有界、无损的 IPC 结果表示。
use super::models::RedisKey;
use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD, Engine};
use redis::Value;
use serde_json::{json, Value as Json};

pub const PREVIEW_BYTES: usize = 65_536;
pub const PREVIEW_ITEMS: usize = 100;

pub fn key_info(bytes: &[u8]) -> RedisKey {
    RedisKey {
        id: STANDARD.encode(bytes),
        name: std::str::from_utf8(bytes)
            .map(str::to_owned)
            .unwrap_or_else(|_| format!("base64:{}", STANDARD.encode(bytes))),
    }
}

pub fn decode_key(encoded: &str) -> AppResult<Vec<u8>> {
    if encoded.len() > 1_048_576 {
        return Err(AppError::invalid_input("Redis key is too large"));
    }
    STANDARD
        .decode(encoded)
        .map_err(|_| AppError::invalid_input("Invalid Redis key encoding"))
}

pub fn database_index(input: &str) -> AppResult<i64> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(0);
    }
    if !input.bytes().all(|b| b.is_ascii_digit()) {
        return Err(AppError::invalid_input("Redis 数据库索引必须是非负整数"));
    }
    input
        .parse()
        .map_err(|_| AppError::invalid_input("Redis 数据库索引必须是非负整数"))
}

/// 单条 redis-cli 风格命令；引号、空参数及 \xNN 字节转义保持原值。
pub fn parse_command(input: &str) -> AppResult<Vec<Vec<u8>>> {
    if input.len() > 1_048_576 {
        return Err(AppError::invalid_input("Redis command is too large"));
    }
    let mut args = Vec::new();
    let mut current = Vec::new();
    let mut quote = None;
    let mut started = false;
    let mut bytes = input.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'\\' {
            let next = bytes
                .next()
                .ok_or_else(|| AppError::invalid_input("Redis 命令转义不完整"))?;
            current.push(match next {
                b'n' => b'\n',
                b'r' => b'\r',
                b't' => b'\t',
                b'b' => 8,
                b'a' => 7,
                b'x' => {
                    let a = bytes.next().and_then(|b| (b as char).to_digit(16));
                    let b = bytes.next().and_then(|b| (b as char).to_digit(16));
                    match (a, b) {
                        (Some(a), Some(b)) => (a * 16 + b) as u8,
                        _ => return Err(AppError::invalid_input("Redis 命令转义不完整")),
                    }
                }
                other => other,
            });
            started = true;
        } else if let Some(delimiter) = quote {
            if byte == delimiter {
                quote = None;
            } else {
                current.push(byte);
            }
        } else if byte == b'\'' || byte == b'"' {
            quote = Some(byte);
            started = true;
        } else if byte.is_ascii_whitespace() {
            if started {
                args.push(std::mem::take(&mut current));
                started = false;
            }
        } else {
            current.push(byte);
            started = true;
        }
    }
    if quote.is_some() {
        return Err(AppError::invalid_input("Redis 命令引号未闭合"));
    }
    if started {
        args.push(current);
    }
    if args.first().is_none_or(Vec::is_empty) {
        return Err(AppError::invalid_input("请输入 Redis 命令"));
    }
    if args.len() > 10_000 {
        return Err(AppError::invalid_input("Too many Redis command arguments"));
    }
    Ok(args)
}

/// 这些命令会改变连接协议或让连接进入持续流模式，不能混用键浏览连接。
pub fn validate_command(args: &[Vec<u8>]) -> AppResult<String> {
    let name = std::str::from_utf8(&args[0])
        .map_err(|_| AppError::invalid_input("Invalid Redis command"))?
        .to_ascii_uppercase();
    if matches!(
        name.as_str(),
        "SELECT"
            | "AUTH"
            | "HELLO"
            | "QUIT"
            | "RESET"
            | "CLIENT"
            | "MULTI"
            | "EXEC"
            | "DISCARD"
            | "WATCH"
            | "UNWATCH"
            | "SUBSCRIBE"
            | "PSUBSCRIBE"
            | "SSUBSCRIBE"
            | "UNSUBSCRIBE"
            | "PUNSUBSCRIBE"
            | "SUNSUBSCRIBE"
            | "MONITOR"
            | "SYNC"
            | "PSYNC"
            | "REPLCONF"
    ) {
        return Err(AppError::invalid_input(
            "此命令会改变 Redis 连接状态；切换数据库请使用顶部数据库索引",
        ));
    }
    Ok(name)
}

pub fn preview(value: &Value) -> (Json, bool) {
    let mut bytes = PREVIEW_BYTES;
    let mut nodes = 1000usize;
    let mut truncated = false;
    let result = render(value, &mut bytes, &mut nodes, &mut truncated, 0);
    (result, truncated)
}

fn render(
    value: &Value,
    bytes: &mut usize,
    nodes: &mut usize,
    truncated: &mut bool,
    depth: usize,
) -> Json {
    if *nodes == 0 || depth > 32 {
        *truncated = true;
        return json!("…");
    }
    *nodes -= 1;
    match value {
        Value::Nil => Json::Null,
        // 使用字符串表示整数，避免 WebView 中超过 2^53 的整数失真。
        Value::Int(n) => json!(n.to_string()),
        Value::Okay => json!("OK"),
        Value::SimpleString(s) => render_bytes(s.as_bytes(), bytes, truncated),
        Value::BulkString(s) => render_bytes(s, bytes, truncated),
        Value::Array(items) | Value::Set(items) => {
            let mut out = Vec::new();
            for item in items {
                if *nodes == 0 || *bytes == 0 {
                    *truncated = true;
                    break;
                }
                out.push(render(item, bytes, nodes, truncated, depth + 1));
            }
            Json::Array(out)
        }
        Value::Map(items) => {
            let mut out = Vec::new();
            for (key, value) in items {
                if *nodes < 2 || *bytes == 0 {
                    *truncated = true;
                    break;
                }
                out.push(json!([
                    render(key, bytes, nodes, truncated, depth + 1),
                    render(value, bytes, nodes, truncated, depth + 1)
                ]));
            }
            Json::Array(out)
        }
        Value::Boolean(value) => json!(value),
        Value::Double(value) => json!(value.to_string()),
        _ => json!("Unsupported Redis response type"),
    }
}

fn render_bytes(value: &[u8], budget: &mut usize, truncated: &mut bool) -> Json {
    let size = value.len().min(*budget);
    *budget -= size;
    *truncated |= size < value.len();
    match std::str::from_utf8(&value[..size]) {
        Ok(text) => json!(text),
        Err(_) => json!({ "encoding": "base64", "data": STANDARD.encode(&value[..size]) }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_quoted_empty_unicode_and_binary_arguments() {
        assert_eq!(
            parse_command(r#"SET "键 名" """#).unwrap(),
            vec![b"SET".to_vec(), "键 名".as_bytes().to_vec(), vec![]]
        );
        assert_eq!(
            parse_command(r#"SET k "a\n\x00\"b""#).unwrap()[2],
            b"a\n\0\"b"
        );
        for input in ["", "  ", "GET \"oops", "GET k\\", r"GET \xzz"] {
            assert!(parse_command(input).is_err());
        }
    }
    #[test]
    fn validates_database_and_connection_modes() {
        assert_eq!(database_index("").unwrap(), 0);
        assert_eq!(database_index("32").unwrap(), 32);
        for input in ["-1", "1.5", "+1", "999999999999999999999"] {
            assert!(database_index(input).is_err());
        }
        for command in ["SELECT 1", "mUlTi", "CLIENT REPLY OFF", "MONITOR"] {
            assert!(validate_command(&parse_command(command).unwrap()).is_err());
        }
        assert!(validate_command(&parse_command("SET k v").unwrap()).is_ok());
    }
    #[test]
    fn binary_keys_round_trip_and_previews_are_bounded() {
        let key = key_info(&[0, 255, 1]);
        assert_eq!(decode_key(&key.id).unwrap(), vec![0, 255, 1]);
        assert!(decode_key("!invalid").is_err());
        let (output, cut) = preview(&Value::BulkString(vec![b'a'; PREVIEW_BYTES + 1]));
        assert!(cut);
        assert_eq!(output.as_str().unwrap().len(), PREVIEW_BYTES);
        assert_eq!(
            preview(&Value::BulkString(vec![255])).0["encoding"],
            "base64"
        );
        assert_eq!(preview(&Value::Int(i64::MAX)).0, i64::MAX.to_string());
        assert!(preview(&Value::Array(vec![Value::Nil; 1500])).1);
    }
}
