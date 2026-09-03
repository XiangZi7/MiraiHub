//! 本地交互式终端。
//!
//! 使用系统 PTY（Windows 为 ConPTY）承载 PowerShell、CMD 或 Git Bash，
//! 并通过 Tauri 事件把原始字节流推给 xterm.js。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

const EVENT_OUTPUT: &str = "local-terminal://output";
const EVENT_STATUS: &str = "local-terminal://status";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTerminalConfig {
    pub shell: LocalShell,
    #[serde(default)]
    pub working_directory: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalShell {
    Powershell,
    Cmd,
    GitBash,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    session_id: String,
    data: String,
    is_stderr: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    session_id: String,
    status: &'static str,
    exit_code: Option<u32>,
    reason: Option<String>,
}

pub struct LocalTerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

impl LocalTerminalSession {
    fn spawn(config: &LocalTerminalConfig) -> AppResult<(Self, Box<dyn Read + Send>)> {
        validate_config(config)?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows.max(1),
                cols: config.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AppError::internal(format!("创建本地 PTY 失败：{error}")))?;

        let mut command = shell_command(config.shell);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if !config.working_directory.trim().is_empty() {
            command.cwd(config.working_directory.trim());
        }

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| AppError::internal(format!("启动本地 Shell 失败：{error}")))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| AppError::internal(format!("读取本地 PTY 失败：{error}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| AppError::internal(format!("写入本地 PTY 失败：{error}")))?;

        Ok((
            Self {
                master: Mutex::new(pair.master),
                writer: Mutex::new(writer),
                child: Mutex::new(child),
            },
            reader,
        ))
    }

    fn write(&self, data: &[u8]) -> AppResult<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| AppError::internal("本地终端写入锁已损坏"))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        let master = self
            .master
            .lock()
            .map_err(|_| AppError::internal("本地终端尺寸锁已损坏"))?;
        master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AppError::internal(format!("调整本地终端尺寸失败：{error}")))
    }

    fn kill(&self) -> AppResult<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| AppError::internal("本地终端进程锁已损坏"))?;
        child.kill()?;
        Ok(())
    }

    fn wait(&self) -> Option<u32> {
        self.child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok())
            .map(|status| status.exit_code())
    }
}

#[derive(Default)]
pub struct LocalTerminalManager {
    sessions: Mutex<HashMap<String, Arc<LocalTerminalSession>>>,
}

impl LocalTerminalManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create(&self, app: AppHandle, config: LocalTerminalConfig) -> AppResult<String> {
        let id = new_session_id();
        let (session, reader) = LocalTerminalSession::spawn(&config)?;
        let session = Arc::new(session);

        self.sessions
            .lock()
            .map_err(|_| AppError::internal("本地终端会话表已损坏"))?
            .insert(id.clone(), Arc::clone(&session));

        pump_output(app, id.clone(), session, reader);
        Ok(id)
    }

    pub fn get(&self, id: &str) -> AppResult<Arc<LocalTerminalSession>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::internal("本地终端会话表已损坏"))?
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::not_found(format!("本地终端会话不存在：{id}")))
    }

    pub fn close(&self, id: &str) -> AppResult<()> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| AppError::internal("本地终端会话表已损坏"))?
            .remove(id);

        if let Some(session) = session {
            let _ = session.kill();
            Ok(())
        } else {
            Err(AppError::not_found(format!("本地终端会话不存在：{id}")))
        }
    }

    pub fn shutdown(&self) {
        let sessions = self
            .sessions
            .lock()
            .map(|mut sessions| {
                sessions
                    .drain()
                    .map(|(_, session)| session)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        for session in sessions {
            let _ = session.kill();
        }
    }
}

fn pump_output(
    app: AppHandle,
    session_id: String,
    session: Arc<LocalTerminalSession>,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let encoder = base64::engine::general_purpose::STANDARD;
        let mut buffer = [0_u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let payload = OutputEvent {
                        session_id: session_id.clone(),
                        data: encoder.encode(&buffer[..read]),
                        is_stderr: false,
                    };
                    if let Err(error) = app.emit(EVENT_OUTPUT, payload) {
                        log::warn!("推送本地终端输出失败：{error}");
                    }
                }
                Err(error) => {
                    log::debug!("本地终端 {session_id} 输出结束：{error}");
                    break;
                }
            }
        }

        let exit_code = session.wait();
        let _ = app.emit(
            EVENT_STATUS,
            StatusEvent {
                session_id,
                status: "disconnected",
                exit_code,
                reason: None,
            },
        );
    });
}

fn validate_config(config: &LocalTerminalConfig) -> AppResult<()> {
    let directory = config.working_directory.trim();
    if directory.is_empty() {
        return Ok(());
    }

    let path = Path::new(directory);
    if !path.exists() {
        return Err(AppError::invalid_input(format!(
            "工作目录不存在：{directory}"
        )));
    }
    if !path.is_dir() {
        return Err(AppError::invalid_input(format!(
            "工作目录不是文件夹：{directory}"
        )));
    }
    Ok(())
}

fn shell_command(shell: LocalShell) -> CommandBuilder {
    match shell {
        LocalShell::Powershell => {
            let mut command = CommandBuilder::new("powershell.exe");
            command.args(["-NoLogo", "-NoExit"]);
            command
        }
        LocalShell::Cmd => CommandBuilder::new("cmd.exe"),
        LocalShell::GitBash => {
            let executable = git_bash_path().unwrap_or_else(|| PathBuf::from("bash.exe"));
            let mut command = CommandBuilder::new(executable);
            command.args(["--login", "-i"]);
            command
        }
    }
}

fn git_bash_path() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"),
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(r"Programs\Git\bin\bash.exe"),
    ];

    candidates.into_iter().find(|path| path.is_file())
}

fn new_session_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("local-{}-{sequence}", now_millis())
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[tauri::command]
pub fn local_terminal_create(
    app: AppHandle,
    manager: tauri::State<'_, LocalTerminalManager>,
    config: LocalTerminalConfig,
) -> AppResult<String> {
    manager.create(app, config)
}

#[tauri::command]
pub fn local_terminal_write(
    manager: tauri::State<'_, LocalTerminalManager>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    manager.get(&session_id)?.write(data.as_bytes())
}

#[tauri::command]
pub fn local_terminal_resize(
    manager: tauri::State<'_, LocalTerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    manager.get(&session_id)?.resize(cols, rows)
}

#[tauri::command]
pub fn local_terminal_close(
    manager: tauri::State<'_, LocalTerminalManager>,
    session_id: String,
) -> AppResult<()> {
    manager.close(&session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_are_unique() {
        assert_ne!(new_session_id(), new_session_id());
    }

    #[test]
    fn validates_working_directory() {
        let config = LocalTerminalConfig {
            shell: LocalShell::Cmd,
            working_directory: std::env::temp_dir().to_string_lossy().into_owned(),
            cols: 80,
            rows: 24,
        };
        assert!(validate_config(&config).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn cmd_pty_round_trips_output() {
        use std::sync::mpsc;
        use std::time::Duration;

        let config = LocalTerminalConfig {
            shell: LocalShell::Cmd,
            working_directory: std::env::temp_dir().to_string_lossy().into_owned(),
            cols: 80,
            rows: 24,
        };
        let (session, mut reader) = LocalTerminalSession::spawn(&config).unwrap();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut chunk = [0_u8; 2048];
            while let Ok(read) = reader.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                if sender.send(chunk[..read].to_vec()).is_err() {
                    return;
                }
            }
        });
        std::thread::sleep(Duration::from_millis(100));
        session.write(b"echo miraihub-local-pty\rexit\r").unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut output = String::new();
        while std::time::Instant::now() < deadline && !output.contains("miraihub-local-pty") {
            if let Ok(chunk) = receiver.recv_timeout(Duration::from_millis(250)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        let _ = session.kill();
        assert!(output.contains("miraihub-local-pty"));
    }
}
