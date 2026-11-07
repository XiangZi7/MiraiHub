use super::{models::*, RedisManager};
use crate::error::AppResult;
use tauri::{ipc::Channel, State};

#[tauri::command]
pub async fn redis_test_connection(
    manager: State<'_, RedisManager>,
    config: RedisConfig,
) -> AppResult<()> {
    manager.test(config).await
}
#[tauri::command]
pub async fn redis_connect(
    manager: State<'_, RedisManager>,
    config: RedisConfig,
) -> AppResult<RedisSession> {
    manager.connect(config).await
}
#[tauri::command]
pub async fn redis_disconnect(
    manager: State<'_, RedisManager>,
    session_id: String,
) -> AppResult<()> {
    manager.disconnect(&session_id).await;
    Ok(())
}
#[tauri::command]
pub async fn redis_use_database(
    manager: State<'_, RedisManager>,
    session_id: String,
    database: String,
) -> AppResult<RedisSession> {
    manager.use_database(&session_id, &database).await
}
#[tauri::command]
pub async fn redis_scan(
    manager: State<'_, RedisManager>,
    session_id: String,
    cursor: String,
    pattern: String,
) -> AppResult<RedisKeyPage> {
    manager.scan(&session_id, &cursor, &pattern).await
}
#[tauri::command]
pub async fn redis_inspect(
    manager: State<'_, RedisManager>,
    session_id: String,
    key: String,
) -> AppResult<RedisKeyDetail> {
    manager.inspect(&session_id, &key).await
}
#[tauri::command]
pub async fn redis_execute(
    manager: State<'_, RedisManager>,
    session_id: String,
    command: String,
) -> AppResult<RedisCommandResult> {
    manager.execute(&session_id, &command).await
}
#[tauri::command]
pub async fn redis_save_string(
    manager: State<'_, RedisManager>,
    session_id: String,
    key: String,
    value: String,
) -> AppResult<()> {
    manager.save_string(&session_id, &key, &value).await
}
#[tauri::command]
pub async fn redis_delete_key(
    manager: State<'_, RedisManager>,
    session_id: String,
    key: String,
) -> AppResult<()> {
    manager.delete_key(&session_id, &key).await
}
#[tauri::command]
pub async fn redis_expire_key(
    manager: State<'_, RedisManager>,
    session_id: String,
    key: String,
    ttl_secs: i64,
) -> AppResult<()> {
    manager.expire_key(&session_id, &key, ttl_secs).await
}
#[tauri::command]
pub async fn redis_collection_page(
    manager: State<'_, RedisManager>,
    session_id: String,
    key: String,
    cursor: String,
    pattern: String,
    count: u32,
) -> AppResult<RedisCollectionPage> {
    manager
        .collection_page(&session_id, &key, &cursor, &pattern, count)
        .await
}
#[tauri::command]
pub async fn redis_collection_write(
    manager: State<'_, RedisManager>,
    session_id: String,
    key: String,
    op: RedisCollectionOp,
    create: bool,
) -> AppResult<u64> {
    manager
        .collection_write(&session_id, &key, op, create)
        .await
}
#[tauri::command]
pub async fn redis_create_string(
    manager: State<'_, RedisManager>,
    session_id: String,
    key: String,
    value: String,
    ttl_secs: i64,
) -> AppResult<()> {
    manager
        .create_string(&session_id, &key, &value, ttl_secs)
        .await
}
#[tauri::command]
pub async fn redis_rename_key(
    manager: State<'_, RedisManager>,
    session_id: String,
    key: String,
    new_name: String,
    overwrite: bool,
) -> AppResult<RedisKey> {
    manager
        .rename_key(&session_id, &key, &new_name, overwrite)
        .await
}
#[tauri::command]
pub async fn redis_preview_pattern(
    manager: State<'_, RedisManager>,
    session_id: String,
    pattern: String,
) -> AppResult<RedisPatternPreview> {
    manager.preview_pattern(&session_id, &pattern).await
}
#[tauri::command]
pub async fn redis_delete_pattern(
    manager: State<'_, RedisManager>,
    session_id: String,
    pattern: String,
) -> AppResult<u64> {
    manager.delete_pattern(&session_id, &pattern).await
}
#[tauri::command]
pub async fn redis_server_info(
    manager: State<'_, RedisManager>,
    session_id: String,
) -> AppResult<Vec<RedisInfoSection>> {
    manager.server_info(&session_id).await
}
#[tauri::command]
pub async fn redis_slowlog(
    manager: State<'_, RedisManager>,
    session_id: String,
    count: u32,
) -> AppResult<RedisSlowlog> {
    manager.slowlog(&session_id, count).await
}
#[tauri::command]
pub async fn redis_slowlog_reset(
    manager: State<'_, RedisManager>,
    session_id: String,
) -> AppResult<()> {
    manager.slowlog_reset(&session_id).await
}
#[tauri::command]
pub async fn redis_big_key_scan(
    manager: State<'_, RedisManager>,
    session_id: String,
    pattern: String,
    on_progress: Channel<RedisBigKeyProgress>,
) -> AppResult<u64> {
    manager
        .big_key_scan(&session_id, &pattern, on_progress)
        .await
}
#[tauri::command]
pub async fn redis_pubsub_subscribe(
    manager: State<'_, RedisManager>,
    session_id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
    on_event: Channel<RedisPubSubEvent>,
) -> AppResult<u64> {
    manager
        .pubsub_subscribe(&session_id, channels, patterns, on_event)
        .await
}
#[tauri::command]
pub async fn redis_publish(
    manager: State<'_, RedisManager>,
    session_id: String,
    channel: String,
    message: String,
) -> AppResult<i64> {
    manager.publish(&session_id, &channel, &message).await
}
/// 取消大 key 扫描或退订；任务已结束时静默忽略。
#[tauri::command]
pub fn redis_stop_job(job_id: u64) {
    super::monitor::stop_job(job_id);
}
