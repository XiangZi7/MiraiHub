//! 单个 SSH 会话：连接、认证、交互式 shell、执行命令。
//!
//! 一个 `SshSession` 对应一条 TCP 连接上的 SSH 传输层。
//! 交互式 shell 与 exec 各自开独立的 channel，互不干扰。

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use russh::client::{self, Handle, Msg};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Disconnect};
use tauri::AppHandle;
use tokio::sync::Mutex;

use super::error::{SshError, SshResult};
use super::events::{emit_output, emit_status, OutputEvent, StatusEvent};
use super::models::{AuthMethod, CommandOutput, PtyOptions, SshConfig};

/// 连接事件处理器。
///
/// 主机密钥校验目前一律放行：`known_hosts` 的信任决策需要一整套
/// "首次连接确认 / 密钥变更告警"的前端交互，属于独立的一块。
/// 在那之前，先明确记录风险，避免默默当成已验证。
struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO(known_hosts): 接入 known_hosts 校验与首连确认弹窗后改为按需拒绝
        log::warn!(
            "跳过主机密钥校验（尚未接入 known_hosts），指纹：{}",
            server_public_key.fingerprint(Default::default())
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

        let addr = (config.host.as_str(), config.port);
        let connect_fut = client::connect(Arc::new(ssh_config), addr, ClientHandler);

        // russh 自身没有连接超时，靠外层 timeout 兜住：
        // 否则连一个丢包的地址会一直挂着，用户只看到界面卡住
        let mut handle =
            tokio::time::timeout(Duration::from_secs(config.timeout_secs), connect_fut)
                .await
                .map_err(|_| SshError::Timeout {
                    endpoint: endpoint.clone(),
                    secs: config.timeout_secs,
                })?
                .map_err(|source| SshError::Connect {
                    endpoint: endpoint.clone(),
                    source,
                })?;

        authenticate(&mut handle, &config).await?;

        log::info!("SSH 已连接：{endpoint}（{}）", config.auth.label());

        Ok(Self {
            id,
            config,
            handle: Mutex::new(handle),
            shell: Mutex::new(None),
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

    /// 主动断开。
    pub async fn disconnect(&self) -> SshResult<()> {
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

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(host: &str, username: &str, port: u16) -> SshConfig {
        SshConfig {
            host: host.to_owned(),
            port,
            username: username.to_owned(),
            auth: AuthMethod::Agent,
            timeout_secs: 20,
            keepalive_secs: 30,
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
