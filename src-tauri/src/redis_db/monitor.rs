//! 服务器监控：INFO、SLOWLOG、大 key 后台扫描与 Pub/Sub 订阅。
use super::{
    editor::bytes,
    manager::{redis_error, RedisManager},
    models::*,
    protocol::*,
};
use crate::error::{AppError, AppResult, ErrorKind};
use futures_util::StreamExt;
use redis::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::ipc::Channel;

static NEXT_JOB: AtomicU64 = AtomicU64::new(1);
/// 每批 SCAN 的数量提示；MEMORY USAGE 随管道一起发送。
const SCAN_BATCH: u64 = 500;
/// 大 key 结果最多保留的条数。
const TOP_KEYS: usize = 100;
/// 进度推送间隔，避免大库扫描时频繁 IPC。
const PROGRESS_INTERVAL: Duration = Duration::from_millis(300);
/// 订阅消息按批推送，单批上限与间隔。
const PUBSUB_BATCH: usize = 200;
const PUBSUB_INTERVAL: Duration = Duration::from_millis(100);

/// 后台任务：大 key 扫描靠 cancel 标记收尾并推送最终结果，订阅直接中止任务。
struct Job {
    session: String,
    cancel: Arc<AtomicBool>,
    task: Option<tokio::task::AbortHandle>,
}

fn jobs() -> std::sync::MutexGuard<'static, HashMap<u64, Job>> {
    static JOBS: OnceLock<Mutex<HashMap<u64, Job>>> = OnceLock::new();
    JOBS.get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

fn stop(job: Job) {
    job.cancel.store(true, Ordering::Relaxed);
    if let Some(task) = job.task {
        task.abort();
    }
}

/// 断开连接时一并停止该会话的扫描与订阅。
pub(super) fn stop_session(session: &str) {
    let removed: Vec<Job> = {
        let mut jobs = jobs();
        let ids: Vec<u64> = jobs
            .iter()
            .filter(|(_, job)| job.session == session)
            .map(|(id, _)| *id)
            .collect();
        ids.into_iter().filter_map(|id| jobs.remove(&id)).collect()
    };
    removed.into_iter().for_each(stop);
}

pub(super) fn stop_job(id: u64) {
    let job = jobs().remove(&id);
    if let Some(job) = job {
        stop(job);
    }
}

fn text(value: &Value) -> String {
    match value {
        Value::BulkString(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        Value::SimpleString(text) => text.clone(),
        Value::Int(n) => n.to_string(),
        Value::Double(n) => n.to_string(),
        Value::Okay => "OK".to_owned(),
        _ => String::new(),
    }
}

fn int(value: &Value) -> i64 {
    match value {
        Value::Int(n) => *n,
        other => text(other).parse().unwrap_or(0),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 解析 INFO 文本；`# Section` 开头为分节，其余为 `key:value`。
pub(super) fn parse_info(raw: &str) -> Vec<RedisInfoSection> {
    let mut sections: Vec<RedisInfoSection> = Vec::new();
    for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(name) = line.strip_prefix('#') {
            sections.push(RedisInfoSection {
                name: name.trim().to_owned(),
                entries: Vec::new(),
            });
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if sections.is_empty() {
            sections.push(RedisInfoSection {
                name: String::new(),
                entries: Vec::new(),
            });
        }
        if let Some(section) = sections.last_mut() {
            section.entries.push([key.to_owned(), value.to_owned()]);
        }
    }
    sections
}

fn length_command(key_type: &str) -> Option<&'static str> {
    Some(match key_type {
        "string" => "STRLEN",
        "hash" => "HLEN",
        "list" => "LLEN",
        "set" => "SCARD",
        "zset" => "ZCARD",
        "stream" => "XLEN",
        _ => return None,
    })
}

fn trimmed(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect()
}

impl RedisManager {
    pub async fn server_info(&self, id: &str) -> AppResult<Vec<RedisInfoSection>> {
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        // everything 含模块信息；旧版本不认识该参数时回退到默认分节。
        let raw: String = match session.query(redis::cmd("INFO").arg("everything")).await {
            Ok(raw) => raw,
            Err(error) if matches!(error.kind, ErrorKind::InvalidInput) => {
                session.query(&redis::cmd("INFO")).await?
            }
            Err(error) => return Err(error),
        };
        Ok(parse_info(&raw))
    }

    pub async fn slowlog(&self, id: &str, count: u32) -> AppResult<RedisSlowlog> {
        let session = self.session(id).await?;
        let mut session = session.lock().await;
        let total: i64 = session.query(redis::cmd("SLOWLOG").arg("LEN")).await?;
        let raw: Value = session
            .query(redis::cmd("SLOWLOG").arg("GET").arg(count.clamp(1, 1000)))
            .await?;
        let entries = match &raw {
            Value::Array(items) => items
                .iter()
                .filter_map(|entry| match entry {
                    Value::Array(fields) if fields.len() >= 4 => Some(RedisSlowlogEntry {
                        id: int(&fields[0]),
                        timestamp: int(&fields[1]),
                        duration_us: int(&fields[2]),
                        args: match &fields[3] {
                            Value::Array(args) => args.iter().map(text).collect(),
                            _ => Vec::new(),
                        },
                        client: fields.get(4).map(text).unwrap_or_default(),
                        client_name: fields.get(5).map(text).unwrap_or_default(),
                    }),
                    _ => None,
                })
                .collect(),
            _ => Vec::new(),
        };
        Ok(RedisSlowlog { total, entries })
    }

    pub async fn slowlog_reset(&self, id: &str) -> AppResult<()> {
        let session = self.session(id).await?;
        let _: Value = session
            .lock()
            .await
            .query(redis::cmd("SLOWLOG").arg("RESET"))
            .await?;
        Ok(())
    }

    /// 后台 SCAN + MEMORY USAGE，每批释放会话锁，期间其他操作可穿插执行。
    pub async fn big_key_scan(
        &self,
        id: &str,
        pattern: &str,
        on_progress: Channel<RedisBigKeyProgress>,
    ) -> AppResult<u64> {
        if pattern.len() > 4096 {
            return Err(AppError::invalid_input("Redis scan pattern is too long"));
        }
        let session = self.session(id).await?;
        let total: u64 = session.lock().await.query(&redis::cmd("DBSIZE")).await?;
        let job_id = NEXT_JOB.fetch_add(1, Ordering::Relaxed);
        let cancel = Arc::new(AtomicBool::new(false));
        jobs().insert(
            job_id,
            Job {
                session: id.to_owned(),
                cancel: cancel.clone(),
                task: None,
            },
        );
        let pattern = if pattern.is_empty() { "*" } else { pattern }.to_owned();
        tauri::async_runtime::spawn(async move {
            let mut top: Vec<RedisBigKey> = Vec::new();
            let mut scanned = 0u64;
            let mut cursor = 0u64;
            let mut last_sent = Instant::now();
            let send = |scanned, top: &[RedisBigKey], done, cancelled, error| {
                let _ = on_progress.send(RedisBigKeyProgress {
                    scanned,
                    total,
                    done,
                    cancelled,
                    error,
                    keys: top.to_vec(),
                });
            };
            let result: AppResult<()> = async {
                while !cancel.load(Ordering::Relaxed) {
                    let mut guard = session.lock().await;
                    let (next, keys): (u64, Vec<Vec<u8>>) = guard
                        .query(
                            redis::cmd("SCAN")
                                .arg(cursor)
                                .arg("MATCH")
                                .arg(&pattern)
                                .arg("COUNT")
                                .arg(SCAN_BATCH),
                        )
                        .await?;
                    if !keys.is_empty() {
                        let mut pipe = redis::pipe();
                        for key in &keys {
                            pipe.cmd("TYPE").arg(key);
                            pipe.cmd("MEMORY").arg("USAGE").arg(key);
                        }
                        let values: Vec<Value> = guard.pipeline(&pipe).await?;
                        let floor = if top.len() < TOP_KEYS {
                            0
                        } else {
                            top.last().map(|key| key.bytes).unwrap_or(0)
                        };
                        // 扫描期间被删除的键 MEMORY USAGE 返回 nil，直接跳过。
                        let candidates: Vec<(&Vec<u8>, String, u64)> = keys
                            .iter()
                            .zip(values.chunks(2))
                            .filter_map(|(key, pair)| match pair {
                                [_, Value::Nil] => None,
                                [key_type, size] => {
                                    let size = int(size).max(0) as u64;
                                    (size > floor).then(|| (key, text(key_type), size))
                                }
                                _ => None,
                            })
                            .collect();
                        // 只对可能进入榜单的键再查长度。
                        let mut pipe = redis::pipe();
                        let mut with_length = Vec::new();
                        for (index, (key, key_type, _)) in candidates.iter().enumerate() {
                            if let Some(command) = length_command(key_type) {
                                pipe.cmd(command).arg(*key);
                                with_length.push(index);
                            }
                        }
                        let lengths: Vec<Value> = if with_length.is_empty() {
                            Vec::new()
                        } else {
                            // 键在两次管道之间变更类型时长度查询会报错，按 0 处理。
                            guard.pipeline(&pipe).await.unwrap_or_default()
                        };
                        let length_of: HashMap<usize, u64> = with_length
                            .into_iter()
                            .zip(lengths.iter())
                            .map(|(index, value)| (index, int(value).max(0) as u64))
                            .collect();
                        for (index, (key, key_type, size)) in candidates.into_iter().enumerate() {
                            top.push(RedisBigKey {
                                key: key_info(key),
                                key_type,
                                bytes: size,
                                length: length_of.get(&index).copied().unwrap_or(0),
                            });
                        }
                        top.sort_by(|a, b| b.bytes.cmp(&a.bytes));
                        top.truncate(TOP_KEYS);
                    }
                    drop(guard);
                    scanned += keys.len() as u64;
                    cursor = next;
                    if cursor == 0 {
                        break;
                    }
                    if last_sent.elapsed() >= PROGRESS_INTERVAL {
                        last_sent = Instant::now();
                        send(scanned, &top, false, false, None);
                    }
                }
                Ok(())
            }
            .await;
            let cancelled = cancel.load(Ordering::Relaxed);
            jobs().remove(&job_id);
            send(
                scanned,
                &top,
                true,
                cancelled,
                result.err().map(|error| error.to_string()),
            );
        });
        Ok(job_id)
    }

    /// 订阅使用独立连接；消息按批推送，连接断开时推送 closed。
    pub async fn pubsub_subscribe(
        &self,
        id: &str,
        channels: Vec<String>,
        patterns: Vec<String>,
        on_event: Channel<RedisPubSubEvent>,
    ) -> AppResult<u64> {
        let channels = trimmed(channels);
        let patterns = trimmed(patterns);
        if channels.is_empty() && patterns.is_empty() {
            return Err(AppError::invalid_input("请至少填写一个频道或模式"));
        }
        let (client, timeout) = {
            let session = self.session(id).await?;
            let session = session.lock().await;
            (session.client.clone(), session.timeout())
        };
        let mut pubsub = tokio::time::timeout(timeout, client.get_async_pubsub())
            .await
            .map_err(|_| AppError::new(ErrorKind::Network, "Redis 订阅连接超时"))?
            .map_err(redis_error)?;
        for channel in &channels {
            pubsub.subscribe(channel).await.map_err(redis_error)?;
        }
        for pattern in &patterns {
            pubsub.psubscribe(pattern).await.map_err(redis_error)?;
        }
        let job_id = NEXT_JOB.fetch_add(1, Ordering::Relaxed);
        // 先登记再启动，避免连接立即断开时任务结束早于登记而残留。
        let cancel = Arc::new(AtomicBool::new(false));
        let mut jobs_guard = jobs();
        let task = tauri::async_runtime::spawn(async move {
            let mut stream = pubsub.into_on_message();
            let mut buffer: Vec<RedisPubSubMessage> = Vec::new();
            let mut ticker = tokio::time::interval(PUBSUB_INTERVAL);
            let flush = |buffer: &mut Vec<RedisPubSubMessage>| {
                if !buffer.is_empty() {
                    let _ = on_event.send(RedisPubSubEvent::Messages {
                        items: std::mem::take(buffer),
                    });
                }
            };
            loop {
                tokio::select! {
                    message = stream.next() => {
                        let Some(message) = message else { break };
                        buffer.push(RedisPubSubMessage {
                            channel: message.get_channel_name().to_owned(),
                            pattern: message
                                .from_pattern()
                                .then(|| message.get_pattern::<String>().ok())
                                .flatten(),
                            payload: bytes(message.get_payload_bytes()),
                            received_at: now_ms(),
                        });
                        if buffer.len() >= PUBSUB_BATCH {
                            flush(&mut buffer);
                        }
                    }
                    _ = ticker.tick() => flush(&mut buffer),
                }
            }
            flush(&mut buffer);
            jobs().remove(&job_id);
            let _ = on_event.send(RedisPubSubEvent::Closed {
                error: Some("Redis 订阅连接已断开".to_owned()),
            });
        });
        jobs_guard.insert(
            job_id,
            Job {
                session: id.to_owned(),
                cancel,
                task: Some(task.inner().abort_handle()),
            },
        );
        Ok(job_id)
    }

    pub async fn publish(&self, id: &str, channel: &str, message: &str) -> AppResult<i64> {
        if channel.is_empty() {
            return Err(AppError::invalid_input("频道不能为空"));
        }
        let session = self.session(id).await?;
        let receivers = session
            .lock()
            .await
            .query(redis::cmd("PUBLISH").arg(channel).arg(message))
            .await?;
        Ok(receivers)
    }
}
