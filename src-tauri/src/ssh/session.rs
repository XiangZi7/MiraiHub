//! 单个 SSH 会话：连接、认证、交互式 shell、执行命令。
//!
//! 一个 `SshSession` 对应一条 TCP 连接上的 SSH 传输层。
//! 交互式 shell 与 exec 各自开独立的 channel，互不干扰。

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::{ChannelId, ChannelMsg, Disconnect};
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

    async fn check_server_key(&mut self, server_public_key: &PublicKey) -> Result<bool, Self::Error> {
        // TODO(known_hosts): 接入 known_hosts 校验与首连确认弹窗后改为按需拒绝
        log::warn!(
            "跳过主机密钥校验（尚未接入 known_hosts），指纹：{}",
            server_public_key.fingerprint(russh::keys::HashAlg::Sha256)
        );
        Ok(true)
    }
}

/// 一个已建立的 SSH 会话。
pub struct SshSession {
    id: String,
    config: SshConfig,
    /// russh 的连接句柄。多处并发使用（写输入、开新 channel），故加锁
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    /// 交互式 shell 的写端。未开 shell 时为 None
    shell: Mutex<Option<ShellHandle>>,
}

/// 交互式 shell 的控制端。
struct ShellHandle {
    channel_id: ChannelId,
    /// 往 channel 写数据要经过连接句柄，这里存一份引用
    handle: Arc<Mutex<Handle<ClientHandler>>>,
}

impl ShellHandle {
    /// 写用户输入。
    async fn write(&self, data: &[u8]) -> SshResult<()> {
        let handle = self.handle.lock().await;
        handle
            .data(self.channel_id, data.to_vec().into())
            .await
            .map_err(|_| SshError::Protocol(russh::Error::SendError))?;
        Ok(())
    }

    /// 同步终端尺寸。
    async fn resize(&self, cols: u32, rows: u32) -> SshResult<()> {
        let handle = self.handle.lock().await;
        handle
            .window_change(self.channel_id, cols, rows, 0, 0)
            .await
            .map_err(|_| SshError::Protocol(russh::Error::SendError))?;
        Ok(())
    }
}

impl SshSession {
    /// 建立连接并完成认证。
    pub async fn connect(id: String, config: SshConfig) -> SshResult<Self> {
        validate_config(&config)?;

        let endpoint = config.endpoint();

        let ssh_config = client::Config {
            // 到期不续则由服务端断开；russh 会在空闲时自动发 keepalive
            inactivity_timeout: Some(Duration::from_secs(config.keepalive_secs.max(1) * 4)),
            keepalive_interval: (config.keepalive_secs > 0)
                .then(|| Duration::from_secs(config.keepalive_secs)),
            ..Default::default()
        };

        let addr = (config.host.as_str(), config.port);
        let connect_fut = client::connect(Arc::new(ssh_config), addr, ClientHandler);

        // russh 自身没有连接超时，靠外层 timeout 兜住：
        // 否则连一个丢包的地址会一直挂着，用户只看到界面卡住
        let mut handle = tokio::time::timeout(
            Duration::from_secs(config.timeout_secs),
            connect_fut,
        )
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
            handle: Arc::new(Mutex::new(handle)),
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
    ///
    /// 重复调用会先关掉旧 shell —— 一个会话标签页只对应一个 shell。
    pub async fn open_shell(&self, app: AppHandle, pty: PtyOptions) -> SshResult<()> {
        let mut channel = {
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

        let channel_id = channel.id();

        // 先登记写端，再起读循环：
        // 反过来的话读循环可能先收到输出并推给前端，而此时用户的输入还写不进去
        {
            let mut shell = self.shell.lock().await;
            *shell = Some(ShellHandle {
                channel_id,
                handle: Arc::clone(&self.handle),
            });
        }

        let session_id = self.id.clone();

        // 读循环独占 channel 的接收端，跑在后台直到远端关闭
        tokio::spawn(async move {
            pump_output(app, session_id, channel).await;
        });

        Ok(())
    }

    /// 向 shell 写入用户输入。
    pub async fn write(&self, data: &[u8]) -> SshResult<()> {
        let shell = self.shell.lock().await;
        let shell = shell
            .as_ref()
            .ok_or_else(|| SshError::InvalidInput("会话还没有打开 shell".into()))?;

        shell.write(data).await
    }

    /// 同步终端尺寸。
    pub async fn resize(&self, cols: u32, rows: u32) -> SshResult<()> {
        let shell = self.shell.lock().await;
        let shell = shell
            .as_ref()
            .ok_or_else(|| SshError::InvalidInput("会话还没有打开 shell".into()))?;

        shell.resize(cols, rows).await
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
                ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
                    stderr.extend_from_slice(&data)
                }
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
async fn pump_output(app: AppHandle, session_id: String, mut channel: russh::Channel<client::Msg>) {
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
            ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
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

        AuthMethod::Agent => {
            let mut agent = russh::keys::agent::client::AgentClient::connect_env()
                .await
                .map_err(SshError::Key)?;

            let identities = agent.request_identities().await.map_err(SshError::Key)?;

            // agent 里可能挂着多把钥匙，挨个试到有一把被接受
            let mut accepted = false;
            for key in identities {
                let hash_alg = handle.best_supported_rsa_hash().await?.flatten();

                let result = handle
                    .authenticate_publickey_with(&config.username, key, hash_alg, &mut agent)
                    .await?;

                if result.success() {
                    accepted = true;
                    break;
                }
            }
            accepted
        }
    };

    if !accepted {
        return Err(SshError::AuthRejected {
            method: config.auth.label(),
        });
    }

    Ok(())
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
