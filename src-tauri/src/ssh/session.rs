//! 单个 SSH 会话：连接、认证、交互式 shell、执行命令。
//!
//! 一个 `SshSession` 对应一条 TCP 连接上的 SSH 传输层。
//! 交互式 shell 与 exec 各自开独立的 channel，互不干扰。

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use russh::client::{self, Handle, Msg};
use russh::keys::{
    known_hosts::{check_known_hosts_path, learn_known_hosts_path},
    load_secret_key, PrivateKeyWithHashAlg, PublicKey,
};
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Disconnect};
use russh_sftp::client::SftpSession;
use tauri::AppHandle;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

use super::error::{SshError, SshResult};
use super::events::{emit_output, emit_status, OutputEvent, StatusEvent};
use super::models::{AuthMethod, CommandOutput, PtyOptions, SshConfig};
use super::proxy;
use super::sftp_stream::SftpStream;

/// Shared by all uploads and downloads on this SSH connection, including extra channels.
const MAX_TRANSFER_CHANNELS: usize = 4;
/// Reserve room for shell/exec channels even while path checks and transfers overlap.
const MAX_METADATA_CHANNELS: usize = 2;

/// 连接事件处理器。
///
/// 主机密钥采用 TOFU：首次写入 ~/.ssh/known_hosts，之后严格比对。
struct ClientHandler {
    host: String,
    port: u16,
    verify_host_key: bool,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint(Default::default());
        if !self.verify_host_key {
            log::warn!(
                "已按设置跳过 {}:{} 的主机密钥校验（{fingerprint}）",
                self.host,
                self.port
            );
            return Ok(true);
        }

        let home = dirs::home_dir().ok_or(russh::keys::Error::NoHomeDir)?;
        let known_hosts = home.join(".ssh").join("known_hosts");
        if check_known_hosts_path(&self.host, self.port, server_public_key, &known_hosts)? {
            return Ok(true);
        }

        learn_known_hosts_path(&self.host, self.port, server_public_key, &known_hosts)?;
        log::info!(
            "首次信任并记录 {}:{} 的主机密钥（{fingerprint}）",
            self.host,
            self.port
        );
        Ok(true)
    }
}

/// 一个已建立的 SSH 会话。
pub struct SshSession {
    id: String,
    config: SshConfig,
    /// russh 的连接句柄。开新 channel 时用，故加锁
    handle: Mutex<Handle<ClientHandler>>,
    /// 交互式 shell 的写半边。未开 shell 时为 None
    shell: Mutex<Option<ChannelWriteHalf<Msg>>>,
    transfer_slots: Arc<Semaphore>,
    metadata_slots: Arc<Semaphore>,
}

impl SshSession {
    /// 建立连接并完成认证。
    pub async fn connect(id: String, config: SshConfig) -> SshResult<Self> {
        validate_config(&config)?;

        let endpoint = config.endpoint();

        let ssh_config = client::Config {
            // 空闲超过 keepalive 的若干倍仍无响应就判定连接已死。
            // 设成 keepalive 的 4 倍，容忍偶发的网络抖动
            inactivity_timeout: (config.keepalive_secs > 0)
                .then(|| Duration::from_secs(config.keepalive_secs * 4)),
            keepalive_interval: (config.keepalive_secs > 0)
                .then(|| Duration::from_secs(config.keepalive_secs)),
            ..Default::default()
        };

        // 整段（代理握手 + TCP + SSH 握手）共用一个超时窗口：
        // russh 自身没有连接超时，靠外层 timeout 兜住，
        // 否则连一个丢包的地址会一直挂着，用户只看到界面卡住。
        let handler = ClientHandler {
            host: config.host.clone(),
            port: config.port,
            verify_host_key: config.verify_host_key,
        };
        let connect_fut = async {
            let stream = proxy::connect(&config.host, config.port, config.proxy.as_ref()).await?;
            client::connect_stream(Arc::new(ssh_config), stream, handler)
                .await
                .map_err(|source| SshError::Connect {
                    endpoint: config.endpoint(),
                    source,
                })
        };

        let mut handle =
            tokio::time::timeout(Duration::from_secs(config.timeout_secs), connect_fut)
                .await
                .map_err(|_| SshError::Timeout {
                    endpoint: endpoint.clone(),
                    secs: config.timeout_secs,
                })??;

        authenticate(&mut handle, &config).await?;

        log::info!("SSH 已连接：{endpoint}（{}）", config.auth.label());

        Ok(Self {
            id,
            config,
            handle: Mutex::new(handle),
            shell: Mutex::new(None),
            transfer_slots: Arc::new(Semaphore::new(MAX_TRANSFER_CHANNELS)),
            metadata_slots: Arc::new(Semaphore::new(MAX_METADATA_CHANNELS)),
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn config(&self) -> &SshConfig {
        &self.config
    }

    /// 打开带 PTY 的交互式 shell，并起一个后台任务把输出推给前端。
    pub async fn open_shell(&self, app: AppHandle, pty: PtyOptions) -> SshResult<()> {
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

        tokio::spawn(async move {
            pump_output(app, session_id, read_half).await;
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
        self.transfer_slots.close();
        self.metadata_slots.close();
        let handle = self.handle.lock().await;
        handle
            .disconnect(Disconnect::ByApplication, "用户主动断开", "")
            .await?;

        log::info!("SSH 已断开：{}", self.config.endpoint());
        Ok(())
    }
}

/// 后台读循环：把远端输出源源不断推给前端，直到 channel 关闭。
async fn pump_output(app: AppHandle, session_id: String, mut channel: ChannelReadHalf) {
    let mut exit_code = None;
    let encoder = base64::engine::general_purpose::STANDARD;

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => {
                emit_output(
                    &app,
                    OutputEvent {
                        session_id: session_id.clone(),
                        data: encoder.encode(&data),
                        is_stderr: false,
                    },
                );
            }
            ChannelMsg::ExtendedData { data, ext: 1 } => {
                emit_output(
                    &app,
                    OutputEvent {
                        session_id: session_id.clone(),
                        data: encoder.encode(&data),
                        is_stderr: true,
                    },
                );
            }
            ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }

    // 循环退出即远端 shell 结束，通知前端把标签页标成已断开
    emit_status(&app, StatusEvent::disconnected(&session_id, exit_code));
    log::info!("会话 {session_id} 的 shell 已结束（退出码 {exit_code:?}）");
}

/// 按配置的方式完成认证。
async fn authenticate(handle: &mut Handle<ClientHandler>, config: &SshConfig) -> SshResult<()> {
    let accepted = match &config.auth {
        AuthMethod::Password { password } => handle
            .authenticate_password(&config.username, password)
            .await?
            .success(),

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
                .success()
        }

        AuthMethod::Agent => authenticate_with_agent(handle, &config.username).await?,
    };

    if !accepted {
        return Err(SshError::AuthRejected {
            method: config.auth.label(),
        });
    }

    Ok(())
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
) -> SshResult<bool> {
    use russh::keys::agent::client::AgentClient;

    /// Windows OpenSSH agent 的固定管道名
    const OPENSSH_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

    // 先试 OpenSSH agent，不在就退回 Pageant —— 装了 PuTTY 的机器通常只有后者
    match AgentClient::connect_named_pipe(OPENSSH_PIPE).await {
        Ok(mut agent) => try_agent_identities(handle, username, &mut agent).await,
        Err(err) => {
            log::debug!("连接 OpenSSH agent 失败（{err}），改试 Pageant");
            let mut agent = AgentClient::connect_pageant().await;
            try_agent_identities(handle, username, &mut agent).await
        }
    }
}

#[cfg(not(windows))]
async fn authenticate_with_agent(
    handle: &mut Handle<ClientHandler>,
    username: &str,
) -> SshResult<bool> {
    use russh::keys::agent::client::AgentClient;

    let mut agent = AgentClient::connect_env().await.map_err(SshError::Key)?;
    try_agent_identities(handle, username, &mut agent).await
}

/// 把 agent 里挂着的钥匙挨个试过去，直到有一把被服务端接受。
async fn try_agent_identities<S>(
    handle: &mut Handle<ClientHandler>,
    username: &str,
    agent: &mut russh::keys::agent::client::AgentClient<S>,
) -> SshResult<bool>
where
    S: russh::keys::agent::client::AgentStream + Unpin + Send + 'static,
{
    let identities = agent.request_identities().await.map_err(SshError::Key)?;

    if identities.is_empty() {
        return Err(SshError::InvalidInput(
            "ssh-agent 里没有可用的密钥，先用 ssh-add 添加".into(),
        ));
    }

    for key in identities {
        let hash_alg = handle.best_supported_rsa_hash().await?.flatten();

        if handle
            .authenticate_publickey_with(username, key, hash_alg, agent)
            .await?
            .success()
        {
            return Ok(true);
        }
    }

    Ok(false)
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
        let mut handle = client::connect_stream(
            Arc::new(client::Config::default()),
            client_stream,
            ClientHandler {
                host: "test".into(),
                port: 22,
                verify_host_key: false,
            },
        )
        .await
        .unwrap();
        assert!(handle.authenticate_none("test").await.unwrap().success());
        (
            SshSession {
                id: "test".into(),
                config: config_with("test", "test", 22),
                handle: Mutex::new(handle),
                shell: Mutex::new(None),
                transfer_slots: Arc::new(Semaphore::new(MAX_TRANSFER_CHANNELS)),
                metadata_slots: Arc::new(Semaphore::new(MAX_METADATA_CHANNELS)),
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
}
