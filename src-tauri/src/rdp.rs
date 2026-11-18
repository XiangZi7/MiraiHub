//! IronRDP 客户端会话。网络、认证和图像解码在 Rust，WebView 消费变化区域。
mod clipboard;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ironrdp::{
    cliprdr::CliprdrClient,
    connector::connection_activation::{ConnectionActivationSequence, ConnectionActivationState},
    connector::{self, ClientConnector, Credentials, DesktopSize},
    core::WriteBuf,
    displaycontrol::client::DisplayControlClient,
    dvc::DrdynvcClient,
    graphics::image_processing::PixelFormat,
    input::{Database, MouseButton, MousePosition, Operation, Scancode, WheelRotations},
    pdu::{
        gcc::KeyboardType, geometry::InclusiveRectangle, rdp::capability_sets::MajorPlatformType,
    },
    session::{fast_path, image::DecodedImage, ActiveStage, ActiveStageBuilder, ActiveStageOutput},
};
use ironrdp_tokio::{Framed, FramedRead, FramedWrite, TokioFramed};
use rustls::{
    client::{
        danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
        WebPkiServerVerifier,
    },
    crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, RootCertStore, SignatureScheme,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{
    ipc::{Channel, Response},
    Manager, State, WebviewWindow,
};
use tokio::{
    net::TcpStream,
    sync::{mpsc, watch},
    time::{interval, timeout, MissedTickBehavior},
};
use x509_cert::der::Decode;

use crate::{
    error::{AppError, AppResult},
    platform::secure_storage,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_SESSIONS: usize = 8;
const MAX_WIDTH: u16 = 4096;
const MAX_HEIGHT: u16 = 2304;
const CREDENTIAL_CONTEXT: &str = "miraihub-rdp-v1";

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RdpTarget {
    host: String,
    port: u16,
    username: String,
}

impl RdpTarget {
    /// 将相同的主机写法归一化，确保密码仅用于保存时指定的目标和账号。
    fn normalize(mut self) -> AppResult<Self> {
        let host = self.host.trim();
        self.host = host
            .strip_prefix('[')
            .and_then(|host| host.strip_suffix(']'))
            .unwrap_or(host)
            .to_ascii_lowercase();
        self.username = self.username.trim().to_owned();
        if self.port == 0
            || self.username.is_empty()
            || self.username.len() > 1024
            || self.username.chars().any(char::is_control)
            || ServerName::try_from(self.host.as_str()).is_err()
        {
            return Err(AppError::invalid_input("请填写有效的远程桌面连接信息"));
        }
        Ok(self)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProtectedPassword {
    context: String,
    target: RdpTarget,
    password: String,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RdpSize {
    width: u16,
    height: u16,
}

impl RdpSize {
    /// RDP 显示控制要求宽度为偶数，并限制像素尺寸。
    fn is_valid(self) -> bool {
        (200..=MAX_WIDTH).contains(&self.width)
            && (200..=MAX_HEIGHT).contains(&self.height)
            && self.width % 2 == 0
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RdpRequest {
    session_id: String,
    target: RdpTarget,
    credential: String,
    desktop: RdpSize,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RdpEvent {
    Certificate {
        fingerprint: String,
        #[serde(
            rename = "previousFingerprint",
            skip_serializing_if = "Option::is_none"
        )]
        previous_fingerprint: Option<String>,
    },
    Connected,
    Clipboard {
        message: &'static str,
        error: bool,
    },
    Ended {
        error: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum RdpInput {
    Key {
        code: u16,
        pressed: bool,
    },
    Move {
        x: u16,
        y: u16,
    },
    Button {
        x: u16,
        y: u16,
        button: u8,
        pressed: bool,
    },
    Wheel {
        x: u16,
        y: u16,
        vertical: bool,
        delta: i16,
    },
    Resize {
        width: u16,
        height: u16,
    },
    ClipboardCopy,
    ClipboardPaste,
    ReleaseAll,
}

enum Command {
    Input(Vec<RdpInput>),
    TrustCertificate { fingerprint: String, remember: bool },
}

struct Session {
    commands: mpsc::Sender<Command>,
    cancel: watch::Sender<bool>,
}

type SessionMap = Arc<Mutex<HashMap<String, Session>>>;

#[derive(Default)]
pub struct RdpSessions(SessionMap);

/// 仅主工作区可以建立和控制内嵌远程桌面。
fn check_window(window: &WebviewWindow) -> AppResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(AppError::invalid_input("请从主窗口打开远程桌面"))
    }
}

/// 仅配置窗口可提交密码，返回当前系统用户保护的凭据密文。
#[tauri::command]
pub async fn rdp_protect_password(
    window: WebviewWindow,
    target: RdpTarget,
    password: String,
) -> AppResult<String> {
    if window.label() != "connection" {
        return Err(AppError::invalid_input("请在远程桌面配置窗口保存密码"));
    }
    protect_password(target.normalize()?, password)
}

/// 加密密码及其目标绑定，临时序列化缓冲区在加密完成后清空。
fn protect_password(target: RdpTarget, password: String) -> AppResult<String> {
    if password.is_empty() || password.len() > 8192 || password.contains('\0') {
        return Err(AppError::invalid_input("请输入有效的远程桌面密码"));
    }
    let mut plain = serde_json::to_vec(&ProtectedPassword {
        context: CREDENTIAL_CONTEXT.to_owned(),
        target,
        password,
    })
    .map_err(|_| AppError::internal("无法保存远程桌面密码"))?;
    let encrypted = secure_storage::protect(&plain, true);
    plain.fill(0);
    Ok(STANDARD.encode(encrypted?))
}

/// 从凭据密文恢复密码，拒绝跨目标、损坏或来自其他系统用户的凭据。
fn open_password(target: &RdpTarget, credential: &str) -> AppResult<String> {
    let invalid = || AppError::invalid_input("远程桌面凭据不可用，请在配置窗口重新保存密码");
    if credential.is_empty() || credential.len() > 100_000 {
        return Err(invalid());
    }
    let encrypted = STANDARD.decode(credential).map_err(|_| invalid())?;
    let mut plain = secure_storage::protect(&encrypted, false).map_err(|_| invalid())?;
    let decoded = serde_json::from_slice::<ProtectedPassword>(&plain);
    plain.fill(0);
    let saved = decoded.map_err(|_| invalid())?;
    if saved.context != CREDENTIAL_CONTEXT || &saved.target != target {
        return Err(invalid());
    }
    Ok(saved.password)
}

/// 创建会话任务，关闭标签时可取消仍处于连接或认证阶段的请求。
#[tauri::command]
pub async fn rdp_start(
    window: WebviewWindow,
    sessions: State<'_, RdpSessions>,
    mut request: RdpRequest,
    on_event: Channel<RdpEvent>,
    on_frame: Channel<Response>,
) -> AppResult<()> {
    check_window(&window)?;
    request.target = request.target.normalize()?;
    if !request.desktop.is_valid() || uuid::Uuid::parse_str(&request.session_id).is_err() {
        return Err(AppError::invalid_input("请填写有效的远程桌面连接信息"));
    }
    let trust_dir = window
        .path()
        .app_data_dir()
        .map_err(|_| AppError::internal("无法定位设置目录"))?
        .join("rdp-certificates");
    let id = request.session_id.clone();
    let (commands, receiver) = mpsc::channel(16);
    let (cancel, mut stopped) = watch::channel(false);
    let registry = sessions.0.clone();
    {
        let mut entries = registry.lock().unwrap_or_else(|error| error.into_inner());
        if entries.len() >= MAX_SESSIONS || entries.contains_key(&id) {
            return Err(AppError::invalid_input("无法开启更多远程桌面会话"));
        }
        entries.insert(id.clone(), Session { commands, cancel });
    }
    tokio::spawn(async move {
        let error = tokio::select! {
            _ = stopped.changed() => None,
            result = run(request, &on_event, &on_frame, receiver, trust_dir) => result.err().map(|error| error.message),
        };
        registry
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&id);
        let _ = on_event.send(RdpEvent::Ended { error });
    });
    Ok(())
}

/// 查找活跃会话的发件端，释放会话表锁后再等待队列。
async fn send_command(sessions: &RdpSessions, id: &str, command: Command) -> AppResult<()> {
    let sender = sessions
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(id)
        .map(|session| session.commands.clone())
        .ok_or_else(|| AppError::not_found("远程桌面已断开"))?;
    timeout(Duration::from_secs(2), sender.send(command))
        .await
        .map_err(|_| AppError::network("远程桌面输入超时"))?
        .map_err(|_| AppError::not_found("远程桌面已断开"))
}

/// 向对应会话发送一批鼠标和键盘事件。
#[tauri::command]
pub async fn rdp_input(
    window: WebviewWindow,
    sessions: State<'_, RdpSessions>,
    session_id: String,
    events: Vec<RdpInput>,
) -> AppResult<()> {
    check_window(&window)?;
    if events.is_empty() || events.len() > 64 {
        return Err(AppError::invalid_input("无效的远程桌面输入"));
    }
    send_command(&sessions, &session_id, Command::Input(events)).await
}

/// 确认当前握手的证书，并可将指纹保存到本机。
#[tauri::command]
pub async fn rdp_trust_certificate(
    window: WebviewWindow,
    sessions: State<'_, RdpSessions>,
    session_id: String,
    fingerprint: String,
    remember: bool,
) -> AppResult<()> {
    check_window(&window)?;
    send_command(
        &sessions,
        &session_id,
        Command::TrustCertificate {
            fingerprint,
            remember,
        },
    )
    .await
}

/// 停止会话。重复关闭已经结束的会话可以安全忽略。
#[tauri::command]
pub fn rdp_stop(
    window: WebviewWindow,
    sessions: State<'_, RdpSessions>,
    session_id: String,
) -> AppResult<()> {
    check_window(&window)?;
    if let Some(session) = sessions
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&session_id)
    {
        session.cancel.send_replace(true);
    }
    Ok(())
}

/// 生成 IronRDP 的 NLA 能力配置，兼容 DOMAIN\user 和 UPN 用户名。
fn connector_config(username: String, password: String, size: RdpSize) -> connector::Config {
    let (domain, username) = match username.split_once('\\') {
        Some((domain, user)) => (Some(domain.to_owned()), user.to_owned()),
        None => (None, username),
    };
    connector::Config {
        credentials: Credentials::UsernamePassword { username, password },
        domain,
        enable_tls: false,
        enable_credssp: true,
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: DesktopSize {
            width: size.width,
            height: size.height,
        },
        bitmap: None,
        client_build: 0,
        client_name: "MiraiHub".to_owned(),
        client_dir: String::new(),
        platform: if cfg!(windows) {
            MajorPlatformType::WINDOWS
        } else if cfg!(target_os = "macos") {
            MajorPlatformType::MACINTOSH
        } else {
            MajorPlatformType::UNIX
        },
        enable_server_pointer: false,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        compression_type: None,
        pointer_software_rendering: false,
        multitransport_flags: None,
        performance_flags: Default::default(),
        desktop_scale_factor: 0,
        hardware_id: None,
        license_cache: None,
        timezone_info: Default::default(),
        alternate_shell: String::new(),
        work_dir: String::new(),
    }
}

/// TLS 验证握手签名。证书身份在 TLS 成功后且 CredSSP 之前独立检查。
#[derive(Debug)]
struct PendingIdentity(WebPkiSupportedAlgorithms);

impl ServerCertVerifier for PendingIdentity {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, signature, &self.0)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, signature, &self.0)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.supported_schemes()
    }
}

/// 用本机可信根校验证书链和目标主机名。
fn system_trusts(
    cert: &CertificateDer<'_>,
    chain: &[CertificateDer<'_>],
    name: &ServerName<'_>,
) -> bool {
    static VERIFIER: OnceLock<Option<Arc<WebPkiServerVerifier>>> = OnceLock::new();
    VERIFIER
        .get_or_init(|| {
            let mut roots = RootCertStore::empty();
            roots.add_parsable_certificates(rustls_native_certs::load_native_certs().certs);
            WebPkiServerVerifier::builder_with_provider(
                Arc::new(roots),
                Arc::new(rustls::crypto::ring::default_provider()),
            )
            .build()
            .ok()
        })
        .as_ref()
        .is_some_and(|verifier| {
            verifier
                .verify_server_cert(cert, chain, name, &[], UnixTime::now())
                .is_ok()
        })
}

/// 每个规范化主机端口使用独立文件，避免不同连接复用证书信任。
fn certificate_pin_path(directory: &Path, host: &str, port: u16) -> PathBuf {
    let endpoint = format!("[{host}]:{port}");
    directory.join(format!("{:x}", Sha256::digest(endpoint.as_bytes())))
}

fn read_certificate_pin(path: &Path) -> AppResult<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(pin) => Ok(Some(pin)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(AppError::internal("无法读取已信任的远程桌面证书")),
    }
}

/// 原子替换指纹，同一主机的并发确认不能覆盖更新的信任决定。
fn remember_certificate_pin(
    path: &Path,
    previous: Option<&str>,
    fingerprint: &str,
) -> AppResult<()> {
    static WRITE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let current = read_certificate_pin(path)?;
    if current.as_deref() == Some(fingerprint) {
        return Ok(());
    }
    if current.as_deref() != previous {
        return Err(AppError::invalid_input("证书信任记录已变化，请重新连接"));
    }
    let temporary = path.with_extension(uuid::Uuid::new_v4().to_string());
    let write = || -> std::io::Result<()> {
        use std::io::Write;
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory)?;
        }
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(fingerprint.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    };
    write().map_err(|_| {
        let _ = std::fs::remove_file(&temporary);
        AppError::internal("无法保存远程桌面证书信任记录")
    })
}

/// 完成 TCP、TLS 和 CredSSP。等到证书获信任才发送 Windows 登录凭据。
async fn run(
    request: RdpRequest,
    events: &Channel<RdpEvent>,
    frames: &Channel<Response>,
    mut commands: mpsc::Receiver<Command>,
    trust_dir: PathBuf,
) -> AppResult<()> {
    let password = open_password(&request.target, &request.credential)?;
    let RdpTarget {
        host,
        port,
        username,
    } = request.target;
    let max_monitor_area = Arc::new(AtomicU64::new(0));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let name = ServerName::try_from(host.clone())
        .map_err(|_| AppError::invalid_input("请填写有效的远程桌面连接信息"))?;
    let mut tls_config = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|_| AppError::internal("无法初始化远程桌面 TLS"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PendingIdentity(
            provider.signature_verification_algorithms,
        )))
        .with_no_client_auth();
    tls_config.resumption = rustls::client::Resumption::disabled();

    let (tls, upgraded, connector, leftover) = timeout(CONNECT_TIMEOUT, async {
        let stream = TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|_| AppError::network("无法到达远程桌面主机或端口"))?;
        stream.set_nodelay(true)?;
        let config = connector_config(username, password, request.desktop);
        let mut connector = ClientConnector::new(config, stream.local_addr()?);
        let area = max_monitor_area.clone();
        let display = DisplayControlClient::new(move |caps| {
            area.store(caps.max_monitor_area(), Ordering::Relaxed);
            Ok(Vec::new())
        });
        connector.attach_static_channel(DrdynvcClient::new().with_dynamic_channel(display));
        connector.attach_static_channel(CliprdrClient::new(Box::new(
            clipboard::SessionClipboard::default(),
        )));
        let mut initial = TokioFramed::new(stream);
        let upgrade = ironrdp_tokio::connect_begin(&mut initial, &mut connector)
            .await
            .map_err(|error| {
                log::debug!("RDP 协商失败: {error}");
                AppError::network("远程桌面协议协商失败")
            })?;
        let (stream, leftover) = initial.into_inner();
        let tls = tokio_rustls::TlsConnector::from(Arc::new(tls_config))
            .connect(name.clone(), stream)
            .await
            .map_err(|error| {
                log::debug!("RDP TLS 失败: {error}");
                AppError::network("远程桌面 TLS 握手失败")
            })?;
        let upgraded = ironrdp_tokio::mark_as_upgraded(upgrade, &mut connector);
        Ok::<_, AppError>((tls, upgraded, connector, leftover))
    })
    .await
    .map_err(|_| AppError::network("远程桌面连接超时"))??;

    let (certificate, chain) = tls
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|certificates| certificates.split_first())
        .ok_or_else(|| AppError::network("远程桌面主机没有提供证书"))?;
    let pin_path = certificate_pin_path(&trust_dir, &host, port);
    let previous = tokio::task::spawn_blocking({
        let pin_path = pin_path.clone();
        move || read_certificate_pin(&pin_path)
    })
    .await
    .map_err(|_| AppError::internal("无法读取已信任的远程桌面证书"))??;
    let fingerprint = Sha256::digest(certificate)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":");
    let trusted = match &previous {
        Some(pin) => pin == &fingerprint,
        None => system_trusts(certificate, chain, &name),
    };
    if !trusted {
        events
            .send(RdpEvent::Certificate {
                fingerprint: fingerprint.clone(),
                previous_fingerprint: previous.clone(),
            })
            .map_err(|_| AppError::internal("远程桌面标签页已关闭"))?;
        let Ok(Some(Command::TrustCertificate {
            fingerprint: confirmed,
            remember,
        })) = timeout(Duration::from_secs(120), commands.recv()).await
        else {
            return Err(AppError::invalid_input("远程桌面证书未确认"));
        };
        if confirmed != fingerprint {
            return Err(AppError::invalid_input("远程桌面证书未确认"));
        }
        if remember {
            tokio::task::spawn_blocking(move || {
                remember_certificate_pin(&pin_path, previous.as_deref(), &fingerprint)
            })
            .await
            .map_err(|_| AppError::internal("无法保存远程桌面证书信任记录"))??;
        }
    }
    let certificate = x509_cert::Certificate::from_der(certificate)
        .map_err(|_| AppError::network("无法读取远程桌面证书"))?;
    let public_key = certificate
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .ok_or_else(|| AppError::network("无法读取远程桌面证书"))?
        .to_vec();
    let mut framed = TokioFramed::new_with_leftover(tls, leftover);
    let result = timeout(
        CONNECT_TIMEOUT,
        ironrdp_tokio::connect_finalize(
            upgraded,
            connector,
            &mut framed,
            &mut ironrdp_tokio::reqwest::ReqwestNetworkClient::new(),
            host.into(),
            public_key,
            None,
        ),
    )
    .await
    .map_err(|_| AppError::network("远程桌面连接超时"))?
    .map_err(|_| AppError::network("远程桌面登录失败，请检查 Windows 用户名和密码"))?;

    let mut image = new_image(result.desktop_size)?;
    let activation = result.activation_factory;
    let mut stage = ActiveStageBuilder {
        static_channels: result.static_channels,
        user_channel_id: result.user_channel_id,
        io_channel_id: result.io_channel_id,
        message_channel_id: result.message_channel_id,
        share_id: result.share_id,
        compression_type: result.compression_type,
        enable_server_pointer: result.enable_server_pointer,
        pointer_software_rendering: result.pointer_software_rendering,
    }
    .build();
    let mut input = Database::new();
    let mut dirty = None::<InclusiveRectangle>;
    let mut pending_resize = None::<RdpSize>;
    let mut refresh = interval(Duration::from_millis(33));
    refresh.set_missed_tick_behavior(MissedTickBehavior::Skip);
    events
        .send(RdpEvent::Connected)
        .map_err(|_| AppError::internal("远程桌面标签页已关闭"))?;

    let (mut reader, mut writer) = ironrdp_tokio::split_tokio_framed(framed);
    loop {
        let output = tokio::select! {
            pdu = reader.read_pdu() => {
                let (action, data) = pdu.map_err(|_| AppError::network("远程桌面连接已中断"))?;
                stage.process(&mut image, action, &data)
            }
            next = commands.recv() => match next {
                Some(Command::Input(batch)) => {
                    let mut output = Vec::new();
                    for event in batch {
                        if let RdpInput::Resize { width, height } = event {
                            let size = RdpSize { width, height };
                            if size.is_valid() {
                                pending_resize = Some(size);
                            }
                            continue;
                        }
                        if matches!(event, RdpInput::ClipboardCopy) {
                            clipboard::begin_copy(&mut stage);
                        }
                        if matches!(event, RdpInput::ClipboardPaste) {
                            match clipboard::begin_paste(&mut stage).await {
                                clipboard::Paste::Forward => {}
                                clipboard::Paste::Skip => continue,
                                clipboard::Paste::Wait(frame) => {
                                    output.push(ActiveStageOutput::ResponseFrame(frame));
                                    continue;
                                }
                            }
                        }
                        output.extend(stage.process_fastpath_input(&mut image, &input_events(&mut input, event))
                            .map_err(|_| AppError::internal("无法发送远程桌面输入"))?);
                    }
                    Ok(output)
                }
                Some(Command::TrustCertificate { .. }) => continue,
                None => return Ok(()),
            },
            _ = refresh.tick() => {
                if let Some(region) = dirty.take() { send_frame(frames, &image, region)?; }
                Ok(Vec::new())
            }
        }.map_err(|_| AppError::network("无法处理远程桌面会话数据"))?;

        for item in output {
            match item {
                ActiveStageOutput::ResponseFrame(data) => writer
                    .write_all(&data)
                    .await
                    .map_err(|_| AppError::network("远程桌面连接已中断"))?,
                ActiveStageOutput::GraphicsUpdate(region) => {
                    dirty = Some(match dirty {
                        Some(prev) => InclusiveRectangle {
                            left: prev.left.min(region.left),
                            top: prev.top.min(region.top),
                            right: prev.right.max(region.right),
                            bottom: prev.bottom.max(region.bottom),
                        },
                        None => region,
                    });
                }
                ActiveStageOutput::Terminate(_) => return Ok(()),
                ActiveStageOutput::DeactivateAll => {
                    image = timeout(
                        CONNECT_TIMEOUT,
                        reactivate(&mut reader, &mut writer, &mut stage, activation.create()),
                    )
                    .await
                    .map_err(|_| AppError::network("远程桌面显示模式切换失败"))??;
                    dirty = Some(InclusiveRectangle {
                        left: 0,
                        top: 0,
                        right: image.width() - 1,
                        bottom: image.height() - 1,
                    });
                }
                _ => {}
            }
        }
        let (clipboard_frames, paste) = clipboard::poll(&mut stage, |message, error| {
            let _ = events.send(RdpEvent::Clipboard { message, error });
        })
        .await;
        for frame in clipboard_frames {
            writer.write_all(&frame).await?;
        }
        if paste {
            for item in stage
                .process_fastpath_input(
                    &mut image,
                    &input_events(&mut input, RdpInput::ClipboardPaste),
                )
                .map_err(|_| AppError::internal("无法发送远程桌面输入"))?
            {
                if let ActiveStageOutput::ResponseFrame(frame) = item {
                    writer.write_all(&frame).await?;
                }
            }
        }
        if let Some(size) = pending_resize {
            let limit = max_monitor_area.load(Ordering::Relaxed);
            if size.width == image.width() && size.height == image.height() {
                pending_resize = None;
            } else if limit > 0 && u64::from(size.width) * u64::from(size.height) <= limit {
                if let Some(frame) =
                    stage.encode_resize(size.width.into(), size.height.into(), None, None)
                {
                    pending_resize = None;
                    if let Ok(frame) = frame {
                        writer.write_all(&frame).await?;
                    }
                }
            }
        }
    }
}

/// 在初次连接和显示模式切换时统一限制远端帧缓冲区尺寸。
fn new_image(size: DesktopSize) -> AppResult<DecodedImage> {
    if size.width == 0 || size.height == 0 || size.width > MAX_WIDTH || size.height > MAX_HEIGHT {
        return Err(AppError::invalid_input("远程桌面的分辨率超出支持范围"));
    }
    Ok(DecodedImage::new(
        PixelFormat::RgbA32,
        size.width,
        size.height,
    ))
}

/// Windows 更改桌面模式时完成 IronRDP 的重新激活序列，更新帧尺寸与会话通道。
async fn reactivate<R: FramedRead, W: FramedWrite>(
    reader: &mut Framed<R>,
    writer: &mut Framed<W>,
    stage: &mut ActiveStage,
    mut activation: ConnectionActivationSequence,
) -> AppResult<DecodedImage> {
    let mut write = WriteBuf::new();
    loop {
        let response =
            ironrdp_tokio::single_sequence_step_read(reader, &mut activation, &mut write)
                .await
                .map_err(|_| AppError::network("远程桌面显示模式切换失败"))?;
        if response.size().is_some() {
            writer.write_all(write.filled()).await?;
        }
        if let ConnectionActivationState::Finalized {
            desktop_size,
            share_id,
            enable_server_pointer,
            pointer_software_rendering,
        } = activation.connection_activation_state()
        {
            let image = new_image(desktop_size)?;
            stage.set_fastpath_processor(
                fast_path::ProcessorBuilder {
                    io_channel_id: activation.io_channel_id(),
                    user_channel_id: activation.user_channel_id(),
                    share_id,
                    enable_server_pointer,
                    pointer_software_rendering,
                    bulk_decompressor: None,
                }
                .build(),
            );
            stage.set_share_id(share_id);
            stage.set_enable_server_pointer(enable_server_pointer);
            return Ok(image);
        }
    }
}

/// 复用 IronRDP 的输入状态，在失去焦点时释放修饰键和鼠标按键。
fn input_events(
    state: &mut Database,
    event: RdpInput,
) -> Vec<ironrdp::pdu::input::fast_path::FastPathInputEvent> {
    match event {
        RdpInput::Resize { .. } => return Vec::new(),
        RdpInput::ClipboardCopy => return clipboard_shortcut(state, 0x2e),
        RdpInput::ClipboardPaste => return clipboard_shortcut(state, 0x2f),
        RdpInput::ReleaseAll => state.release_all(),
        RdpInput::Key { code, pressed } => {
            let code = Scancode::from_u16(code);
            state.apply([if pressed {
                Operation::KeyPressed(code)
            } else {
                Operation::KeyReleased(code)
            }])
        }
        RdpInput::Move { x, y } => state.apply([Operation::MouseMove(MousePosition { x, y })]),
        RdpInput::Button {
            x,
            y,
            button,
            pressed,
        } => {
            let Some(button) = MouseButton::from_idx(usize::from(button)) else {
                return Vec::new();
            };
            state.apply([
                Operation::MouseMove(MousePosition { x, y }),
                if pressed {
                    Operation::MouseButtonPressed(button)
                } else {
                    Operation::MouseButtonReleased(button)
                },
            ])
        }
        RdpInput::Wheel {
            x,
            y,
            vertical,
            delta,
        } => state.apply([
            Operation::MouseMove(MousePosition { x, y }),
            Operation::WheelRotations(WheelRotations {
                is_vertical: vertical,
                rotation_units: delta.clamp(-255, 255),
            }),
        ]),
    }
    .into_vec()
}

/// 以小端尺寸和坐标为头部，仅发送变化矩形内的紧凑 RGBA 行。
fn send_frame(
    frames: &Channel<Response>,
    image: &DecodedImage,
    region: InclusiveRectangle,
) -> AppResult<()> {
    let x = region.left;
    let y = region.top;
    let right = region.right.min(image.width() - 1);
    let bottom = region.bottom.min(image.height() - 1);
    if x > right || y > bottom {
        return Ok(());
    }
    let width = right - x + 1;
    let height = bottom - y + 1;
    let row = usize::from(width) * 4;
    let mut data = Vec::with_capacity(12 + row * usize::from(height));
    for value in [image.width(), image.height(), x, y, width, height] {
        data.extend_from_slice(&value.to_le_bytes());
    }
    for line in y..=bottom {
        let offset = usize::from(line) * image.stride() + usize::from(x) * 4;
        data.extend_from_slice(&image.data()[offset..offset + row]);
    }
    for alpha in data[15..].iter_mut().step_by(4) {
        *alpha = 255;
    }
    frames
        .send(Response::new(data))
        .map_err(|_| AppError::internal("远程桌面标签页已关闭"))
}

/// 剪贴板通道应答可能晚于 Ctrl 松开，补齐组合键但保留真正按下的修饰键。
fn clipboard_shortcut(
    state: &mut Database,
    key: u16,
) -> Vec<ironrdp::pdu::input::fast_path::FastPathInputEvent> {
    let left_ctrl = Scancode::from_u16(0x1d);
    let right_ctrl = Scancode::from_u16(0xe01d);
    let key = Scancode::from_u16(key);
    let press = Operation::KeyPressed(key);
    let release = Operation::KeyReleased(key);
    if state.is_key_pressed(left_ctrl) || state.is_key_pressed(right_ctrl) {
        state.apply([press, release])
    } else {
        state.apply([
            Operation::KeyPressed(left_ctrl),
            press,
            release,
            Operation::KeyReleased(left_ctrl),
        ])
    }
    .into_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ironrdp::pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn remembered_certificate_is_scoped_to_the_endpoint_and_replaced_after_review() {
        let directory = std::env::temp_dir().join(format!("miraihub-rdp-{}", uuid::Uuid::new_v4()));
        let path = certificate_pin_path(&directory, "rdp.example.test", 3389);
        let other_port = certificate_pin_path(&directory, "rdp.example.test", 3390);
        let other_host = certificate_pin_path(&directory, "other.example.test", 3389);
        assert_eq!(read_certificate_pin(&path).unwrap(), None);
        remember_certificate_pin(&path, None, "01:02").unwrap();
        assert_eq!(read_certificate_pin(&other_port).unwrap(), None);
        assert_eq!(read_certificate_pin(&other_host).unwrap(), None);
        assert!(remember_certificate_pin(&path, None, "03:04").is_err());
        remember_certificate_pin(&path, Some("01:02"), "03:04").unwrap();
        assert_eq!(
            read_certificate_pin(&path).unwrap().as_deref(),
            Some("03:04")
        );
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn delayed_paste_preserves_the_physical_control_key_state() {
        let mut input = Database::new();
        let idle_chord = input_events(&mut input, RdpInput::ClipboardPaste);
        assert_eq!(idle_chord.len(), 4);
        let right_ctrl = Scancode::from_u16(0xe01d);
        assert!(!input.is_key_pressed(Scancode::from_u16(0x1d)));
        input.apply([Operation::KeyPressed(right_ctrl)]);
        let held_chord = input_events(&mut input, RdpInput::ClipboardPaste);
        assert_eq!(held_chord.len(), 2);
        assert!(input.is_key_pressed(right_ctrl));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn saved_password_is_bound_to_the_normalized_endpoint_and_username() {
        let target = |host: &str, port, username: &str| {
            RdpTarget {
                host: host.to_owned(),
                port,
                username: username.to_owned(),
            }
            .normalize()
            .unwrap()
        };
        let credential = protect_password(
            target(" [2001:DB8::1] ", 3389, "operator"),
            "desktop-password".to_owned(),
        )
        .unwrap();
        assert_eq!(
            open_password(&target("2001:db8::1", 3389, "operator"), &credential).unwrap(),
            "desktop-password"
        );
        assert!(open_password(&target("2001:db8::1", 3390, "operator"), &credential).is_err());
        assert!(open_password(&target("2001:db8::1", 3389, "other"), &credential).is_err());
    }

    #[test]
    fn dirty_rectangle_is_sent_as_tightly_packed_opaque_rgba() {
        let image = new_image(DesktopSize {
            width: 4,
            height: 3,
        })
        .unwrap();
        let received = Arc::new(Mutex::new(Vec::new()));
        let result = received.clone();
        let channel = Channel::new(move |response| {
            let InvokeResponseBody::Raw(bytes) = response else {
                panic!("expected a raw image update");
            };
            *result.lock().unwrap() = bytes;
            Ok(())
        });
        send_frame(
            &channel,
            &image,
            InclusiveRectangle {
                left: 1,
                top: 1,
                right: 2,
                bottom: 2,
            },
        )
        .unwrap();
        let bytes = received.lock().unwrap();
        assert_eq!(&bytes[..12], &[4, 0, 3, 0, 1, 0, 1, 0, 2, 0, 2, 0]);
        assert_eq!(&bytes[12..], &[0, 0, 0, 255].repeat(4));
    }

    #[test]
    fn losing_focus_releases_extended_modifier_keys() {
        let mut input = Database::new();
        let pressed = input_events(
            &mut input,
            RdpInput::Key {
                code: 0xe01d,
                pressed: true,
            },
        );
        assert_eq!(
            pressed,
            [FastPathInputEvent::KeyboardEvent(
                KeyboardFlags::EXTENDED,
                0x1d
            )]
        );
        let released = input_events(&mut input, RdpInput::ReleaseAll);
        assert_eq!(
            released,
            [FastPathInputEvent::KeyboardEvent(
                KeyboardFlags::EXTENDED | KeyboardFlags::RELEASE,
                0x1d
            )]
        );
        assert!(input_events(&mut input, RdpInput::ReleaseAll).is_empty());
    }
}
