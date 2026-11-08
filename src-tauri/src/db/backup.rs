//! 原生备份与恢复。
//!
//! 优先调用系统里的 mysqldump/pg_dump（恢复用 mysql/psql），这样例程、触发器、
//! 字符集等细节与官方工具一致；找不到工具时退回内置的 SQL 导出/导入。
//! SQLite 直接生成文件副本。进度通过 `db-backup-progress` 事件推送。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::oneshot;

use super::error::{DatabaseError, DatabaseResult};
use super::manager::{DatabaseManager, DatabasePool};
use super::models::{DatabaseConfig, DatabaseImportOptions, DatabaseKind, DatabaseSslMode};
use super::transfer;

pub const PROGRESS_EVENT: &str = "db-backup-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTool {
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTools {
    /// mysqldump 或 pg_dump。
    pub dump: Option<BackupTool>,
    /// mysql 或 psql。
    pub client: Option<BackupTool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    pub session_id: String,
    pub path: String,
    pub task_id: String,
    /// 用户在设置中指定的工具目录或可执行文件路径。
    #[serde(default)]
    pub tool_dir: Option<String>,
    /// 强制使用内置导出。
    #[serde(default)]
    pub builtin: bool,
    /// pg_dump 用 INSERT 代替 COPY，便于内置导入恢复。
    #[serde(default)]
    pub inserts: bool,
    /// 备份内容：all（默认）/ structure（仅结构）/ data（仅数据）。
    #[serde(default)]
    pub content: Option<String>,
    /// 只备份这些表；为空表示整库。PostgreSQL 传 `schema.table`。
    #[serde(default)]
    pub tables: Vec<String>,
}

impl BackupRequest {
    /// 解析备份内容选项，返回（含结构，含数据）。
    fn content_flags(&self) -> (bool, bool) {
        match self.content.as_deref() {
            Some("structure") => (true, false),
            Some("data") => (false, true),
            _ => (true, true),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    pub session_id: String,
    pub path: String,
    pub task_id: String,
    #[serde(default)]
    pub tool_dir: Option<String>,
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub bytes: u64,
    pub elapsed_ms: u64,
    /// native / builtin / copy
    pub method: &'static str,
    pub tool: Option<String>,
    /// 工具输出的警告（stderr 末尾）。
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    task_id: &'a str,
    bytes: u64,
    total: Option<u64>,
    elapsed_ms: u64,
}

fn cancellers() -> &'static Mutex<HashMap<String, oneshot::Sender<()>>> {
    static CANCELLERS: OnceLock<Mutex<HashMap<String, oneshot::Sender<()>>>> = OnceLock::new();
    CANCELLERS.get_or_init(Default::default)
}

/// 登记一个可取消任务；返回的 guard 在任务结束时自动注销。
struct CancelGuard {
    task_id: String,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = cancellers().lock() {
            map.remove(&self.task_id);
        }
    }
}

fn register_cancel(task_id: &str) -> (CancelGuard, oneshot::Receiver<()>) {
    let (sender, receiver) = oneshot::channel();
    if let Ok(mut map) = cancellers().lock() {
        map.insert(task_id.to_owned(), sender);
    }
    (
        CancelGuard {
            task_id: task_id.to_owned(),
        },
        receiver,
    )
}

pub fn cancel(task_id: &str) -> bool {
    let sender = cancellers()
        .lock()
        .ok()
        .and_then(|mut map| map.remove(task_id));
    sender.is_some_and(|sender| sender.send(()).is_ok())
}

fn tool_names(kind: DatabaseKind) -> (&'static str, &'static str) {
    match kind {
        DatabaseKind::Mysql => ("mysqldump", "mysql"),
        DatabaseKind::Postgresql => ("pg_dump", "psql"),
        DatabaseKind::Sqlite => ("", ""),
    }
}

fn executable(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

/// 常见安装目录。Windows 上 MySQL/PostgreSQL 安装器默认不改 PATH。
fn common_dirs(kind: DatabaseKind) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    /// 列出 root 下以 prefix 开头的版本目录的 bin 子目录。
    fn versioned(root: &str, prefix: &str) -> Vec<PathBuf> {
        let Ok(entries) = std::fs::read_dir(root) else {
            return Vec::new();
        };
        let mut found: Vec<PathBuf> = entries
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .starts_with(prefix)
            })
            .map(|entry| entry.path().join("bin"))
            .collect();
        // 版本号大的排前面。
        found.sort();
        found.reverse();
        found
    }
    if cfg!(windows) {
        for root in ["C:\\Program Files", "C:\\Program Files (x86)"] {
            match kind {
                DatabaseKind::Mysql => {
                    dirs.extend(versioned(&format!("{root}\\MySQL"), "mysql"));
                    dirs.extend(versioned(root, "mariadb"));
                }
                DatabaseKind::Postgresql => dirs.extend(versioned(&format!("{root}\\PostgreSQL"), "")),
                DatabaseKind::Sqlite => {}
            }
        }
    } else {
        match kind {
            DatabaseKind::Mysql => {
                for dir in [
                    "/opt/homebrew/opt/mysql-client/bin",
                    "/usr/local/opt/mysql-client/bin",
                    "/usr/local/mysql/bin",
                ] {
                    dirs.push(PathBuf::from(dir));
                }
            }
            DatabaseKind::Postgresql => {
                for dir in [
                    "/opt/homebrew/opt/libpq/bin",
                    "/usr/local/opt/libpq/bin",
                    "/Applications/Postgres.app/Contents/Versions/latest/bin",
                ] {
                    dirs.push(PathBuf::from(dir));
                }
                dirs.extend(versioned("/usr/lib/postgresql", ""));
            }
            DatabaseKind::Sqlite => {}
        }
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            dirs.push(PathBuf::from(dir));
        }
    }
    dirs
}

fn find_tool(kind: DatabaseKind, name: &str, custom: Option<&str>) -> Option<PathBuf> {
    if name.is_empty() {
        return None;
    }
    let file = executable(name);
    if let Some(custom) = custom.map(str::trim).filter(|value| !value.is_empty()) {
        let custom = PathBuf::from(custom);
        // 允许直接填可执行文件：取其所在目录再找同目录下的另一个工具。
        let dir = if custom.is_file() {
            custom.parent().map(Path::to_path_buf)
        } else {
            Some(custom)
        };
        if let Some(candidate) = dir.map(|dir| dir.join(&file)).filter(|path| path.is_file()) {
            return Some(candidate);
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(&file);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    common_dirs(kind)
        .into_iter()
        .map(|dir| dir.join(&file))
        .find(|path| path.is_file())
}

fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.kill_on_drop(true);
    command
}

async fn tool_version(path: &Path) -> String {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        command(path).arg("--version").stdin(Stdio::null()).output(),
    )
    .await;
    match output {
        Ok(Ok(output)) => String::from_utf8_lossy(&output.stdout).trim().to_owned(),
        _ => String::new(),
    }
}

async fn describe_tool(path: Option<PathBuf>) -> Option<BackupTool> {
    let path = path?;
    Some(BackupTool {
        version: tool_version(&path).await,
        path: path.to_string_lossy().into_owned(),
    })
}

pub async fn detect_tools(kind: DatabaseKind, custom: Option<&str>) -> BackupTools {
    let (dump, client) = tool_names(kind);
    BackupTools {
        dump: describe_tool(find_tool(kind, dump, custom)).await,
        client: describe_tool(find_tool(kind, client, custom)).await,
    }
}

async fn session_config(manager: &DatabaseManager, id: &str) -> DatabaseResult<DatabaseConfig> {
    let session = manager.describe_session(id).await?;
    let (config, _) = manager.agent_config(id, &session.database).await?;
    Ok(config)
}

fn emit(app: &tauri::AppHandle, task_id: &str, bytes: u64, total: Option<u64>, started: Instant) {
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            task_id,
            bytes,
            total,
            elapsed_ms: started.elapsed().as_millis() as u64,
        },
    );
}

/// 给工具进程设置连接参数。密码只走环境变量，不出现在命令行里。
fn apply_connection(command: &mut Command, config: &DatabaseConfig) {
    match config.kind {
        DatabaseKind::Mysql => {
            command
                .arg(format!("--host={}", config.host))
                .arg(format!("--port={}", config.port))
                .arg(format!("--user={}", config.username))
                .env("MYSQL_PWD", &config.password);
        }
        DatabaseKind::Postgresql => {
            let ssl = match config.ssl_mode {
                DatabaseSslMode::Disable => "disable",
                DatabaseSslMode::Prefer => "prefer",
                DatabaseSslMode::Require => "require",
                DatabaseSslMode::VerifyCa => "verify-ca",
                DatabaseSslMode::VerifyFull => "verify-full",
            };
            command
                .arg(format!("--host={}", config.host))
                .arg(format!("--port={}", config.port))
                .arg(format!("--username={}", config.username))
                .arg("--no-password")
                .env("PGPASSWORD", &config.password)
                .env("PGSSLMODE", ssl);
            if !config.ca_certificate.is_empty() {
                command.env("PGSSLROOTCERT", &config.ca_certificate);
            }
            if !config.client_certificate.is_empty() {
                command.env("PGSSLCERT", &config.client_certificate);
            }
            if !config.client_key.is_empty() {
                command.env("PGSSLKEY", &config.client_key);
            }
        }
        DatabaseKind::Sqlite => {}
    }
}

fn tail(text: &[u8]) -> String {
    let text = String::from_utf8_lossy(text);
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| {
            // mysqldump 用 MYSQL_PWD 时会提示不安全，这条对用户没有意义。
            !line.contains("Using a password on the command line")
                && !line.contains("MYSQL_PWD")
                && !line.trim().is_empty()
        })
        .collect();
    let start = lines.len().saturating_sub(12);
    lines[start..].join("\n")
}

pub async fn backup(
    manager: &DatabaseManager,
    app: &tauri::AppHandle,
    request: &BackupRequest,
) -> DatabaseResult<BackupResult> {
    let path = request.path.trim();
    if path.is_empty() {
        return Err(DatabaseError::InvalidInput("备份文件路径不能为空".to_owned()));
    }
    let config = session_config(manager, &request.session_id).await?;
    let started = Instant::now();
    let (_guard, cancelled) = register_cancel(&request.task_id);

    if config.kind == DatabaseKind::Sqlite {
        return backup_sqlite(manager, &request.session_id, &config, path, started).await;
    }

    let (dump_name, _) = tool_names(config.kind);
    let tool = (!request.builtin)
        .then(|| find_tool(config.kind, dump_name, request.tool_dir.as_deref()))
        .flatten();
    let Some(tool) = tool else {
        return backup_builtin(manager, request, path, started).await;
    };

    let (structure, data) = request.content_flags();
    let database = manager.describe_session(&request.session_id).await?.database;
    let mut cmd = command(&tool);
    apply_connection(&mut cmd, &config);
    match config.kind {
        DatabaseKind::Mysql => {
            cmd.args([
                "--single-transaction",
                "--hex-blob",
                "--default-character-set=utf8mb4",
            ]);
            // 仅数据时不带例程/触发器/事件定义，避免恢复时重复创建。
            if structure {
                cmd.args(["--routines", "--triggers", "--events"]);
            }
            if !structure {
                cmd.arg("--no-create-info");
            }
            if !data {
                cmd.arg("--no-data");
            }
            cmd.arg(format!("--result-file={path}"))
                .arg(&database)
                .args(&request.tables);
        }
        DatabaseKind::Postgresql => {
            cmd.args(["--format=plain", "--no-owner", "--encoding=UTF8"])
                .arg(format!("--file={path}"))
                .arg(format!("--dbname={database}"));
            if request.inserts && data {
                cmd.arg("--inserts");
            }
            if !structure {
                cmd.arg("--data-only");
            }
            if !data {
                cmd.arg("--schema-only");
            }
            for table in &request.tables {
                cmd.arg(format!("--table={table}"));
            }
        }
        DatabaseKind::Sqlite => unreachable!(),
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|source| DatabaseError::Io {
        operation: "启动备份工具",
        path: tool.to_string_lossy().into_owned(),
        source,
    })?;
    let mut stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.read_to_end(&mut buffer).await;
        }
        buffer
    });

    let mut ticker = tokio::time::interval(Duration::from_millis(500));
    tokio::pin!(cancelled);
    let status = loop {
        tokio::select! {
            status = child.wait() => break status,
            _ = &mut cancelled => {
                let _ = child.kill().await;
                let _ = tokio::fs::remove_file(path).await;
                return Err(DatabaseError::Cancelled);
            }
            _ = ticker.tick() => {
                let bytes = tokio::fs::metadata(path).await.map(|meta| meta.len()).unwrap_or(0);
                emit(app, &request.task_id, bytes, None, started);
            }
        }
    }
    .map_err(|source| DatabaseError::Io {
        operation: "等待备份工具",
        path: tool.to_string_lossy().into_owned(),
        source,
    })?;
    let message = tail(&stderr_task.await.unwrap_or_default());
    if !status.success() {
        let _ = tokio::fs::remove_file(path).await;
        return Err(DatabaseError::InvalidInput(format!(
            "{} 退出码 {}：{}",
            dump_name,
            status.code().unwrap_or(-1),
            if message.is_empty() { "无输出".to_owned() } else { message }
        )));
    }
    let bytes = tokio::fs::metadata(path).await.map(|meta| meta.len()).unwrap_or(0);
    emit(app, &request.task_id, bytes, Some(bytes), started);
    Ok(BackupResult {
        path: path.to_owned(),
        bytes,
        elapsed_ms: started.elapsed().as_millis() as u64,
        method: "native",
        tool: Some(tool.to_string_lossy().into_owned()),
        message,
    })
}

async fn backup_builtin(
    manager: &DatabaseManager,
    request: &BackupRequest,
    path: &str,
    started: Instant,
) -> DatabaseResult<BackupResult> {
    if !request.tables.is_empty() {
        return Err(DatabaseError::InvalidInput(
            "内置导出不支持按表备份，请配置 mysqldump/pg_dump 或改为备份整库".to_owned(),
        ));
    }
    let (structure, data) = request.content_flags();
    let result = transfer::export_sql(
        manager,
        &request.session_id,
        path,
        transfer::SqlExportOptions {
            include_data: data,
            drop_existing: structure,
            include_structure: structure,
            include_database: false,
        },
        None,
    )
    .await?;
    Ok(BackupResult {
        path: result.path,
        bytes: result.bytes,
        elapsed_ms: started.elapsed().as_millis() as u64,
        method: "builtin",
        tool: None,
        message: format!("未找到原生备份工具，已用内置导出（{} 个对象，{} 行）", result.objects, result.rows),
    })
}

async fn backup_sqlite(
    manager: &DatabaseManager,
    session_id: &str,
    config: &DatabaseConfig,
    path: &str,
    started: Instant,
) -> DatabaseResult<BackupResult> {
    let source = config.host.trim();
    if Path::new(source) == Path::new(path) {
        return Err(DatabaseError::InvalidInput("备份文件不能覆盖数据库文件本身".to_owned()));
    }
    let _ = tokio::fs::remove_file(path).await;
    // VACUUM INTO 能拿到包含 WAL 内容的一致副本；老版本 SQLite 不支持时直接复制文件。
    let vacuum = match manager.pool(session_id).await? {
        DatabasePool::Sqlite(pool) => sqlx::query("VACUUM INTO ?")
            .bind(path)
            .execute(&pool)
            .await
            .is_ok(),
        _ => false,
    };
    if !vacuum {
        tokio::fs::copy(source, path)
            .await
            .map_err(|source_error| DatabaseError::Io {
                operation: "复制",
                path: source.to_owned(),
                source: source_error,
            })?;
    }
    let bytes = tokio::fs::metadata(path).await.map(|meta| meta.len()).unwrap_or(0);
    Ok(BackupResult {
        path: path.to_owned(),
        bytes,
        elapsed_ms: started.elapsed().as_millis() as u64,
        method: "copy",
        tool: None,
        message: String::new(),
    })
}

pub async fn restore(
    manager: &DatabaseManager,
    app: &tauri::AppHandle,
    request: &RestoreRequest,
) -> DatabaseResult<BackupResult> {
    let path = request.path.trim();
    let config = session_config(manager, &request.session_id).await?;
    let started = Instant::now();
    let total = tokio::fs::metadata(path)
        .await
        .map_err(|source| DatabaseError::Io {
            operation: "读取",
            path: path.to_owned(),
            source,
        })?
        .len();

    if config.kind == DatabaseKind::Sqlite {
        let mut header = [0u8; 16];
        if let Ok(mut file) = tokio::fs::File::open(path).await {
            let _ = file.read_exact(&mut header).await;
        }
        if &header == b"SQLite format 3\0" {
            return Err(DatabaseError::InvalidInput(
                "这是 SQLite 数据库文件，请断开连接后直接用它替换原文件，或新建连接打开它".to_owned(),
            ));
        }
    }

    let (_, client_name) = tool_names(config.kind);
    let tool = (!request.builtin)
        .then(|| find_tool(config.kind, client_name, request.tool_dir.as_deref()))
        .flatten();
    let Some(tool) = tool else {
        let result = transfer::import_sql(
            manager,
            &request.session_id,
            path,
            &DatabaseImportOptions::default(),
        )
        .await?;
        emit(app, &request.task_id, total, Some(total), started);
        return Ok(BackupResult {
            path: path.to_owned(),
            bytes: total,
            elapsed_ms: started.elapsed().as_millis() as u64,
            method: "builtin",
            tool: None,
            message: format!("已用内置导入执行 {} 条语句", result.statements),
        });
    };

    let (_guard, cancelled) = register_cancel(&request.task_id);
    let database = manager.describe_session(&request.session_id).await?.database;
    let mut cmd = command(&tool);
    apply_connection(&mut cmd, &config);
    match config.kind {
        DatabaseKind::Mysql => {
            cmd.arg("--default-character-set=utf8mb4").arg(&database);
        }
        DatabaseKind::Postgresql => {
            cmd.args(["--quiet", "--set=ON_ERROR_STOP=1"])
                .arg(format!("--dbname={database}"));
        }
        DatabaseKind::Sqlite => unreachable!(),
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|source| DatabaseError::Io {
        operation: "启动恢复工具",
        path: tool.to_string_lossy().into_owned(),
        source,
    })?;
    let mut stdin = child.stdin.take();
    let mut stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.read_to_end(&mut buffer).await;
        }
        buffer
    });

    // 自己把文件灌进 stdin，顺便统计进度。
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|source| DatabaseError::Io {
            operation: "读取",
            path: path.to_owned(),
            source,
        })?;
    let mut buffer = vec![0u8; 256 * 1024];
    let mut sent = 0u64;
    let mut last_emit = Instant::now();
    tokio::pin!(cancelled);
    while let Some(writer) = stdin.as_mut() {
        let read = tokio::select! {
            read = file.read(&mut buffer) => read.map_err(|source| DatabaseError::Io {
                operation: "读取",
                path: path.to_owned(),
                source,
            })?,
            _ = &mut cancelled => {
                let _ = child.kill().await;
                return Err(DatabaseError::Cancelled);
            }
        };
        if read == 0 {
            break;
        }
        // 写失败通常是工具已因错误退出，交给下面的退出码处理。
        let write = tokio::select! {
            write = writer.write_all(&buffer[..read]) => write,
            _ = &mut cancelled => {
                let _ = child.kill().await;
                return Err(DatabaseError::Cancelled);
            }
        };
        if write.is_err() {
            break;
        }
        sent += read as u64;
        if last_emit.elapsed() >= Duration::from_millis(300) {
            last_emit = Instant::now();
            emit(app, &request.task_id, sent, Some(total), started);
        }
    }
    drop(stdin);

    let status = tokio::select! {
        status = child.wait() => status,
        _ = &mut cancelled => {
            let _ = child.kill().await;
            return Err(DatabaseError::Cancelled);
        }
    }
    .map_err(|source| DatabaseError::Io {
        operation: "等待恢复工具",
        path: tool.to_string_lossy().into_owned(),
        source,
    })?;
    let message = tail(&stderr_task.await.unwrap_or_default());
    if !status.success() {
        return Err(DatabaseError::InvalidInput(format!(
            "{} 退出码 {}：{}",
            client_name,
            status.code().unwrap_or(-1),
            if message.is_empty() { "无输出".to_owned() } else { message }
        )));
    }
    emit(app, &request.task_id, total, Some(total), started);
    Ok(BackupResult {
        path: path.to_owned(),
        bytes: total,
        elapsed_ms: started.elapsed().as_millis() as u64,
        method: "native",
        tool: Some(tool.to_string_lossy().into_owned()),
        message,
    })
}
