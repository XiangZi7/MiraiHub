use super::{models::*, RedisManager};
use crate::error::AppResult;
use tauri::State;

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
