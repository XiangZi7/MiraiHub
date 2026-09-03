//! 数据库 Tauri 命令层。实际逻辑留在 manager/query，便于独立测试。

use tauri::State;

use crate::error::AppResult;

use super::manager::DatabaseManager;
use super::models::{DatabaseColumn, DatabaseConfig, DatabaseObject, DatabaseQueryResult};
use super::query;

#[tauri::command]
pub async fn db_test_connection(
    manager: State<'_, DatabaseManager>,
    config: DatabaseConfig,
) -> AppResult<()> {
    Ok(manager.test(config).await?)
}

#[tauri::command]
pub async fn db_connect(
    manager: State<'_, DatabaseManager>,
    config: DatabaseConfig,
) -> AppResult<String> {
    Ok(manager.connect(config).await?)
}

#[tauri::command]
pub async fn db_disconnect(
    manager: State<'_, DatabaseManager>,
    session_id: String,
) -> AppResult<()> {
    Ok(manager.disconnect(&session_id).await?)
}

#[tauri::command]
pub async fn db_list_objects(
    manager: State<'_, DatabaseManager>,
    session_id: String,
) -> AppResult<Vec<DatabaseObject>> {
    let pool = manager.get(&session_id).await?;
    Ok(query::list_objects(&pool).await?)
}

#[tauri::command]
pub async fn db_describe_object(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
) -> AppResult<Vec<DatabaseColumn>> {
    let pool = manager.get(&session_id).await?;
    Ok(query::describe_object(&pool, &schema, &name).await?)
}

#[tauri::command]
pub async fn db_execute(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    sql: String,
) -> AppResult<DatabaseQueryResult> {
    let pool = manager.get(&session_id).await?;
    Ok(query::execute(&pool, &sql).await?)
}
