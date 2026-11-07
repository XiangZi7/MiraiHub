//! 单个 SSH 会话：连接、认证、交互式 shell、执行命令。
//!
//! 一个 `SshSession` 对应一条 TCP 连接上的 SSH 传输层。
//! 交互式 shell 与 exec 各自开独立的 channel，互不干扰。

use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, DisconnectReason, Handle, KeyboardInteractiveAuthResponse, Msg};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Disconnect, MethodKind, MethodSet};
use russh_sftp::client::SftpSession;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

use super::error::{SshError, SshResult};
use super::events::{emit_status, StatusEvent};
use super::known_hosts::{self, HostKeyCheck};
use super::liveness::{self, LinkState};
use super::models::{AuthMethod, CommandOutput, PtyOptions, SshConfig};
use super::prompt::{
    self, timeout_excluding_prompts, AuthPrompt, AuthPromptField, HostKeyPrompt, PauseClock,
    Prompter,
};
use super::proxy;
use super::sftp_stream::SftpStream;

/// Shared by all uploads and downloads on this SSH connection, including extra channels.
const MAX_TRANSFER_CHANNELS: usize = 4;
/// Reserve room for shell/exec channels even while path checks and transfers overlap.
const MAX_METADATA_CHANNELS: usize = 2;
/// 键盘交互认证最多来回的轮数，防止服务端无限追问。
const MAX_KEYBOARD_INTERACTIVE_ROUNDS: usize = 12;

/// 连接事件处理器。
///
/// 主机密钥：已记录且一致直接放行；未知或变化时弹窗让用户决定（无前端时未知主机沿用 TOFU，变化一律拒绝）。
/// 连接结束时（russh 后台任务退出、处理器被丢弃）通过 `link` 通知会话表清理。
struct ClientHandler {
    host: String,
    port: u16,
    verify_host_key: bool,
    link: Arc<LinkState>,
    clock: Arc<PauseClock>,
    prompter: Option<Arc<Prompter>>,
    /// 测试用：覆盖 ~/.ssh/known_hosts
    known_hosts: Option<std::path::PathBuf>,
}

impl ClientHandler {
    fn new(config: &SshConfig, prompter: Option<Arc<Prompter>>) -> Self {
        Self {
            host: config.host.clone(),
            port: config.port,
            verify_host_key: config.verify_host_key,
            link: Arc::default(),
            clock: Arc::default(),
            prompter,
            known_hosts: None,
        }
    }

    fn endpoint(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

impl Drop for ClientHandler {
    fn drop(&mut self) {
        self.link.mark_closed();
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = known_hosts::fingerprint(server_public_key);
        if !self.verify_host_key {
            log::warn!(
                "已按设置跳过 {} 的主机密钥校验（{fingerprint}）",
                self.endpoint()
            );
            return Ok(true);
        }

        let path = match &self.known_hosts {
            Some(path) => path.clone(),
            None => known_hosts::default_path()?,
        };
        let old_fingerprint =
            match known_hosts::check(&self.host, self.port, server_public_key, &path)? {
                HostKeyCheck::Trusted => return Ok(true),
                HostKeyCheck::Unknown => None,
                HostKeyCheck::Changed { old_fingerprint } => Some(old_fingerprint),
            };
        let changed = old_fingerprint.is_some();

        let Some(prompter) = self.prompter.clone() else {
            if changed {
                log::warn!("{} 的主机密钥已变化（{fingerprint}），拒绝连接", self.endpoint());
                self.link.decline(format!(
                    "{} 的主机密钥与 known_hosts 记录不一致，已拒绝连接",
                    self.endpoint()
                ));
                return Ok(false);
            }
            known_hosts::learn(&self.host, self.port, server_public_key, &path)?;
            log::info!("首次信任并记录 {} 的主机密钥（{fingerprint}）", self.endpoint());
            return Ok(true);
        };

        let request = HostKeyPrompt {
            host: self.host.clone(),
            port: self.port,
            algorithm: server_public_key.algorithm().to_string(),
            fingerprint: fingerprint.clone(),
            status: if changed { "changed" } else { "unknown" },
            old_fingerprint: old_fingerprint.flatten(),
        };
        match self.clock.pause(prompter.host_key(request)).await {
            Ok(decision) if decision.accept => {
                if decision.remember {
                    let saved = if changed {
                        known_hosts::replace(&self.host, self.port, server_public_key, &path)
                    } else {
                        known_hosts::learn(&self.host, self.port, server_public_key, &path)
                    };
                    match saved {
                        Ok(()) => log::info!(
                            "用户信任并记录 {} 的主机密钥（{fingerprint}）",
                            self.endpoint()
                        ),
                        // 写不进 known_hosts 不影响本次连接，下次会再问
                        Err(error) => log::warn!("写入 known_hosts 失败：{error}"),
                    }
                } else {
                    log::info!("用户仅本次信任 {} 的主机密钥（{fingerprint}）", self.endpoint());
                }
                Ok(true)
            }
            Ok(_) => {
                self.link
                    .decline(format!("已拒绝 {} 的主机密钥，连接已取消", self.endpoint()));
                Ok(false)
            }
            Err(reason) => {
                self.link.decline(format!("主机密钥未确认：{reason}"));
                Ok(false)
            }
        }
    }

    async fn disconnected(
        &mut self,
        reason: DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        let readable = liveness::describe(&reason);
        log::info!("SSH 连接 {} 已结束：{readable}", self.endpoint());
        self.link.set_reason(readable);
        // 与默认实现一致：错误继续向 join 传递
        match reason {
            DisconnectReason::ReceivedDisconnect(_) => Ok(()),
            DisconnectReason::Error(error) => Err(error),
        }
    }
}

/// 一个已建立的 SSH 会话。
pub struct SshSession {
    id: String,
    config: SshConfig,
    jump_handles: Mutex<Vec<Handle<ClientHandler>>>,
    /// russh 的连接句柄。开新 channel 时用，故加锁
    handle: Mutex<Handle<ClientHandler>>,
    /// 交互式 shell 的写半边。未开 shell 时为 None
    shell: Mutex<Option<ChannelWriteHalf<Msg>>>,
    transfer_slots: Arc<Semaphore>,
    metadata_slots: Arc<Semaphore>,
    /// 目标机连接的存活状态，会话表靠它发现死会话
    link: Arc<LinkState>,
}

impl SshSession {
    /// 建立连接并完成认证。
    pub async fn connect(id: String, config: SshConfig) -> SshResult<Self> {
        Self::connect_report(id, config, None).await
    }

    /// 将每一跳的连接状态推送给发起请求的终端，事件不包含认证信息。
    pub async fn connect_report(
        id: String,
        config: SshConfig,
        progress: Option<(AppHandle, String)>,
    ) -> SshResult<Self> {
        validate_config(&config)?;
        if config.jump_hosts.len() > 5
            || config
                .jump_hosts
                .iter()
                .any(|hop| !hop.jump_hosts.is_empty())
            || (!config.jump_hosts.is_empty() && config.proxy.is_some())
        {
            return Err(SshError::InvalidInput(
                "跳板链最多 5 跳且不能嵌套；目标代理与跳板不能同时使用".into(),
            ));
        }
        let mut endpoints = std::collections::HashSet::new();
        for (index, hop) in config.jump_hosts.iter().enumerate() {
            validate_config(hop)?;
            if !endpoints.insert((hop.host.to_lowercase(), hop.port))
                || (hop.host.eq_ignore_ascii_case(&config.host) && hop.port == config.port)
                || (index > 0 && hop.proxy.is_some())
            {
                return Err(SshError::InvalidInput(
                    "跳板链存在重复目标或中间跳配置了代理".into(),
                ));
            }
        }
        let mut jump_handles = Vec::new();
        // 首次连接前由命令层安装；没有时（测试、后台任务早于主窗口）按无前端处理
        let prompter = prompt::global();
        let report = |index: usize, endpoint: String, status: &str| {
            if let Some((app, request_id)) = &progress {
                let _ = app.emit("ssh://connect-progress", serde_json::json!({"requestId": request_id, "hop": index, "total": config.jump_hosts.len() + 1, "endpoint": endpoint, "status": status}));
            }
        };
        for (index, hop) in config.jump_hosts.iter().enumerate() {
            report(index, hop.endpoint(), "connecting");
            match connect_handle(hop, jump_handles.last(), prompter.as_ref()).await {
                Ok((handle, _)) => {
                    jump_handles.push(handle);
                    report(index, hop.endpoint(), "connected");
                }
                Err(error) => {
                    report(index, hop.endpoint(), "failed");
                    return Err(error);
                }
            }
        }
        report(config.jump_hosts.len(), config.endpoint(), "connecting");
        let (handle, link) =
            match connect_handle(&config, jump_handles.last(), prompter.as_ref()).await {
                Ok(connected) => {
                    report(config.jump_hosts.len(), config.endpoint(), "connected");
                    connected
                }
                Err(error) => {
                    report(config.jump_hosts.len(), config.endpoint(), "failed");
                    return Err(error);
                }
            };
        log::info!(
            "SSH 已连接：{}（{} 跳）",
            config.endpoint(),
            jump_handles.len()
        );

        Ok(Self {
            id,
            config,
            jump_handles: Mutex::new(jump_handles),
            handle: Mutex::new(handle),
            shell: Mutex::new(None),
            transfer_slots: Arc::new(Semaphore::new(MAX_TRANSFER_CHANNELS)),
            metadata_slots: Arc::new(Semaphore::new(MAX_METADATA_CHANNELS)),
            link,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    /// 连接存活状态，会话表据此清理死会话。
    pub(crate) fn link(&self) -> Arc<LinkState> {
        self.link.clone()
    }

    /// 连接已死时释放额度，唤醒排队中的传输。
    pub(crate) fn release(&self) {
        self.transfer_slots.close();
        self.metadata_slots.close();
    }

    /// 目标连接意外断开后的清理：释放额度并关掉仍然活着的跳板连接。
    pub(crate) async fn abandon(&self) {
        self.release();
        for hop in self.jump_handles.lock().await.drain(..).rev() {
            let _ = hop
                .disconnect(Disconnect::ByApplication, "目标连接已断开", "")
                .await;
        }
    }

    pub fn config(&self) -> &SshConfig {
        &self.config
    }

    /// 打开带 PTY 的交互式 shell，并起一个后台任务把输出推给前端。
    pub async fn open_shell(
        &self,
        app: AppHandle,
        pty: PtyOptions,
        output: Channel<InvokeResponseBody>,
    ) -> SshResult<()> {
        let channel = {
            let handle = self.handle.lock().await;
            handle.channel_open_session().await?
        };

        channel
            .request_pty(
                false,
                &pty.term,
                pty.cols,
                pty.rows,
                // 像素尺寸传 0：远端按字符数排版，给 0 表示"未知"，是通行做法
                0,
                0,
                &[],
            )
            .await?;

        channel.request_shell(false).await?;

        // 拆成读写两半：读半边独占给后台循环，写半边留在会话里接用户输入。
        // 不拆的话读循环会一直借着 &mut channel，输入就没法写进去
        let (read_half, write_half) = channel.split();

        // 先登记写端，再起读循环：
        // 反过来的话读循环可能先收到输出并推给前端，而此时用户的输入还写不进去
        {
            let mut shell = self.shell.lock().await;
            *shell = Some(write_half);
        }

        let session_id = self.id.clone();
        let link = self.link.clone();

        tokio::spawn(async move {
            pump_output(app, session_id, read_half, output, link).await;
        });

        Ok(())
    }

    /// 向 shell 写入用户输入。
    pub async fn write(&self, data: &[u8]) -> SshResult<()> {
        let shell = self.shell.lock().await;
        let shell = shell
            .as_ref()
            .ok_or_else(|| SshError::InvalidInput("会话还没有打开 shell".into()))?;

        shell.data(data).await?;
        Ok(())
    }

    /// 同步终端尺寸。
    pub async fn resize(&self, cols: u32, rows: u32) -> SshResult<()> {
        let shell = self.shell.lock().await;
        let shell = shell
            .as_ref()
            .ok_or_else(|| SshError::InvalidInput("会话还没有打开 shell".into()))?;

        shell.window_change(cols, rows, 0, 0).await?;
        Ok(())
    }

    /// 执行单条命令，等它跑完并收集全部输出。
    ///
    /// 走独立 channel，不影响交互式 shell。
    pub async fn exec(&self, command: &str) -> SshResult<CommandOutput> {
        let mut channel = {
            let handle = self.handle.lock().await;
            handle.channel_open_session().await?
        };

        channel.exec(true, command).await?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = None;

        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                // ext == 1 是 stderr，其余扩展类型按协议保留，忽略即可
                ChannelMsg::ExtendedData { data, ext: 1 } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }

        Ok(CommandOutput {
            // 命令输出按 UTF-8 解，非法字节用替换字符顶掉而不是报错：
            // 远端可能输出任意编码，为此让整条命令失败不合理
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            exit_code,
        })
    }

    /// AI uses a separate channel with a deadline and bounded output.
    pub async fn exec_agent(&self, command: &str) -> SshResult<CommandOutput> {
        let mut channel = self.handle.lock().await.channel_open_session().await?;
        channel.exec(true, command).await?;
        let read = async {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut exit_code = None;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => stdout.extend_from_slice(
                        &data[..data
                            .len()
                            .min(16384usize.saturating_sub(stdout.len() + stderr.len()))],
                    ),
                    ChannelMsg::ExtendedData { data, ext: 1 } => stderr.extend_from_slice(
                        &data[..data
                            .len()
                            .min(16384usize.saturating_sub(stdout.len() + stderr.len()))],
                    ),
                    ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                    ChannelMsg::Close => break,
                    _ => {}
                }
                if stdout.len() + stderr.len() >= 16384 {
                    stderr.extend_from_slice(b"\n[Output limit reached; channel closed]");
                    break;
                }
            }
            CommandOutput {
                stdout: String::from_utf8_lossy(&stdout).into_owned(),
                stderr: String::from_utf8_lossy(&stderr).into_owned(),
                exit_code,
            }
        };
        let result = tokio::time::timeout(Duration::from_secs(30), read).await;
        let _ = channel.close().await;
        result.map_err(|_| {
            SshError::InvalidInput("AI 命令超过 30 秒；已关闭通道，远端进程可能仍在运行".into())
        })
    }

    pub async fn is_closed(&self) -> bool {
        self.handle.lock().await.is_closed()
    }

    pub async fn forward_stream(
        &self,
        host: &str,
        port: u16,
        origin: std::net::SocketAddr,
    ) -> SshResult<russh::ChannelStream<Msg>> {
        let channel = self
            .handle
            .lock()
            .await
            .channel_open_direct_tcpip(
                host,
                port as u32,
                origin.ip().to_string(),
                origin.port() as u32,
            )
            .await?;
        Ok(channel.into_stream())
    }

    pub async fn open_raw_sftp(&self) -> SshResult<russh_sftp::client::RawSftpSession> {
        let permit = self.acquire_sftp_slot(&self.metadata_slots).await?;
        let stream = self.open_sftp_stream(permit, true).await?;
        Ok(russh_sftp::client::RawSftpSession::new(stream))
    }

    /// 为文件检查和编辑操作打开独立通道，使用预留的元数据额度。
    pub async fn open_sftp(&self) -> SshResult<SftpSession> {
        let permit = self.acquire_sftp_slot(&self.metadata_slots).await?;
        self.open_sftp_with(
            russh_sftp::client::Config {
                request_timeout_secs: 30,
                ..Default::default()
            },
            permit,
            true,
        )
        .await
    }

    /// 等待此连接共享的传输额度；调用方可以在排队期间取消。
    pub async fn reserve_transfer_channel(&self) -> SshResult<OwnedSemaphorePermit> {
        self.acquire_sftp_slot(&self.transfer_slots).await
    }

    /// 供批量传输使用的 SFTP 通道：放宽单个请求的超时。
    ///
    /// 传输时同一通道上会排着几 MB 的数据，元数据请求（改名、关闭）要等前面的数据
    /// 发完才能得到应答；默认 10 秒在慢链路上会误判超时。
    /// 每个文件的在途写请求数保持默认 8 个（8 × 256 KB），正好填满 OpenSSH 的
    /// 2 MB 通道窗口，再多只会堆在内存里排队。
    pub async fn open_transfer_sftp(&self, permit: OwnedSemaphorePermit) -> SshResult<SftpSession> {
        self.open_sftp_with(Self::transfer_sftp_config(), permit, true)
            .await
    }

    /// Optional channels must never wait: other tasks may be holding all slots.
    pub async fn try_open_transfer_sftp(&self) -> SshResult<Option<SftpSession>> {
        let Ok(permit) = self.transfer_slots.clone().try_acquire_owned() else {
            return Ok(None);
        };
        self.open_sftp_with(Self::transfer_sftp_config(), permit, false)
            .await
            .map(Some)
    }

    fn transfer_sftp_config() -> russh_sftp::client::Config {
        russh_sftp::client::Config {
            request_timeout_secs: 120,
            ..Default::default()
        }
    }

    async fn acquire_sftp_slot(&self, slots: &Arc<Semaphore>) -> SshResult<OwnedSemaphorePermit> {
        slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| SshError::SessionNotFound(self.id.clone()))
    }

    async fn open_sftp_stream(
        &self,
        permit: OwnedSemaphorePermit,
        retry: bool,
    ) -> SshResult<SftpStream<russh::ChannelStream<Msg>>> {
        let mut retries = 0;
        let channel = loop {
            let result = self.handle.lock().await.channel_open_session().await;
            match result {
                Ok(channel) => break channel,
                Err(russh::Error::ChannelOpenFailure(
                    russh::ChannelOpenFailure::ConnectFailed
                    | russh::ChannelOpenFailure::ResourceShortage,
                )) if retry && retries < 4 => {
                    // The previous SFTP stream may have stopped before sshd processed its close.
                    // Drop the handle lock while waiting so terminal input and closes can proceed.
                    tokio::time::sleep(Duration::from_millis(100 << retries)).await;
                    retries += 1;
                }
                Err(error) => return Err(error.into()),
            }
        };
        if let Err(error) = channel.request_subsystem(true, "sftp").await {
            let _ = channel.close().await;
            return Err(error.into());
        }
        Ok(SftpStream::new(channel.into_stream(), permit))
    }

    async fn open_sftp_with(
        &self,
        config: russh_sftp::client::Config,
        permit: OwnedSemaphorePermit,
        retry: bool,
    ) -> SshResult<SftpSession> {
        let stream = self.open_sftp_stream(permit, retry).await?;
        SftpSession::new_with_config(stream, config)
            .await
            .map_err(|error| SshError::Sftp(error.to_string()))
    }

    /// 主动断开。
    pub async fn disconnect(&self) -> SshResult<()> {
        self.link.mark_manual();
        self.release();
        let handle = self.handle.lock().await;
        // 目标连接已死时这里会报错，但跳板连接仍要逐个关掉，免得残留
        let result = handle
            .disconnect(Disconnect::ByApplication, "用户主动断开", "")
            .await;

        for hop in self.jump_handles.lock().await.iter().rev() {
            let _ = hop
                .disconnect(Disconnect::ByApplication, "用户主动断开", "")
                .await;
        }
        log::info!("SSH 已断开：{}", self.config.endpoint());
        result?;
        Ok(())
    }
}

/// 每跳均独立校验主机密钥和认证，后续 TCP 流由上一跳 direct-tcpip 承载。
///
/// 等待用户确认主机密钥或输入验证码的时间不计入连接超时。
async fn connect_handle(
    config: &SshConfig,
    previous: Option<&Handle<ClientHandler>>,
    prompter: Option<&Arc<Prompter>>,
) -> SshResult<(Handle<ClientHandler>, Arc<LinkState>)> {
    let handler = ClientHandler::new(config, prompter.cloned());
    let link = handler.link.clone();
    let clock = handler.clock.clone();
    let connect = async {
        let ssh_config = Arc::new(client::Config {
            inactivity_timeout: (config.keepalive_secs > 0)
                .then(|| Duration::from_secs(config.keepalive_secs.saturating_mul(4))),
            keepalive_interval: (config.keepalive_secs > 0)
                .then(|| Duration::from_secs(config.keepalive_secs)),
            ..Default::default()
        });
        let mut handle = if let Some(previous) = previous {
            let channel = previous
                .channel_open_direct_tcpip(&config.host, config.port as u32, "127.0.0.1", 0)
                .await?;
            client::connect_stream(ssh_config, channel.into_stream(), handler).await
        } else {
            let stream = proxy::connect(&config.host, config.port, config.proxy.as_ref()).await?;
            client::connect_stream(ssh_config, stream, handler).await
        }
        .map_err(|source| match link.take_declined() {
            // 用户拒绝主机密钥时 russh 只会报 UnknownKey，换成可读的原因
            Some(reason) => SshError::UserDeclined(reason),
            None => SshError::Connect {
                endpoint: config.endpoint(),
                source,
            },
        })?;
        authenticate(&mut handle, config, &clock, prompter.map(Arc::as_ref)).await?;
        Ok(handle)
    };
    let handle = timeout_excluding_prompts(
        Duration::from_secs(config.timeout_secs.clamp(1, 300)),
        &clock,
        connect,
    )
    .await
    .ok_or_else(|| SshError::Timeout {
        endpoint: config.endpoint(),
        secs: config.timeout_secs,
    })??;
    Ok((handle, link))
}

/// 后台读循环：把远端输出源源不断推给前端，直到 channel 关闭。
///
/// 输出走 Tauri Channel 发原始字节：只送到打开这个 shell 的窗口和这一个终端，
/// 不再做 base64 编解码，1 KB 以上的块经 IPC 原样取回、不经 JSON；
/// 通道自带序号，乱序到达也会按顺序交付。
/// stderr 与 stdout 在终端里显示方式相同，一并写入。
async fn pump_output(
    app: AppHandle,
    session_id: String,
    mut channel: ChannelReadHalf,
    output: Channel<InvokeResponseBody>,
    link: Arc<LinkState>,
) {
    let mut exit_code = None;

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, ext: 1 } => {
                // 窗口已关闭时发送失败属正常，继续读到 shell 结束，退出状态仍要上报。
                if let Err(err) = output.send(InvokeResponseBody::Raw(data.to_vec())) {
                    log::debug!("推送终端输出失败：{err}");
                }
            }
            ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }

    // 没有退出码且整条连接随之断开：断线原因由会话表的清理任务上报，这里不重复发
    if exit_code.is_none()
        && !link.is_manual()
        && link.wait_closed(Duration::from_secs(2)).await
    {
        log::info!("会话 {session_id} 的连接已断开：{}", link.reason());
        return;
    }

    // 循环退出即远端 shell 结束，通知前端把标签页标成已断开
    emit_status(&app, StatusEvent::disconnected(&session_id, exit_code));
    log::info!("会话 {session_id} 的 shell 已结束（退出码 {exit_code:?}）");
}

/// 按配置的方式完成认证；服务端要求键盘交互（验证码、OTP）时转入交互流程。
async fn authenticate(
    handle: &mut Handle<ClientHandler>,
    config: &SshConfig,
    clock: &PauseClock,
    prompter: Option<&Prompter>,
) -> SshResult<()> {
    let result = match &config.auth {
        AuthMethod::Password { password } => {
            handle
                .authenticate_password(&config.username, password)
                .await?
        }

        AuthMethod::PrivateKey { path, passphrase } => {
            if !std::path::Path::new(path).exists() {
                return Err(SshError::KeyNotFound(path.clone()));
            }

            let key = load_secret_key(path, passphrase.as_deref()).map_err(|source| {
                SshError::KeyParse {
                    path: path.clone(),
                    source,
                }
            })?;

            // 让 russh 依据服务端支持的算法挑签名哈希：
            // 老服务器只认 ssh-rsa(SHA1)，新的要 rsa-sha2-256/512，写死哪个都会漏一批
            let hash_alg = handle.best_supported_rsa_hash().await?.flatten();

            handle
                .authenticate_publickey(
                    &config.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await?
        }

        AuthMethod::Agent => authenticate_with_agent(handle, &config.username).await?,
    };

    let AuthResult::Failure {
        remaining_methods,
        partial_success,
    } = result
    else {
        return Ok(());
    };

    let saved_password = match &config.auth {
        AuthMethod::Password { password } => Some(password.as_str()),
        _ => None,
    };
    let password_rejected = saved_password.is_some()
        && !partial_success
        && remaining_methods.contains(&MethodKind::Password);
    // 密码本身被拒时直接报错，不再弹交互框让用户重输一遍
    if remaining_methods.contains(&MethodKind::KeyboardInteractive) && !password_rejected {
        // 服务端只开放键盘交互、或密码已通过还要二次验证时，保存的密码可以回答第一个密码提示
        return keyboard_interactive(handle, config, saved_password, clock, prompter).await;
    }

    Err(SshError::AuthRejected {
        method: config.auth.label(),
    })
}

/// 键盘交互认证：逐轮把服务端的提示交给用户（或用保存的密码回答密码提示）。
async fn keyboard_interactive(
    handle: &mut Handle<ClientHandler>,
    config: &SshConfig,
    mut saved_password: Option<&str>,
    clock: &PauseClock,
    prompter: Option<&Prompter>,
) -> SshResult<()> {
    const METHOD: &str = "keyboard-interactive";
    let mut response = handle
        .authenticate_keyboard_interactive_start(&config.username, None::<String>)
        .await?;

    for _ in 0..MAX_KEYBOARD_INTERACTIVE_ROUNDS {
        let (name, instructions, prompts) = match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(()),
            KeyboardInteractiveAuthResponse::Failure { .. } => {
                return Err(SshError::AuthRejected { method: METHOD })
            }
            KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => (name, instructions, prompts),
        };

        let answers = if prompts.is_empty() {
            // 只有说明没有输入项的轮次（如横幅），按协议回空答复
            Vec::new()
        } else if saved_password.is_some() && is_password_prompt(&prompts) {
            vec![saved_password.take().unwrap_or_default().to_owned()]
        } else {
            let Some(prompter) = prompter else {
                return Err(SshError::UserDeclined(
                    "服务器要求键盘交互认证，但当前无法弹出输入框".into(),
                ));
            };
            let request = AuthPrompt {
                host: config.host.clone(),
                port: config.port,
                username: config.username.clone(),
                name,
                instructions,
                prompts: prompts
                    .iter()
                    .map(|field| AuthPromptField {
                        prompt: field.prompt.clone(),
                        echo: field.echo,
                    })
                    .collect(),
            };
            match clock.pause(prompter.auth(request)).await {
                Ok(Some(mut answers)) => {
                    answers.resize(prompts.len(), String::new());
                    answers
                }
                Ok(None) => return Err(SshError::UserDeclined("已取消键盘交互认证".into())),
                Err(reason) => {
                    return Err(SshError::UserDeclined(format!(
                        "键盘交互认证未完成：{reason}"
                    )))
                }
            }
        };

        response = handle
            .authenticate_keyboard_interactive_respond(answers)
            .await?;
    }

    Err(SshError::AuthRejected { method: METHOD })
}

/// 单个不回显、看起来在问密码的提示，才用保存的密码自动回答；验证码之类一律交给用户。
fn is_password_prompt(prompts: &[russh::client::Prompt]) -> bool {
    match prompts {
        [only] if !only.echo => {
            let text = only.prompt.to_lowercase();
            text.contains("password") || text.contains("密码")
        }
        _ => false,
    }
}

/// 走 ssh-agent 认证。
///
/// agent 的接入方式各平台不同，所以按平台分开实现：
/// Windows 上是 OpenSSH 的命名管道（另有 Pageant 作为 PuTTY 生态的备选），
/// Unix 上是 SSH_AUTH_SOCK 指向的域套接字。
#[cfg(windows)]
async fn authenticate_with_agent(
    handle: &mut Handle<ClientHandler>,
    username: &str,
) -> SshResult<AuthResult> {
    use russh::keys::agent::client::AgentClient;

    /// Windows OpenSSH agent 的固定管道名
    const OPENSSH_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

    // 先试 OpenSSH agent，不在就退回 Pageant —— 装了 PuTTY 的机器通常只有后者
    match AgentClient::connect_named_pipe(OPENSSH_PIPE).await {
        Ok(mut agent) => try_agent_identities(handle, username, &mut agent).await,
        Err(err) => {
            log::debug!("连接 OpenSSH agent 失败（{err}），改试 Pageant");
            let mut agent = AgentClient::connect_pageant().await?;
            try_agent_identities(handle, username, &mut agent).await
        }
    }
}

#[cfg(not(windows))]
async fn authenticate_with_agent(
    handle: &mut Handle<ClientHandler>,
    username: &str,
) -> SshResult<AuthResult> {
    use russh::keys::agent::client::AgentClient;

    let mut agent = AgentClient::connect_env().await.map_err(SshError::Key)?;
    try_agent_identities(handle, username, &mut agent).await
}

/// 把 agent 里挂着的钥匙挨个试过去，直到有一把被服务端接受（含“已接受、还需二次验证”）。
async fn try_agent_identities<S>(
    handle: &mut Handle<ClientHandler>,
    username: &str,
    agent: &mut russh::keys::agent::client::AgentClient<S>,
) -> SshResult<AuthResult>
where
    S: russh::keys::agent::client::AgentStream + Unpin + Send + 'static,
{
    let identities = agent.request_identities().await.map_err(SshError::Key)?;

    if identities.is_empty() {
        return Err(SshError::InvalidInput(
            "ssh-agent 里没有可用的密钥，先用 ssh-add 添加".into(),
        ));
    }

    let mut last = AuthResult::Failure {
        remaining_methods: MethodSet::empty(),
        partial_success: false,
    };
    for key in identities {
        let hash_alg = handle.best_supported_rsa_hash().await?.flatten();

        last = handle
            .authenticate_publickey_with(username, key, hash_alg, agent)
            .await?;
        if matches!(
            last,
            AuthResult::Success
                | AuthResult::Failure {
                    partial_success: true,
                    ..
                }
        ) {
            break;
        }
    }

    Ok(last)
}

/// 连接参数的基本校验。挡住明显错误的入参，避免带着空 host 去做 DNS 解析。
fn validate_config(config: &SshConfig) -> SshResult<()> {
    if config.host.trim().is_empty() {
        return Err(SshError::InvalidInput("主机地址不能为空".into()));
    }

    if config.username.trim().is_empty() {
        return Err(SshError::InvalidInput("用户名不能为空".into()));
    }

    if config.port == 0 {
        return Err(SshError::InvalidInput("端口必须在 1-65535 之间".into()));
    }

    if let Some(proxy) = &config.proxy {
        if proxy.host.trim().is_empty() {
            return Err(SshError::InvalidInput("代理地址不能为空".into()));
        }
        if proxy.port == 0 {
            return Err(SshError::InvalidInput("代理端口必须在 1-65535 之间".into()));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TestSftp;

    impl russh_sftp::server::Handler for TestSftp {
        type Error = russh_sftp::protocol::StatusCode;

        fn unimplemented(&self) -> Self::Error {
            russh_sftp::protocol::StatusCode::OpUnsupported
        }
    }

    #[derive(Default)]
    struct TestServer {
        channels: HashMap<russh::ChannelId, russh::Channel<russh::server::Msg>>,
        active: HashSet<russh::ChannelId>,
        rejected: Arc<AtomicUsize>,
    }

    impl russh::server::Handler for TestServer {
        type Error = russh::Error;

        async fn auth_none(&mut self, _: &str) -> Result<russh::server::Auth, Self::Error> {
            Ok(russh::server::Auth::Accept)
        }

        async fn channel_open_session(
            &mut self,
            channel: russh::Channel<russh::server::Msg>,
            _: &mut russh::server::Session,
        ) -> Result<bool, Self::Error> {
            // Simulate a server with a session limit below OpenSSH's default of 10.
            if self.active.len() >= MAX_TRANSFER_CHANNELS + MAX_METADATA_CHANNELS {
                self.rejected.fetch_add(1, Ordering::SeqCst);
                return Ok(false);
            }
            self.active.insert(channel.id());
            self.channels.insert(channel.id(), channel);
            Ok(true)
        }

        async fn channel_close(
            &mut self,
            channel: russh::ChannelId,
            _: &mut russh::server::Session,
        ) -> Result<(), Self::Error> {
            self.active.remove(&channel);
            self.channels.remove(&channel);
            Ok(())
        }

        async fn channel_eof(
            &mut self,
            channel: russh::ChannelId,
            session: &mut russh::server::Session,
        ) -> Result<(), Self::Error> {
            session.close(channel)?;
            Ok(())
        }

        async fn subsystem_request(
            &mut self,
            channel: russh::ChannelId,
            _: &str,
            session: &mut russh::server::Session,
        ) -> Result<(), Self::Error> {
            session.channel_success(channel)?;
            let stream = self.channels.remove(&channel).unwrap().into_stream();
            russh_sftp::server::run(stream, TestSftp).await;
            Ok(())
        }
    }

    async fn transfer_session() -> (SshSession, Arc<AtomicUsize>) {
        let (client_stream, server_stream) = tokio::io::duplex(64 * 1024);
        let rejected = Arc::new(AtomicUsize::new(0));
        let handler = TestServer {
            rejected: rejected.clone(),
            ..Default::default()
        };
        let server_config = russh::server::Config {
            keys: vec![russh::keys::PrivateKey::random(
                &mut rand::rngs::OsRng,
                russh::keys::Algorithm::Ed25519,
            )
            .unwrap()],
            ..Default::default()
        };
        tokio::spawn(async move {
            let _ = russh::server::run_stream(Arc::new(server_config), server_stream, handler)
                .await
                .unwrap()
                .await;
        });
        let config = config_with("test", "test", 22);
        let mut handler = ClientHandler::new(&config, None);
        handler.verify_host_key = false;
        let link = handler.link.clone();
        let mut handle = client::connect_stream(
            Arc::new(client::Config::default()),
            client_stream,
            handler,
        )
        .await
        .unwrap();
        assert!(handle.authenticate_none("test").await.unwrap().success());
        (
            SshSession {
                id: "test".into(),
                config,
                jump_handles: Mutex::new(Vec::new()),
                handle: Mutex::new(handle),
                shell: Mutex::new(None),
                transfer_slots: Arc::new(Semaphore::new(MAX_TRANSFER_CHANNELS)),
                metadata_slots: Arc::new(Semaphore::new(MAX_METADATA_CHANNELS)),
                link,
            },
            rejected,
        )
    }

    #[tokio::test]
    async fn transfers_share_a_budget_and_keep_metadata_channels_available() {
        let (session, rejected) = transfer_session().await;
        let mut transfers = Vec::new();
        for _ in 0..MAX_TRANSFER_CHANNELS {
            let permit = session.reserve_transfer_channel().await.unwrap();
            transfers.push(session.open_transfer_sftp(permit).await.unwrap());
        }
        assert!(session.try_open_transfer_sftp().await.unwrap().is_none());
        assert!(tokio::time::timeout(
            Duration::from_millis(20),
            session.reserve_transfer_channel(),
        )
        .await
        .is_err());
        let first_metadata = session.open_sftp().await.unwrap();
        let second_metadata = session.open_sftp().await.unwrap();
        assert_eq!(rejected.load(Ordering::SeqCst), 0);

        // Explicit close and ordinary drop must both make their slots reusable.
        transfers.pop().unwrap().close().await.unwrap();
        drop(transfers.pop());
        for _ in 0..2 {
            let permit =
                tokio::time::timeout(Duration::from_secs(2), session.reserve_transfer_channel())
                    .await
                    .unwrap()
                    .unwrap();
            transfers.push(session.open_transfer_sftp(permit).await.unwrap());
        }
        assert!(session.try_open_transfer_sftp().await.unwrap().is_none());
        drop(first_metadata);
        drop(second_metadata);
        drop(transfers);
        session.disconnect().await.unwrap();
    }

    #[tokio::test]
    async fn disconnect_wakes_transfers_waiting_for_a_channel() {
        let (session, _) = transfer_session().await;
        let mut permits = Vec::new();
        for _ in 0..MAX_TRANSFER_CHANNELS {
            permits.push(session.reserve_transfer_channel().await.unwrap());
        }
        let pending = session.reserve_transfer_channel();
        session.disconnect().await.unwrap();
        assert!(matches!(pending.await, Err(SshError::SessionNotFound(_))));
    }

    fn config_with(host: &str, username: &str, port: u16) -> SshConfig {
        SshConfig {
            jump_hosts: Vec::new(),
            host: host.to_owned(),
            port,
            username: username.to_owned(),
            auth: AuthMethod::Agent,
            timeout_secs: 20,
            keepalive_secs: 30,
            verify_host_key: true,
            proxy: None,
        }
    }

    #[test]
    fn rejects_empty_host_or_user() {
        assert!(validate_config(&config_with("", "root", 22)).is_err());
        assert!(validate_config(&config_with("1.2.3.4", " ", 22)).is_err());
        assert!(validate_config(&config_with("1.2.3.4", "root", 0)).is_err());
        assert!(validate_config(&config_with("1.2.3.4", "root", 22)).is_ok());
    }

    #[test]
    fn auth_label_never_leaks_secret() {
        let auth = AuthMethod::Password {
            password: "hunter2".into(),
        };
        assert_eq!(auth.label(), "password");
    }
    #[derive(Default)]
    struct JumpTestServer;
    impl russh::server::Handler for JumpTestServer {
        type Error = russh::Error;
        async fn auth_password(
            &mut self,
            _: &str,
            password: &str,
        ) -> Result<russh::server::Auth, Self::Error> {
            Ok(if password == "test" {
                russh::server::Auth::Accept
            } else {
                russh::server::Auth::reject()
            })
        }
        async fn channel_open_direct_tcpip(
            &mut self,
            channel: russh::Channel<russh::server::Msg>,
            host: &str,
            port: u32,
            _: &str,
            _: u32,
            _: &mut russh::server::Session,
        ) -> Result<bool, Self::Error> {
            let Ok(mut stream) = tokio::net::TcpStream::connect((host, port as u16)).await else {
                return Ok(false);
            };
            tokio::spawn(async move {
                let _ =
                    tokio::io::copy_bidirectional(&mut channel.into_stream(), &mut stream).await;
            });
            Ok(true)
        }
        async fn channel_open_session(
            &mut self,
            _: russh::Channel<russh::server::Msg>,
            _: &mut russh::server::Session,
        ) -> Result<bool, Self::Error> {
            Ok(true)
        }
        async fn exec_request(
            &mut self,
            channel: russh::ChannelId,
            _: &[u8],
            session: &mut russh::server::Session,
        ) -> Result<(), Self::Error> {
            session.channel_success(channel)?;
            session.data(
                channel,
                russh::CryptoVec::from_slice(b"routed through two hops"),
            )?;
            session.exit_status_request(channel, 0)?;
            session.eof(channel)?;
            session.close(channel)?;
            Ok(())
        }
    }
    /// 只在本机启动临时 SSH 服务，验证真实 direct-tcpip 链路而不依赖外部服务器。
    async fn jump_test_server() -> (u16, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let config = Arc::new(russh::server::Config {
            keys: vec![russh::keys::PrivateKey::random(
                &mut rand::rngs::OsRng,
                russh::keys::Algorithm::Ed25519,
            )
            .unwrap()],
            ..Default::default()
        });
        let task = tokio::spawn(async move {
            let mut sessions = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        let config = config.clone();
                        sessions.spawn(async move { if let Ok(session) = russh::server::run_stream(config, stream, JumpTestServer).await { let _ = session.await; } });
                    }
                    Some(_) = sessions.join_next(), if !sessions.is_empty() => {}
                }
            }
        });
        (port, task)
    }
    #[tokio::test]
    async fn two_jump_hosts_carry_commands_to_the_final_server() {
        let (first, first_task) = jump_test_server().await;
        let (second, second_task) = jump_test_server().await;
        let (target, target_task) = jump_test_server().await;
        let config = |port| SshConfig {
            auth: AuthMethod::Password {
                password: "test".into(),
            },
            verify_host_key: false,
            timeout_secs: 3,
            ..config_with("127.0.0.1", "test", port)
        };
        let mut target_config = config(target);
        target_config.jump_hosts = vec![config(first), config(second)];
        let result = SshSession::connect("jump-test".into(), target_config).await;
        let session = result.unwrap();
        assert_eq!(session.jump_handles.lock().await.len(), 2);
        let output = session.exec_agent("test").await.unwrap();
        assert_eq!(output.stdout, "routed through two hops");
        assert_eq!(output.exit_code, Some(0));
        session.disconnect().await.unwrap();
        for task in [first_task, second_task, target_task] {
            task.abort();
        }
    }

    /// 密码通过后还要输入验证码的服务端（AuthenticationMethods password,keyboard-interactive）。
    struct TwoFactorServer;
    impl russh::server::Handler for TwoFactorServer {
        type Error = russh::Error;
        async fn auth_password(
            &mut self,
            _: &str,
            password: &str,
        ) -> Result<russh::server::Auth, Self::Error> {
            Ok(if password == "test" {
                russh::server::Auth::Reject {
                    proceed_with_methods: Some(MethodSet::from(
                        &[MethodKind::KeyboardInteractive][..],
                    )),
                    partial_success: true,
                }
            } else {
                russh::server::Auth::reject()
            })
        }
        async fn auth_keyboard_interactive<'a>(
            &'a mut self,
            _: &str,
            _: &str,
            response: Option<russh::server::Response<'a>>,
        ) -> Result<russh::server::Auth, Self::Error> {
            Ok(match response {
                None => russh::server::Auth::Partial {
                    name: "2FA".into(),
                    instructions: "Enter your one-time code".into(),
                    prompts: vec![("Verification code: ".into(), true)].into(),
                },
                Some(mut answers) if answers.next().as_deref() == Some(&b"123456"[..]) => {
                    russh::server::Auth::Accept
                }
                Some(_) => russh::server::Auth::reject(),
            })
        }
    }

    async fn serve_once<H>(handler: H) -> tokio::io::DuplexStream
    where
        H: russh::server::Handler + Send + 'static,
    {
        let (client_stream, server_stream) = tokio::io::duplex(64 * 1024);
        let config = Arc::new(russh::server::Config {
            keys: vec![russh::keys::PrivateKey::random(
                &mut rand::rngs::OsRng,
                russh::keys::Algorithm::Ed25519,
            )
            .unwrap()],
            ..Default::default()
        });
        tokio::spawn(async move {
            if let Ok(session) = russh::server::run_stream(config, server_stream, handler).await {
                let _ = session.await;
            }
        });
        client_stream
    }

    #[tokio::test]
    async fn one_time_code_is_asked_after_the_password_is_accepted() {
        let (prompter, mut events) = crate::ssh::prompt::tests::test_prompter(Duration::from_secs(5));
        let responder = prompter.clone();
        let asked = tokio::spawn(async move {
            let (event, payload) = events.recv().await.unwrap();
            assert_eq!(event, prompt::EVENT_AUTH_PROMPT);
            assert_eq!(payload["prompts"][0]["prompt"], "Verification code: ");
            assert_eq!(payload["prompts"][0]["echo"], true);
            assert!(responder.respond_auth(
                payload["requestId"].as_str().unwrap(),
                Some(vec!["123456".into()])
            ));
        });

        let config = SshConfig {
            auth: AuthMethod::Password {
                password: "test".into(),
            },
            ..config_with("test", "test", 22)
        };
        let mut handler = ClientHandler::new(&config, None);
        handler.verify_host_key = false;
        let stream = serve_once(TwoFactorServer).await;
        let mut handle = client::connect_stream(Arc::new(client::Config::default()), stream, handler)
            .await
            .unwrap();
        let clock = PauseClock::default();
        authenticate(&mut handle, &config, &clock, Some(&prompter))
            .await
            .unwrap();
        asked.await.unwrap();
    }

    #[tokio::test]
    async fn cancelling_the_code_prompt_aborts_the_connection() {
        let (prompter, mut events) = crate::ssh::prompt::tests::test_prompter(Duration::from_secs(5));
        let responder = prompter.clone();
        tokio::spawn(async move {
            let (_, payload) = events.recv().await.unwrap();
            responder.respond_auth(payload["requestId"].as_str().unwrap(), None);
        });
        let config = SshConfig {
            auth: AuthMethod::Password {
                password: "test".into(),
            },
            ..config_with("test", "test", 22)
        };
        let mut handler = ClientHandler::new(&config, None);
        handler.verify_host_key = false;
        let stream = serve_once(TwoFactorServer).await;
        let mut handle = client::connect_stream(Arc::new(client::Config::default()), stream, handler)
            .await
            .unwrap();
        let result = authenticate(&mut handle, &config, &PauseClock::default(), Some(&prompter)).await;
        assert!(matches!(result, Err(SshError::UserDeclined(_))));
    }

    fn known_hosts_file(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "miraihub-session-known-hosts-{}-{name}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("known_hosts");
        let _ = std::fs::remove_file(&path);
        path
    }

    /// 用指定的 known_hosts 与前端应答方式完成一次握手。
    async fn handshake(
        port: u16,
        known_hosts: &std::path::Path,
        prompter: Option<Arc<Prompter>>,
    ) -> (Result<Handle<ClientHandler>, russh::Error>, Arc<LinkState>) {
        let config = config_with("127.0.0.1", "test", port);
        let mut handler = ClientHandler::new(&config, prompter);
        handler.known_hosts = Some(known_hosts.to_owned());
        let link = handler.link.clone();
        let stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        let result =
            client::connect_stream(Arc::new(client::Config::default()), stream, handler).await;
        (result, link)
    }

    /// 测试里扮演前端：对每个主机密钥请求给出同一个决定，并转发事件内容。
    fn answer_host_keys(
        accept: bool,
        remember: bool,
    ) -> (
        Arc<Prompter>,
        tokio::sync::mpsc::UnboundedReceiver<serde_json::Value>,
    ) {
        let (prompter, mut events) =
            crate::ssh::prompt::tests::test_prompter(Duration::from_secs(5));
        let (seen, receiver) = tokio::sync::mpsc::unbounded_channel();
        let responder = prompter.clone();
        tokio::spawn(async move {
            while let Some((event, payload)) = events.recv().await {
                if event != prompt::EVENT_HOST_KEY_PROMPT {
                    continue;
                }
                let decision = prompt::HostKeyDecision { accept, remember };
                responder.respond_host_key(payload["requestId"].as_str().unwrap(), decision);
                let _ = seen.send(payload);
            }
        });
        (prompter, receiver)
    }

    #[tokio::test]
    async fn unknown_host_key_waits_for_the_user_and_remembers_on_request() {
        let (port, server) = jump_test_server().await;
        let path = known_hosts_file("prompt");

        let (prompter, mut seen) = answer_host_keys(false, false);
        let (result, link) = handshake(port, &path, Some(prompter)).await;
        assert!(result.is_err());
        assert!(link.take_declined().unwrap().contains("已拒绝"));
        assert_eq!(seen.recv().await.unwrap()["status"], "unknown");
        assert!(!path.exists());

        let (prompter, mut seen) = answer_host_keys(true, true);
        let (result, _) = handshake(port, &path, Some(prompter)).await;
        assert!(result.is_ok());
        let payload = seen.recv().await.unwrap();
        assert!(payload["fingerprint"].as_str().unwrap().starts_with("SHA256:"));
        assert!(std::fs::read_to_string(&path).unwrap().contains("127.0.0.1"));

        // 已记住：不再询问
        let (prompter, mut seen) = answer_host_keys(false, false);
        let (result, _) = handshake(port, &path, Some(prompter)).await;
        assert!(result.is_ok());
        assert!(seen.try_recv().is_err());
        server.abort();
    }

    #[tokio::test]
    async fn changed_host_key_is_reported_with_the_old_fingerprint() {
        let (port, server) = jump_test_server().await;
        let path = known_hosts_file("changed");
        let stale = russh::keys::PrivateKey::random(
            &mut rand::rngs::OsRng,
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap()
        .public_key()
        .clone();
        known_hosts::learn("127.0.0.1", port, &stale, &path).unwrap();

        // 没有前端时变化的密钥一律拒绝
        let (result, link) = handshake(port, &path, None).await;
        assert!(result.is_err());
        assert!(link.take_declined().is_some());

        let (prompter, mut seen) = answer_host_keys(true, true);
        let (result, _) = handshake(port, &path, Some(prompter)).await;
        assert!(result.is_ok());
        let payload = seen.recv().await.unwrap();
        assert_eq!(payload["status"], "changed");
        assert_eq!(payload["oldFingerprint"], known_hosts::fingerprint(&stale));

        let (prompter, mut seen) = answer_host_keys(false, false);
        assert!(handshake(port, &path, Some(prompter)).await.0.is_ok());
        assert!(seen.try_recv().is_err());
        server.abort();
    }

    #[tokio::test]
    async fn remote_close_marks_the_link_closed_with_a_reason() {
        let (port, server) = jump_test_server().await;
        let config = SshConfig {
            auth: AuthMethod::Password {
                password: "test".into(),
            },
            verify_host_key: false,
            timeout_secs: 3,
            ..config_with("127.0.0.1", "test", port)
        };
        let session = SshSession::connect("liveness".into(), config).await.unwrap();
        let link = session.link();
        assert!(!link.is_closed());
        server.abort();
        assert!(link.wait_closed(Duration::from_secs(5)).await);
        // 平台不同可能是正常 EOF 也可能是连接被重置，但一定要有具体原因
        let reason = link.reason();
        assert!(
            reason == "远端关闭连接" || reason.starts_with("网络错误"),
            "{reason}"
        );
        assert!(!link.is_manual());
    }

    #[tokio::test]
    async fn manual_disconnect_is_not_reported_as_a_drop() {
        let (port, server) = jump_test_server().await;
        let config = SshConfig {
            auth: AuthMethod::Password {
                password: "test".into(),
            },
            verify_host_key: false,
            timeout_secs: 3,
            ..config_with("127.0.0.1", "test", port)
        };
        let session = SshSession::connect("manual".into(), config).await.unwrap();
        let link = session.link();
        session.disconnect().await.unwrap();
        assert!(link.wait_closed(Duration::from_secs(5)).await);
        assert!(link.is_manual());
        server.abort();
    }
}
