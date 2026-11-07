//! 复合类型分页读取与原子写入、键重命名、按模式批量删除。
use super::{manager::RedisManager, models::*, protocol::*};
use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD, Engine};
use redis::Value;
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

static NEXT_SENTINEL: AtomicU64 = AtomicU64::new(1);
/// 单个成员最多回传的字节数，超出部分只读。
const ITEM_BYTES: usize = PREVIEW_BYTES;
/// List / Stream 无服务端匹配，按页过滤时最多检查的元素数。
const FILTER_SCAN_LIMIT: i64 = 10_000;
/// 批量删除预览最多列出的键名。
const PREVIEW_KEY_NAMES: usize = 200;

/// 类型校验在脚本内与写入原子执行；ARGV[1] 为期望类型，ARGV[2] 为是否允许新建。
const TYPE_GUARD: &str = "local t = redis.call('TYPE', KEYS[1]).ok \
if t ~= ARGV[1] and not (t == 'none' and ARGV[2] == '1') then \
return redis.error_reply('键不存在或类型已变化，请刷新') end ";

pub(super) fn bytes(value: &[u8]) -> RedisBytes {
    let size = value.len();
    let cut = &value[..size.min(ITEM_BYTES)];
    let text = std::str::from_utf8(cut);
    RedisBytes {
        binary: text.is_err(),
        text: text
            .map(str::to_owned)
            .unwrap_or_else(|_| String::from_utf8_lossy(cut).into_owned()),
        raw: STANDARD.encode(cut),
        size,
        truncated: size > ITEM_BYTES,
    }
}

fn as_bytes(value: &Value) -> Vec<u8> {
    match value {
        Value::BulkString(bytes) => bytes.clone(),
        Value::SimpleString(text) => text.as_bytes().to_vec(),
        Value::Int(n) => n.to_string().into_bytes(),
        Value::Double(n) => n.to_string().into_bytes(),
        _ => Vec::new(),
    }
}

fn items(value: &Value) -> &[Value] {
    match value {
        Value::Array(items) | Value::Set(items) => items,
        _ => &[],
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    needle.is_empty()
        || haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

fn stream_entry(entry: &Value) -> Option<RedisCollectionItem> {
    let [id, fields] = items(entry) else {
        return None;
    };
    let pairs = items(fields)
        .chunks(2)
        .filter_map(|pair| match pair {
            [field, value] => Some([bytes(&as_bytes(field)), bytes(&as_bytes(value))]),
            _ => None,
        })
        .collect();
    Some(RedisCollectionItem {
        field: None,
        value: None,
        score: None,
        index: None,
        id: Some(String::from_utf8_lossy(&as_bytes(id)).into_owned()),
        fields: Some(pairs),
    })
}

fn stream_matches(entry: &Value, needle: &[u8]) -> bool {
    let [id, fields] = items(entry) else {
        return false;
    };
    contains(&as_bytes(id), needle)
        || items(fields)
            .iter()
            .any(|value| contains(&as_bytes(value), needle))
}

fn decode(value: &str) -> AppResult<Vec<u8>> {
    decode_key(value)
}

fn stream_id(id: &str, allow_auto: bool) -> AppResult<String> {
    let id = id.trim();
    let valid = (allow_auto && (id.is_empty() || id == "*"))
        || (!id.is_empty()
            && id.len() <= 64
            && id
                .bytes()
                .all(|b| b.is_ascii_digit() || b == b'-' || b == b'*'));
    if !valid {
        return Err(AppError::invalid_input(
            "Stream ID 格式无效，例如 1700000000000-0 或 *",
        ));
    }
    Ok(if id.is_empty() { "*".into() } else { id.into() })
}

impl RedisManager {
    pub async fn collection_page(
        &self,
        id: &str,
        encoded_key: &str,
        cursor: &str,
        pattern: &str,
        count: u32,
    ) -> AppResult<RedisCollectionPage> {
        let key = decode_key(encoded_key)?;
        if pattern.len() > 4096 {
            return Err(AppError::invalid_input("Redis scan pattern is too long"));
        }
        let count = count.clamp(10, 1000) as i64;
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let key_type: String = session.query(redis::cmd("TYPE").arg(&key)).await?;
        let length_cmd = match key_type.as_str() {
            "hash" => "HLEN",
            "list" => "LLEN",
            "set" => "SCARD",
            "zset" => "ZCARD",
            "stream" => "XLEN",
            "none" => return Err(AppError::not_found("Redis 键不存在或已过期")),
            _ => return Err(AppError::invalid_input("此类型不支持分页浏览")),
        };
        let total: u64 = session.query(redis::cmd(length_cmd).arg(&key)).await?;
        let mut out = Vec::new();
        let next: String;
        match key_type.as_str() {
            // 有序集合无搜索时按排名分页，保持分数顺序。
            "zset" if pattern.is_empty() => {
                let offset: i64 = cursor.parse().unwrap_or(0);
                let result: Value = session
                    .query(
                        redis::cmd("ZRANGE")
                            .arg(&key)
                            .arg(offset)
                            .arg(offset + count - 1)
                            .arg("WITHSCORES"),
                    )
                    .await?;
                for (i, pair) in items(&result).chunks(2).enumerate() {
                    if let [member, score] = pair {
                        out.push(RedisCollectionItem {
                            field: None,
                            value: Some(bytes(&as_bytes(member))),
                            score: Some(String::from_utf8_lossy(&as_bytes(score)).into_owned()),
                            index: Some(offset + i as i64),
                            id: None,
                            fields: None,
                        });
                    }
                }
                let end = offset + out.len() as i64;
                next = if (end as u64) < total && !out.is_empty() {
                    end.to_string()
                } else {
                    "0".into()
                };
            }
            "hash" | "set" | "zset" => {
                let scan = match key_type.as_str() {
                    "hash" => "HSCAN",
                    "set" => "SSCAN",
                    _ => "ZSCAN",
                };
                let cursor: u64 = cursor
                    .parse()
                    .map_err(|_| AppError::invalid_input("Invalid Redis scan cursor"))?;
                let pattern = if pattern.is_empty() { "*" } else { pattern };
                let mut cursor = cursor;
                let started = Instant::now();
                // 稀疏匹配时连续推进，凑够一页或超出时间预算即返回。
                loop {
                    let (following, batch): (u64, Value) = session
                        .query(
                            redis::cmd(scan)
                                .arg(&key)
                                .arg(cursor)
                                .arg("MATCH")
                                .arg(pattern)
                                .arg("COUNT")
                                .arg(count),
                        )
                        .await?;
                    cursor = following;
                    let batch = items(&batch);
                    if key_type == "set" {
                        for member in batch {
                            out.push(RedisCollectionItem {
                                field: None,
                                value: Some(bytes(&as_bytes(member))),
                                score: None,
                                index: None,
                                id: None,
                                fields: None,
                            });
                        }
                    } else {
                        for pair in batch.chunks(2) {
                            if let [first, second] = pair {
                                let hash = key_type == "hash";
                                out.push(RedisCollectionItem {
                                    field: hash.then(|| bytes(&as_bytes(first))),
                                    value: Some(bytes(&as_bytes(if hash {
                                        second
                                    } else {
                                        first
                                    }))),
                                    score: (!hash).then(|| {
                                        String::from_utf8_lossy(&as_bytes(second)).into_owned()
                                    }),
                                    index: None,
                                    id: None,
                                    fields: None,
                                });
                            }
                        }
                    }
                    if cursor == 0
                        || out.len() as i64 >= count
                        || started.elapsed() >= Duration::from_millis(800)
                    {
                        break;
                    }
                }
                next = cursor.to_string();
            }
            "list" => {
                let mut offset: i64 = cursor.parse().unwrap_or(0);
                let needle = pattern.as_bytes();
                let limit = offset + FILTER_SCAN_LIMIT;
                loop {
                    let result: Value = session
                        .query(
                            redis::cmd("LRANGE")
                                .arg(&key)
                                .arg(offset)
                                .arg(offset + count - 1),
                        )
                        .await?;
                    let batch = items(&result);
                    for (i, value) in batch.iter().enumerate() {
                        let raw = as_bytes(value);
                        if contains(&raw, needle) {
                            out.push(RedisCollectionItem {
                                field: None,
                                value: Some(bytes(&raw)),
                                score: None,
                                index: Some(offset + i as i64),
                                id: None,
                                fields: None,
                            });
                        }
                    }
                    offset += batch.len() as i64;
                    if batch.is_empty()
                        || offset as u64 >= total
                        || out.len() as i64 >= count
                        || offset >= limit
                    {
                        break;
                    }
                }
                next = if (offset as u64) < total {
                    offset.to_string()
                } else {
                    "0".into()
                };
            }
            _ => {
                // Stream：游标为上一页最后一条 ID，使用排他起点继续。
                let mut start = if cursor == "0" || cursor.is_empty() {
                    "-".to_owned()
                } else {
                    format!("({}", stream_id(cursor, false)?)
                };
                let needle = pattern.as_bytes();
                let mut scanned = 0;
                let mut exhausted;
                loop {
                    let result: Value = session
                        .query(
                            redis::cmd("XRANGE")
                                .arg(&key)
                                .arg(&start)
                                .arg("+")
                                .arg("COUNT")
                                .arg(count),
                        )
                        .await?;
                    let batch = items(&result);
                    exhausted = (batch.len() as i64) < count;
                    scanned += batch.len() as i64;
                    for entry in batch {
                        if stream_matches(entry, needle) {
                            out.extend(stream_entry(entry));
                        }
                    }
                    if let Some(last) = batch.last().and_then(stream_entry).and_then(|e| e.id) {
                        start = format!("({last}");
                    }
                    if exhausted || out.len() as i64 >= count || scanned >= FILTER_SCAN_LIMIT {
                        break;
                    }
                }
                next = if exhausted {
                    "0".into()
                } else {
                    start.trim_start_matches('(').to_owned()
                };
            }
        }
        Ok(RedisCollectionPage {
            cursor: next,
            items: out,
            total,
        })
    }

    /// 返回写入后集合的剩余长度；为 0 时 Redis 已自动删除该键。
    pub async fn collection_write(
        &self,
        id: &str,
        encoded_key: &str,
        op: RedisCollectionOp,
        create: bool,
    ) -> AppResult<u64> {
        let key = decode_key(encoded_key)?;
        let mut command = redis::cmd("EVAL");
        let (key_type, body, args): (&str, &str, Vec<Vec<u8>>) = match op {
            RedisCollectionOp::HashSet {
                field,
                value,
                old_field,
            } => {
                let field = decode(&field)?;
                let value = decode(&value)?;
                match old_field {
                    // 字段改名：新名已存在时拒绝，避免静默覆盖其他字段。
                    Some(old) if decode(&old)? != field => (
                        "hash",
                        "if redis.call('HEXISTS', KEYS[1], ARGV[5]) == 0 then return redis.error_reply('原字段已不存在，请刷新') end \
                         if redis.call('HEXISTS', KEYS[1], ARGV[3]) == 1 then return redis.error_reply('字段名已存在') end \
                         redis.call('HDEL', KEYS[1], ARGV[5]) redis.call('HSET', KEYS[1], ARGV[3], ARGV[4]) return redis.call('HLEN', KEYS[1])",
                        vec![field, value, decode(&old)?],
                    ),
                    _ => (
                        "hash",
                        "redis.call('HSET', KEYS[1], ARGV[3], ARGV[4]) return redis.call('HLEN', KEYS[1])",
                        vec![field, value],
                    ),
                }
            }
            RedisCollectionOp::HashDelete { field } => (
                "hash",
                "redis.call('HDEL', KEYS[1], ARGV[3]) return redis.call('HLEN', KEYS[1])",
                vec![decode(&field)?],
            ),
            RedisCollectionOp::ListSet { index, old, value } => (
                "list",
                "if redis.call('LINDEX', KEYS[1], ARGV[3]) ~= ARGV[4] then return redis.error_reply('列表元素已变化，请刷新') end \
                 redis.call('LSET', KEYS[1], ARGV[3], ARGV[5]) return redis.call('LLEN', KEYS[1])",
                vec![index.to_string().into_bytes(), decode(&old)?, decode(&value)?],
            ),
            RedisCollectionOp::ListPush { value, head } => (
                "list",
                if head {
                    "return redis.call('LPUSH', KEYS[1], ARGV[3])"
                } else {
                    "return redis.call('RPUSH', KEYS[1], ARGV[3])"
                },
                vec![decode(&value)?],
            ),
            // 先把目标位置换成唯一占位值再 LREM，按下标删除而不误删同值元素。
            RedisCollectionOp::ListDelete { index, old } => (
                "list",
                "if redis.call('LINDEX', KEYS[1], ARGV[3]) ~= ARGV[4] then return redis.error_reply('列表元素已变化，请刷新') end \
                 redis.call('LSET', KEYS[1], ARGV[3], ARGV[5]) redis.call('LREM', KEYS[1], 1, ARGV[5]) return redis.call('LLEN', KEYS[1])",
                vec![
                    index.to_string().into_bytes(),
                    decode(&old)?,
                    format!(
                        "__miraihub_removed_{}_{}__",
                        std::process::id(),
                        NEXT_SENTINEL.fetch_add(1, Ordering::Relaxed)
                    )
                    .into_bytes(),
                ],
            ),
            RedisCollectionOp::SetAdd { member, old } => {
                let member = decode(&member)?;
                match old {
                    Some(old) if decode(&old)? != member => (
                        "set",
                        "if redis.call('SISMEMBER', KEYS[1], ARGV[4]) == 0 then return redis.error_reply('原成员已不存在，请刷新') end \
                         if redis.call('SISMEMBER', KEYS[1], ARGV[3]) == 1 then return redis.error_reply('成员已存在') end \
                         redis.call('SREM', KEYS[1], ARGV[4]) redis.call('SADD', KEYS[1], ARGV[3]) return redis.call('SCARD', KEYS[1])",
                        vec![member, decode(&old)?],
                    ),
                    _ => (
                        "set",
                        "redis.call('SADD', KEYS[1], ARGV[3]) return redis.call('SCARD', KEYS[1])",
                        vec![member],
                    ),
                }
            }
            RedisCollectionOp::SetDelete { member } => (
                "set",
                "redis.call('SREM', KEYS[1], ARGV[3]) return redis.call('SCARD', KEYS[1])",
                vec![decode(&member)?],
            ),
            RedisCollectionOp::ZsetAdd { member, score, old } => {
                if !score.is_finite() {
                    return Err(AppError::invalid_input("分数必须是有限数字"));
                }
                let member = decode(&member)?;
                let score = score.to_string().into_bytes();
                match old {
                    Some(old) if decode(&old)? != member => (
                        "zset",
                        "if redis.call('ZSCORE', KEYS[1], ARGV[5]) == false then return redis.error_reply('原成员已不存在，请刷新') end \
                         if redis.call('ZSCORE', KEYS[1], ARGV[3]) ~= false then return redis.error_reply('成员已存在') end \
                         redis.call('ZREM', KEYS[1], ARGV[5]) redis.call('ZADD', KEYS[1], ARGV[4], ARGV[3]) return redis.call('ZCARD', KEYS[1])",
                        vec![member, score, decode(&old)?],
                    ),
                    _ => (
                        "zset",
                        "redis.call('ZADD', KEYS[1], ARGV[4], ARGV[3]) return redis.call('ZCARD', KEYS[1])",
                        vec![member, score],
                    ),
                }
            }
            RedisCollectionOp::ZsetDelete { member } => (
                "zset",
                "redis.call('ZREM', KEYS[1], ARGV[3]) return redis.call('ZCARD', KEYS[1])",
                vec![decode(&member)?],
            ),
            RedisCollectionOp::StreamAdd { id: entry, fields } => {
                if fields.is_empty() {
                    return Err(AppError::invalid_input("Stream 条目至少需要一个字段"));
                }
                let mut args = vec![stream_id(&entry, true)?.into_bytes()];
                for [field, value] in fields {
                    args.push(decode(&field)?);
                    args.push(decode(&value)?);
                }
                (
                    "stream",
                    "local args = {} for i = 4, #ARGV do args[#args + 1] = ARGV[i] end \
                     redis.call('XADD', KEYS[1], ARGV[3], unpack(args)) return redis.call('XLEN', KEYS[1])",
                    args,
                )
            }
            RedisCollectionOp::StreamDelete { id: entry } => (
                "stream",
                "redis.call('XDEL', KEYS[1], ARGV[3]) return redis.call('XLEN', KEYS[1])",
                vec![stream_id(&entry, false)?.into_bytes()],
            ),
        };
        command
            .arg(format!("{TYPE_GUARD}{body}"))
            .arg(1)
            .arg(&key)
            .arg(key_type)
            .arg(if create { "1" } else { "0" });
        for arg in args {
            command.arg(arg);
        }
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        session.query(&command).await
    }

    /// 新建 string 键；键已存在时拒绝。
    pub async fn create_string(
        &self,
        id: &str,
        encoded_key: &str,
        value: &str,
        ttl_secs: i64,
    ) -> AppResult<()> {
        if value.len() > PREVIEW_BYTES {
            return Err(AppError::invalid_input(
                "Redis value exceeds the editor limit (64 KiB)",
            ));
        }
        if ttl_secs != -1 && !(1..=2_147_483_647).contains(&ttl_secs) {
            return Err(AppError::invalid_input("TTL 必须为正整数，-1 表示永不过期"));
        }
        let key = decode_key(encoded_key)?;
        let mut command = redis::cmd("SET");
        command.arg(&key).arg(value).arg("NX");
        if ttl_secs > 0 {
            command.arg("EX").arg(ttl_secs);
        }
        let session = self.session(id).await?;
        let result: Option<String> = session.lock().await.query(&command).await?;
        if result.is_none() {
            return Err(AppError::invalid_input("键已存在"));
        }
        Ok(())
    }

    pub async fn rename_key(
        &self,
        id: &str,
        encoded_key: &str,
        new_name: &str,
        overwrite: bool,
    ) -> AppResult<RedisKey> {
        let key = decode_key(encoded_key)?;
        let target = new_name.as_bytes();
        if target.len() > 1_048_576 {
            return Err(AppError::invalid_input("Redis key is too large"));
        }
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        if overwrite {
            let _: () = session
                .query(redis::cmd("RENAME").arg(&key).arg(target))
                .await?;
        } else {
            let renamed: i64 = session
                .query(redis::cmd("RENAMENX").arg(&key).arg(target))
                .await?;
            if renamed == 0 {
                return Err(AppError::invalid_input("目标键名已存在"));
            }
        }
        Ok(key_info(target))
    }

    /// 有界扫描匹配的键，供批量删除前确认范围。
    pub async fn preview_pattern(&self, id: &str, pattern: &str) -> AppResult<RedisPatternPreview> {
        if pattern.is_empty() || pattern.len() > 4096 {
            return Err(AppError::invalid_input("请输入匹配模式"));
        }
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let mut cursor = 0u64;
        let mut keys = Vec::new();
        let mut count = 0u64;
        let started = Instant::now();
        loop {
            let (next, batch): (u64, Vec<Vec<u8>>) = session
                .query(
                    redis::cmd("SCAN")
                        .arg(cursor)
                        .arg("MATCH")
                        .arg(pattern)
                        .arg("COUNT")
                        .arg(1000),
                )
                .await?;
            cursor = next;
            count += batch.len() as u64;
            for key in batch
                .iter()
                .take(PREVIEW_KEY_NAMES.saturating_sub(keys.len()))
            {
                keys.push(key_info(key));
            }
            if cursor == 0 || started.elapsed() >= Duration::from_secs(3) {
                break;
            }
        }
        Ok(RedisPatternPreview {
            keys,
            count,
            complete: cursor == 0,
        })
    }

    /// 完整扫描并分批 UNLINK；返回实际删除的键数。
    pub async fn delete_pattern(&self, id: &str, pattern: &str) -> AppResult<u64> {
        if pattern.is_empty() || pattern.len() > 4096 {
            return Err(AppError::invalid_input("请输入匹配模式"));
        }
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let mut cursor = 0u64;
        let mut deleted = 0u64;
        loop {
            let (next, batch): (u64, Vec<Vec<u8>>) = session
                .query(
                    redis::cmd("SCAN")
                        .arg(cursor)
                        .arg("MATCH")
                        .arg(pattern)
                        .arg("COUNT")
                        .arg(1000),
                )
                .await?;
            cursor = next;
            if !batch.is_empty() {
                let removed: u64 = session.query(redis::cmd("UNLINK").arg(&batch)).await?;
                deleted += removed;
            }
            if cursor == 0 {
                break;
            }
        }
        Ok(deleted)
    }
}
