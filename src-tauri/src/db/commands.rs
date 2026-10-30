//! 数据库 Tauri 命令层。实际逻辑留在 manager/query，便于独立测试。

use tauri::State;

use crate::error::AppResult;

use super::browse;
use super::error::DatabaseError;
use super::manager::DatabaseManager;
use super::metadata;
use super::models::{
    DatabaseColumn, DatabaseConfig, DatabaseExecution, DatabaseExportResult, DatabaseImportOptions,
    DatabaseImportResult, DatabaseObject, DatabaseObjectKind, DatabaseRoutineDetail,
    DatabaseRowPage, DatabaseSession, DatabaseTableDetail, DatabaseTableOptions, MutationRequest,
    MutationResult, RowPageRequest, TableAlterOptions,
};
use super::mutation;
use super::object_ops;
use super::query::{self, DEFAULT_RESULT_ROWS};
use super::table_ops;
use super::transfer;

/// 导入弹窗只读取用户选择的本地文件，不向外部服务上传。
#[tauri::command]
pub async fn db_read_import_file(path: String) -> AppResult<Vec<u8>> {
    Ok(super::import_data::read_file(&path).await?)
}

#[tauri::command]
pub async fn db_preview_import_sql(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    path: String,
) -> AppResult<super::import_data::SqlImportPreview> {
    Ok(transfer::preview_import(&manager, &session_id, &path).await?)
}

#[tauri::command]
pub async fn db_import_catalog(
    manager: State<'_, DatabaseManager>,
    session_id: String,
) -> AppResult<Vec<super::import_data::ImportTarget>> {
    Ok(super::import_data::catalog(&manager, &session_id).await?)
}

#[tauri::command]
pub async fn db_import_rows(
    manager: State<'_, DatabaseManager>,
    transfers: State<'_, crate::ssh::TransferManager>,
    app: tauri::AppHandle,
    session_id: String,
    tables: Vec<super::import_data::ImportRowsTable>,
    task_id: String,
) -> AppResult<DatabaseImportResult> {
    Ok(super::import_data::import_rows(
        &manager,
        &session_id,
        &tables,
        &app,
        &task_id,
        transfers.control(&task_id).await?,
    )
    .await?)
}

#[tauri::command]
pub async fn db_fork_session(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    database: String,
) -> AppResult<DatabaseSession> {
    Ok(manager.fork_session(&session_id, &database).await?)
}

#[tauri::command]
pub async fn db_begin_export_file(
    transfers: State<'_, crate::ssh::TransferManager>,
    task_id: String,
) -> AppResult<()> {
    transfers.begin(&task_id, 0).await?;
    Ok(())
}

#[tauri::command]
pub async fn db_finish_export_file(
    transfers: State<'_, crate::ssh::TransferManager>,
    task_id: String,
) -> AppResult<()> {
    super::export_file::discard(&task_id).await;
    transfers.finish(&task_id).await;
    Ok(())
}

#[tauri::command]
pub async fn db_write_export_file(
    app: tauri::AppHandle,
    transfers: State<'_, crate::ssh::TransferManager>,
    task_id: String,
    path: String,
    bytes: Vec<u8>,
    complete: Option<bool>,
) -> AppResult<()> {
    if let Some(complete) = complete {
        super::export_file::write_chunk(&app, &transfers, &task_id, &path, &bytes, complete).await
    } else {
        super::export_file::write(&app, &transfers, &task_id, &path, &bytes).await
    }
}

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
pub async fn db_completion_columns(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
) -> AppResult<Vec<String>> {
    let pool = manager.pool(&session_id).await?;
    Ok(metadata::completion_columns(&pool, &schema).await?)
}

#[tauri::command]
pub async fn db_table_option_choices(
    manager: State<'_, DatabaseManager>,
    session_id: String,
) -> AppResult<table_ops::TableOptionChoices> {
    let pool = manager.pool(&session_id).await?;
    Ok(table_ops::table_option_choices(&pool).await?)
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
pub async fn db_table_options(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
) -> AppResult<Option<DatabaseTableOptions>> {
    let pool = manager.pool(&session_id).await?;
    Ok(table_ops::read_table_options(&pool, &schema, &name).await?)
}

#[tauri::command]
pub async fn db_alter_table_options(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
    options: TableAlterOptions,
) -> AppResult<Vec<String>> {
    let pool = manager.pool(&session_id).await?;
    Ok(table_ops::alter_table_options(&pool, &schema, &name, &options).await?)
}

#[tauri::command]
pub async fn db_truncate_table(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    schema: String,
    name: String,
) -> AppResult<()> {
    let pool = manager.pool(&session_id).await?;
    Ok(table_ops::truncate_table(&pool, &schema, &name).await?)
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
    app: tauri::AppHandle,
    transfers: State<'_, crate::ssh::TransferManager>,
    task_id: Option<String>,
    manager: State<'_, DatabaseManager>,
    session_id: String,
    path: String,
    include_data: bool,
    drop_existing: bool,
    include_structure: Option<bool>,
    include_database: Option<bool>,
) -> AppResult<DatabaseExportResult> {
    let progress = if let Some(task_id) = task_id.as_deref() {
        Some(transfer::ExportProgress {
            app: &app,
            task_id,
            control: transfers.control(task_id).await?,
            rows: std::sync::atomic::AtomicU64::new(0),
        })
    } else {
        None
    };
    Ok(transfer::export_sql(
        &manager,
        &session_id,
        &path,
        include_data,
        drop_existing,
        include_structure.unwrap_or(true),
        include_database.unwrap_or(false),
        progress.as_ref(),
    )
    .await?)
}

#[tauri::command]
pub async fn db_import_sql(
    manager: State<'_, DatabaseManager>,
    session_id: String,
    path: String,
    options: Option<DatabaseImportOptions>,
) -> AppResult<DatabaseImportResult> {
    Ok(transfer::import_sql(&manager, &session_id, &path, &options.unwrap_or_default()).await?)
}
