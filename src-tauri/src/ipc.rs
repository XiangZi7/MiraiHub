//! IPC 命令注册表。
//!
//! `generate_handler!` 是宏，必须在一处拿到完整的命令列表，没法真正分散到各模块，
//! 所以把这唯一的调用点单独收在这里：新增命令只改这个文件，
//! `app.rs` 与 `lib.rs` 都不用动。
//!
//! 命令按模块分组，命名前缀与模块对应（`ssh_*`、后续的 `db_*`），
//! 前端在 `src/api/` 下按同样的分组封装。

use tauri::ipc::Invoke;
use tauri::Wry;

use crate::{db, local_terminal, platform, ssh};

/// 构造全部命令的分发闭包，交给 `tauri::Builder::invoke_handler`。
///
/// 返回 `impl Fn` 而不是在 `app.rs` 里直接展开宏：
/// 这样命令清单与应用装配彻底分离，两边各自演进互不干扰。
pub fn handler() -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ---------- 平台 / 窗口 ----------
        platform::commands::open_connection_window,
        platform::commands::open_settings_window,
        platform::commands::app_ready,
        platform::commands::set_window_material,
        platform::commands::set_tray_visible,
        platform::commands::set_minimize_to_tray,
        platform::commands::set_launch_at_startup,
        platform::commands::launch_at_startup_enabled,
        // ---------- SSH：会话 ----------
        ssh::commands::ssh_connect,
        ssh::commands::ssh_disconnect,
        ssh::commands::ssh_list_sessions,
        // ---------- SSH：终端 ----------
        ssh::commands::ssh_open_shell,
        ssh::commands::ssh_write,
        ssh::commands::ssh_resize,
        ssh::commands::ssh_exec,
        ssh::commands::ssh_complete_shell,
        // ---------- SSH：远端信息 ----------
        ssh::commands::ssh_system_stats,
        ssh::commands::ssh_list_directory,
        ssh::commands::ssh_path_exists,
        ssh::commands::ssh_rename_path,
        ssh::commands::ssh_delete_path,
        ssh::commands::ssh_upload_file,
        ssh::commands::ssh_download_file,
        ssh::commands::ssh_pause_transfer,
        ssh::commands::ssh_resume_transfer,
        ssh::commands::ssh_cancel_transfer,
        // ---------- SSH：密钥 ----------
        ssh::commands::ssh_list_keys,
        ssh::commands::ssh_generate_key,
        ssh::commands::ssh_delete_key,
        // ---------- 数据库 ----------
        db::commands::db_test_connection,
        db::commands::db_connect,
        db::commands::db_describe_session,
        db::commands::db_use_database,
        db::commands::db_disconnect,
        db::commands::db_list_databases,
        db::commands::db_list_objects,
        db::commands::db_describe_object,
        db::commands::db_table_detail,
        db::commands::db_routine_detail,
        db::commands::db_create_database,
        db::commands::db_rename_database,
        db::commands::db_drop_database,
        db::commands::db_rename_object,
        db::commands::db_drop_object,
        db::commands::db_count_rows,
        db::commands::db_fetch_rows,
        db::commands::db_mutate_rows,
        db::commands::db_execute,
        db::commands::db_cancel_query,
        db::commands::db_export_sql,
        db::commands::db_import_sql,
        // ---------- 本地终端 ----------
        local_terminal::local_terminal_create,
        local_terminal::local_terminal_write,
        local_terminal::local_terminal_resize,
        local_terminal::local_terminal_close,
    ]
}
