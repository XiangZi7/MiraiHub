//! 数据库 Tauri 命令层。实际逻辑留在 manager/query，便于独立测试。

use tauri::State;

use crate::error::AppResult;

use super::browse;
use super::error::DatabaseError;
use super::manager::DatabaseManager;
use super::metadata;
use super::models::{
    DatabaseColumn, DatabaseConfig, DatabaseExecution, DatabaseExportResult, DatabaseImportResult,
    DatabaseObject, DatabaseObjectKind, DatabaseRoutineDetail, DatabaseRowPage, DatabaseSession,
    DatabaseTableDetail, MutationRequest, MutationResult, RowPageRequest,
};
use super::mutation;
use super::object_ops;
use super::query::{self, DEFAULT_RESULT_ROWS};
use super::transfer;

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
) -> AppResult<DatabaseSession> {
    Ok(manager.connect(config).await?)
}

#[tauri::command]
pub async fn db_describe_session(
    manager: State<'_, DatabaseManager>,
    session_id: String,
) -> AppResult<DatabaseSession> {
    Ok(manager.describe_session(&session_id).await?)
}

#[tauri::command]
pub async fn db_use_database(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    database: String,
) -> AppResult<DatabaseSession> {
    Ok(manager.use_database(&session_id, &database).await?)
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
    let pool = manager.pool(&session_id).await?;
    Ok(metadata::list_objects(&pool).await?)
}

#[tauri::command]
pub async fn db_list_databases(
    manager: State<'_, DatabaseManager>,
    session_id: String,
) -> AppResult<Vec<String>> {
    let pool = manager.pool(&session_id).await?;
    Ok(metadata::list_databases(&pool).await?)
}

#[tauri::command]
pub async fn db_describe_object(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
) -> AppResult<Vec<DatabaseColumn>> {
    let pool = manager.pool(&session_id).await?;
    Ok(metadata::describe_object(&pool, &schema, &name).await?)
}

#[tauri::command]
pub async fn db_table_detail(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
    kind: DatabaseObjectKind,
) -> AppResult<DatabaseTableDetail> {
    let pool = manager.pool(&session_id).await?;
    Ok(metadata::table_detail(&pool, &schema, &name, kind).await?)
}

#[tauri::command]
pub async fn db_routine_detail(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
    kind: DatabaseObjectKind,
    identity: String,
) -> AppResult<DatabaseRoutineDetail> {
    let pool = manager.pool(&session_id).await?;
    Ok(metadata::routine_detail(&pool, &schema, &name, kind, &identity).await?)
}

#[tauri::command]
pub async fn db_create_database(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    name: String,
) -> AppResult<()> {
    let pool = manager.pool(&session_id).await?;
    Ok(object_ops::create_database(&pool, &name).await?)
}

#[tauri::command]
pub async fn db_rename_database(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    old_name: String,
    new_name: String,
) -> AppResult<()> {
    let session = manager.describe_session(&session_id).await?;
    if session.database == old_name {
        return Err(DatabaseError::InvalidInput(
            "不能重命名当前正在使用的数据库，请先切换到其他数据库".to_owned(),
        )
        .into());
    }
    let pool = manager.pool(&session_id).await?;
    Ok(object_ops::rename_database(&pool, &old_name, &new_name).await?)
}

#[tauri::command]
pub async fn db_drop_database(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    name: String,
) -> AppResult<()> {
    let session = manager.describe_session(&session_id).await?;
    if session.database == name {
        return Err(DatabaseError::InvalidInput(
            "不能删除当前正在使用的数据库，请先切换到其他数据库".to_owned(),
        )
        .into());
    }
    let pool = manager.pool(&session_id).await?;
    Ok(object_ops::drop_database(&pool, &name).await?)
}

#[tauri::command]
pub async fn db_rename_object(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
    new_name: String,
    kind: DatabaseObjectKind,
    identity: String,
) -> AppResult<()> {
    let pool = manager.pool(&session_id).await?;
    Ok(object_ops::rename_object(&pool, &schema, &name, &new_name, kind, &identity).await?)
}

#[tauri::command]
pub async fn db_drop_object(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
    kind: DatabaseObjectKind,
    identity: String,
) -> AppResult<()> {
    let pool = manager.pool(&session_id).await?;
    Ok(object_ops::drop_object(&pool, &schema, &name, kind, &identity).await?)
}

#[tauri::command]
pub async fn db_count_rows(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
) -> AppResult<i64> {
    let pool = manager.pool(&session_id).await?;
    Ok(metadata::count_rows(&pool, &schema, &name).await?)
}

#[tauri::command]
pub async fn db_fetch_rows(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    request: RowPageRequest,
) -> AppResult<DatabaseRowPage> {
    let pool = manager.pool(&session_id).await?;
    Ok(browse::fetch_rows(&pool, &request).await?)
}

#[tauri::command]
pub async fn db_mutate_rows(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    request: MutationRequest,
) -> AppResult<MutationResult> {
    let pool = manager.pool(&session_id).await?;
    Ok(mutation::mutate(&pool, &request).await?)
}

#[tauri::command]
pub async fn db_execute(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_secs: Option<u64>,
) -> AppResult<DatabaseExecution> {
    Ok(query::execute(
        &manager,
        &session_id,
        &sql,
        max_rows.unwrap_or(DEFAULT_RESULT_ROWS),
        timeout_secs.unwrap_or(300),
    )
    .await?)
}

#[tauri::command]
pub async fn db_cancel_query(
    manager: State<'_, DatabaseManager>,
    session_id: String,
) -> AppResult<bool> {
    Ok(manager.cancel(&session_id).await?)
}

#[tauri::command]
pub async fn db_export_sql(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    path: String,
    include_data: bool,
    drop_existing: bool,
) -> AppResult<DatabaseExportResult> {
    Ok(transfer::export_sql(&manager, &session_id, &path, include_data, drop_existing).await?)
}

#[tauri::command]
pub async fn db_import_sql(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    path: String,
) -> AppResult<DatabaseImportResult> {
    Ok(transfer::import_sql(&manager, &session_id, &path).await?)
}
