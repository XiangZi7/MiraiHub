//! AI credentials never enter generic frontend settings or logs.
use super::limits::Limits;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    #[serde(default)]
    pub limits: Limits,
    #[serde(default)]
    pub api_format: ApiFormat,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            limits: Limits::default(),
            api_format: ApiFormat::Openai,
            enabled: false,
            base_url: "https://api.openai.com/v1".into(),
            model: String::new(),
            api_key: String::new(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfig {
    pub limits: Limits,
    pub id: String,
    pub name: String,
    pub api_format: ApiFormat,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}
impl Config {
    pub fn public(&self, id: &str, name: &str) -> PublicConfig {
        PublicConfig {
            limits: self.limits,
            id: id.into(),
            name: name.into(),
            api_format: self.api_format,
            enabled: self.enabled,
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            has_api_key: !self.api_key.is_empty(),
        }
    }
    pub fn ready(&self) -> AppResult<()> {
        self.limits.validate()?;
        validate_url(&self.base_url)?;
        if !self.enabled || self.model.trim().is_empty() {
            return Err(AppError::invalid_input(
                "请先在设置 → AI Agent 中启用并填写模型",
            ));
        }
        Ok(())
    }
}
pub fn validate_url(raw: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(raw).map_err(|_| AppError::invalid_input("API 地址无效"))?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::invalid_input(
            "API 地址必须使用 HTTPS（本机可用 HTTP），不能包含账号、查询参数或片段",
        ));
    }
    Ok(url)
}
#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ApiFormat {
    #[default]
    Openai,
    Responses,
    Anthropic,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub config: Config,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub active_id: String,
    pub profiles: Vec<Profile>,
    /// External MCP servers. Secrets travel with the profiles, so they share this
    /// encrypted file instead of the generic settings store.
    #[serde(default)]
    pub mcp_servers: Vec<super::mcp::McpServer>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub active_id: String,
    pub profiles: Vec<PublicConfig>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub config: Config,
}
impl Settings {
    pub fn public(&self) -> PublicSettings {
        PublicSettings {
            active_id: self.active_id.clone(),
            profiles: self
                .profiles
                .iter()
                .map(|p| p.config.public(&p.id, &p.name))
                .collect(),
        }
    }
    pub fn profile(&self, id: &str) -> AppResult<&Profile> {
        self.profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::invalid_input("AI 配置不存在，请重新选择或添加配置"))
    }
    pub fn active(&self) -> AppResult<Config> {
        Ok(self.profile(&self.active_id)?.config.clone())
    }
    pub fn upsert(&mut self, input: ProfileInput, clear_key: bool) -> AppResult<()> {
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err(AppError::invalid_input("请填写配置名称（最多 80 字）"));
        }
        let previous = match input.id.as_deref() {
            Some(id) => self.profile(id)?.config.clone(),
            None => Config::default(),
        };
        let config = resolve_credentials(input.config, previous, clear_key)?;
        if config.enabled {
            config.ready()?;
        }
        if let Some(id) = input.id {
            let profile = self.profiles.iter_mut().find(|p| p.id == id).unwrap();
            profile.name = name.into();
            profile.config = config;
            self.active_id = id;
        } else {
            if self.profiles.len() >= 100 {
                return Err(AppError::invalid_input("最多保存 100 个 AI 配置"));
            }
            let id = super::id();
            self.profiles.push(Profile {
                id: id.clone(),
                name: name.into(),
                config,
            });
            self.active_id = id;
        }
        Ok(())
    }
    pub fn activate(&mut self, id: &str) -> AppResult<()> {
        self.profile(id)?.config.ready()?;
        self.active_id = id.into();
        Ok(())
    }
    pub fn remove(&mut self, id: &str) -> AppResult<()> {
        self.profile(id)?;
        self.profiles.retain(|p| p.id != id);
        if self.active_id == id {
            // Deletion must not silently route the next prompt to another provider.
            self.active_id.clear();
        }
        Ok(())
    }
}
fn decode(bytes: &[u8]) -> AppResult<Settings> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Stored {
        Current(Settings),
        Legacy(Config),
    }
    let result = serde_json::from_slice::<Stored>(bytes)
        .map_err(|_| AppError::internal("AI 设置损坏，无法读取"))?;
    Ok(match result {
        Stored::Current(settings) => settings,
        Stored::Legacy(config) => Settings {
            active_id: "legacy-default".into(),
            profiles: vec![Profile {
                id: "legacy-default".into(),
                name: "原有配置".into(),
                config,
            }],
            mcp_servers: Vec::new(),
        },
    })
}
pub fn read(app: &AppHandle) -> AppResult<Settings> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::internal("无法定位设置目录"))?
        .join("ai-settings.bin");
    match std::fs::read(path) {
        Ok(bytes) => decode(&protect(&bytes, false)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(error.into()),
    }
}
// Shared by saving and model discovery; resolving a draft never persists it.
pub(super) fn resolve_credentials(
    mut next: Config,
    previous: Config,
    clear_key: bool,
) -> AppResult<Config> {
    next.limits.validate()?;
    next.base_url = next.base_url.trim().trim_end_matches('/').into();
    next.model = next.model.trim().into();
    next.api_key = next.api_key.trim().into();
    validate_url(&next.base_url)?;
    if next.model.len() > 200 || next.api_key.len() > 8192 || next.api_key.contains(['\r', '\n']) {
        return Err(AppError::invalid_input("模型或密钥格式无效"));
    }
    if clear_key {
        next.api_key.clear();
    } else if next.api_key.is_empty() {
        if next.base_url != previous.base_url && !previous.api_key.is_empty() {
            return Err(AppError::invalid_input(
                "更换服务地址时请重新输入密钥或选择清除旧密钥，避免将旧密钥发送到其他服务",
            ));
        }
        next.api_key = previous.api_key;
    }
    Ok(next)
}
pub fn save(app: &AppHandle, next: &Settings) -> AppResult<PublicSettings> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::internal("无法定位设置目录"))?;
    std::fs::create_dir_all(&dir)?;
    let bytes = serde_json::to_vec(&next).map_err(|_| AppError::internal("保存 AI 设置失败"))?;
    // Entire file is encrypted for the current OS user; never write a plaintext temp file.
    let temporary = dir.join("ai-settings.bin.tmp");
    let encrypted = protect(&bytes, true)?;
    use std::io::Write;
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(&encrypted)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&temporary, dir.join("ai-settings.bin"))?;
    Ok(next.public())
}
#[cfg(windows)]
pub(super) fn protect(bytes: &[u8], encrypt: bool) -> AppResult<Vec<u8>> {
    use windows::Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if encrypt {
            CryptProtectData(
                &input,
                windows::core::PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|_| AppError::internal("Windows 凭据加密/解密失败"))?;
        let data = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(data)
    }
}
#[cfg(not(windows))]
pub(super) fn protect(_bytes: &[u8], _encrypt: bool) -> AppResult<Vec<u8>> {
    Err(AppError::invalid_input(
        "此平台尚未接入系统密钥存储，AI 配置暂不可保存",
    ))
}

pub(super) fn client() -> AppResult<reqwest::Client> {
    build_client(false)
}
pub(super) fn streaming_client() -> AppResult<reqwest::Client> {
    build_client(true)
}
fn build_client(streaming: bool) -> AppResult<reqwest::Client> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        // Streaming heartbeats/reasoning count as activity. A long answer must not
        // be cut off after 60 seconds while the provider is still sending data.
        .read_timeout(std::time::Duration::from_secs(if streaming {
            300
        } else {
            60
        }))
        .timeout(std::time::Duration::from_secs(if streaming {
            1800
        } else {
            60
        }))
        .build()
        .map_err(|_| AppError::internal("无法创建模型客户端"))
}
pub async fn completion(
    config: &Config,
    messages: &[serde_json::Value],
    tools: Option<serde_json::Value>,
) -> AppResult<serde_json::Value> {
    super::protocol::completion(config, messages, tools).await
}
pub(super) async fn request_json(request: reqwest::RequestBuilder) -> AppResult<serde_json::Value> {
    let response = check_status(request.send().await.map_err(request_error)?).await?;
    response_json(response).await
}
pub(super) fn request_error(error: reqwest::Error) -> AppError {
    // Do not expose URLs, headers or the request body (may contain secrets).
    // Everything except a malformed request is a transport failure, so it is
    // reported as `Network` and the agent may send the same request again.
    if error.is_builder() {
        AppError::internal("模型连接中断或请求失败，请检查网络与中转站状态")
    } else if error.is_timeout() {
        AppError::network(
            "模型连接或响应超时，请稍后重试；长上下文、模型思考或中转站拥堵可能增加等待时间",
        )
    } else if error.is_connect() {
        AppError::network("无法连接模型服务，请检查网络、证书及 API 地址")
    } else {
        AppError::network("模型连接中断或请求失败，请检查网络与中转站状态")
    }
}
pub(super) async fn check_status(response: reqwest::Response) -> AppResult<reqwest::Response> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let headers = response.headers();
    let retry_after = retry_after(headers, std::time::SystemTime::now());
    let should_retry = headers
        .get("x-should-retry")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| match value.trim().to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        });
    let body = bounded_bytes(response, 8192).await;
    let message = match provider_detail_bytes(&body) {
        Some(detail) => format!("模型服务错误：HTTP {status} · {detail}"),
        None => format!("模型服务未说明错误：HTTP {status}"),
    };
    let transient =
        should_retry.unwrap_or_else(|| transient_status(status) && !quota_exhausted(&body));
    let mut error = if transient {
        AppError::network(message)
    } else {
        AppError::internal(message)
    };
    error.retry_after = retry_after;
    Err(error)
}
/// Statuses where sending the same request again can succeed: request timeout,
/// conflicts, rate limits (429) and server-side failures such as 503 or 529 overload.
fn transient_status(status: u16) -> bool {
    matches!(status, 408 | 409 | 425 | 429) || (status >= 500 && !matches!(status, 501 | 505))
}
/// A rate limit clears on its own; an exhausted balance or quota does not.
fn quota_exhausted(body: &[u8]) -> bool {
    let body = String::from_utf8_lossy(body).to_ascii_lowercase();
    [
        "insufficient_quota",
        "insufficient_balance",
        "insufficient balance",
        "余额不足",
        "额度不足",
        "额度已用尽",
    ]
    .iter()
    .any(|needle| body.contains(needle))
}
/// An error object a provider sends with HTTP 200, in a stream or a JSON body. Such
/// failures are usually upstream overload, rate limiting or a dropped upstream
/// connection, so they are transient unless the provider marks the request itself
/// as rejected (invalid, unauthorized, filtered or out of quota).
pub(super) fn provider_error(error: &serde_json::Value) -> AppError {
    let message = match provider_detail(error) {
        Some(detail) => format!("模型服务错误：{detail}"),
        None => "模型服务在生成过程中返回错误，请检查模型与中转站状态".into(),
    };
    if transient_error(error) {
        AppError::network(message)
    } else {
        AppError::internal(message)
    }
}
fn transient_error(error: &serde_json::Value) -> bool {
    const REJECTED: [&str; 9] = [
        "invalid",
        "auth",
        "permission",
        "not_found",
        "context_length",
        "content",
        "policy",
        "safety",
        "unsupported",
    ];
    if quota_exhausted(error.to_string().as_bytes()) {
        return false;
    }
    let inner = if error["error"].is_object() {
        &error["error"]
    } else {
        error
    };
    let fields = [&inner["code"], &inner["status"], &inner["type"]];
    // Gemini-style errors carry the HTTP status as a number.
    if let Some(status) = fields.iter().find_map(|value| value.as_u64()) {
        return u16::try_from(status).is_ok_and(transient_status);
    }
    let labels = fields
        .iter()
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    !REJECTED.iter().any(|marker| labels.contains(marker))
}
/// The wait a provider asks for: `retry-after-ms` (OpenAI/Anthropic SDK convention),
/// then `Retry-After` as seconds or an HTTP date. Absurd values are capped.
fn retry_after(
    headers: &reqwest::header::HeaderMap,
    now: std::time::SystemTime,
) -> Option<std::time::Duration> {
    const MAX: std::time::Duration = std::time::Duration::from_secs(600);
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
    };
    let seconds = |text: &str, scale: f64| {
        text.parse::<f64>()
            .ok()
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(|value| std::time::Duration::from_secs_f64((value / scale).min(MAX.as_secs_f64())))
    };
    if let Some(delay) = header("retry-after-ms").and_then(|text| seconds(text, 1000.0)) {
        return Some(delay);
    }
    let text = header("retry-after")?;
    seconds(text, 1.0).or_else(|| {
        let date = chrono::DateTime::parse_from_rfc2822(text).ok()?;
        let delay = std::time::SystemTime::from(date)
            .duration_since(now)
            .unwrap_or_default();
        Some(delay.min(MAX))
    })
}
/// The provider's own wording is the most useful diagnostic, so it is surfaced instead
/// of a bare status code. Credential-shaped tokens are masked and the text is bounded;
/// request URLs, headers and bodies still never leave the process.
pub(super) fn provider_detail(error: &serde_json::Value) -> Option<String> {
    // Only the fields providers use for their own wording. A bare `error` value can be
    // an object carrying echoed request data, so it is never quoted as a whole.
    let paths: [&[&str]; 4] = [
        &["error", "message"],
        &["message"],
        &["detail"],
        &["error", "code"],
    ];
    paths
        .iter()
        .filter_map(|path| path.iter().fold(error, |value, key| &value[*key]).as_str())
        .map(|text| scrub(&clip_inline(text, 500)))
        .find(|detail| !detail.is_empty())
}
fn provider_detail_bytes(body: &[u8]) -> Option<String> {
    // Only fields a provider uses for its own message are forwarded. An arbitrary
    // body can carry echoed credentials, so anything unrecognized stays unquoted.
    let body = String::from_utf8_lossy(body);
    serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| provider_detail(&value))
}
/// A provider may echo the key it received; never let it round-trip into the panel or history.
pub(super) fn redact(config: &Config, mut error: AppError) -> AppError {
    if config.api_key.len() >= 8 {
        error.message = error.message.replace(&config.api_key, "***");
    }
    error
}
/// One line is enough for an error; collapsing whitespace also makes masking reliable.
fn clip_inline(text: &str, max: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max {
        return collapsed;
    }
    format!("{}…", collapsed.chars().take(max).collect::<String>())
}
/// Masks credentials a provider may quote back, for example
/// "Incorrect API key provided: sk-…". `redact` additionally covers the configured
/// key, including keys without a recognizable prefix.
fn scrub(text: &str) -> String {
    const PREFIXES: [&str; 6] = ["sk-", "sk_", "pat-", "ghp_", "xoxb-", "api_key="];
    let mut words: Vec<&str> = Vec::new();
    let mut mask_next = false;
    for word in text.split(' ') {
        let lower = word.to_ascii_lowercase();
        let credential = word.len() >= 12 && PREFIXES.iter().any(|prefix| lower.contains(prefix));
        words.push(if std::mem::take(&mut mask_next) || credential {
            "***"
        } else {
            word
        });
        mask_next = lower.trim_end_matches(':') == "bearer";
    }
    words.join(" ")
}
async fn bounded_bytes(mut response: reqwest::Response, max: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        let room = max.saturating_sub(bytes.len());
        if room == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
    }
    bytes
}
pub(super) async fn response_json(mut response: reqwest::Response) -> AppResult<serde_json::Value> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(request_error)? {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err(AppError::invalid_input("模型响应超过 1 MB 限制"));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| AppError::invalid_input("模型响应不是有效 JSON"))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn input(id: Option<&str>, name: &str, url: &str, key: &str) -> ProfileInput {
        ProfileInput {
            id: id.map(str::to_owned),
            name: name.into(),
            config: Config {
                enabled: true,
                base_url: url.into(),
                model: "test-model".into(),
                api_key: key.into(),
                ..Config::default()
            },
        }
    }
    #[test]
    fn migrates_old_encrypted_payload_without_losing_key_or_enablement() {
        let settings = decode(br#"{"enabled":true,"baseUrl":"https://old.example/v1","model":"old-model","apiKey":"old-test-key"}"#).unwrap();
        assert_eq!(settings.active_id, "legacy-default");
        let active = settings.active().unwrap();
        assert_eq!(active.api_key, "old-test-key");
        assert_eq!(active.api_format, ApiFormat::Openai);
        assert_eq!(active.limits, Limits::default());
        let serialized = serde_json::to_vec(&settings).unwrap();
        assert_eq!(
            decode(&serialized).unwrap().active().unwrap().model,
            "old-model"
        );
        let public = serde_json::to_string(&settings.public()).unwrap();
        assert!(!public.contains("old-test-key"));
        assert!(public.contains("hasApiKey"));
        assert!(decode(br#"{"unexpected":true}"#).is_err());
    }
    #[test]
    fn capacity_is_migrated_and_persisted_per_profile() {
        let mut settings = decode(br#"{"activeId":"old","profiles":[{"id":"old","name":"Existing","config":{"enabled":true,"baseUrl":"https://same.example/v1","model":"test-model"}}]}"#).unwrap();
        assert_eq!(settings.active().unwrap().limits, Limits::default());
        let mut expanded = input(None, "Expanded", "https://same.example/v1", "test-key");
        let limits = Limits {
            max_steps: 32,
            max_context_kb: 1000,
            max_messages: 256,
            max_retries: 999,
        };
        expanded.config.limits = limits;
        settings.upsert(expanded, false).unwrap();
        let saved = decode(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(saved.active().unwrap().limits, limits);
        assert_eq!(
            saved.profile("old").unwrap().config.limits,
            Limits::default()
        );
        assert_eq!(saved.public().profiles[1].limits, limits);
        assert!(saved.active().unwrap().limits.check_request(8, &[]).is_ok());
        let mut invalid = input(Some("old"), "Invalid", "https://same.example/v1", "");
        invalid.config.enabled = false;
        invalid.config.limits.max_steps = 0;
        assert!(settings.upsert(invalid, false).is_err());
        assert_eq!(settings.profile("old").unwrap().name, "Existing");
    }
    #[test]
    fn multiple_profiles_isolate_keys_and_reject_stale_updates() {
        let mut settings = Settings::default();
        settings
            .upsert(
                input(None, "Official", "https://same.example/v1", "key-a"),
                false,
            )
            .unwrap();
        let first = settings.active_id.clone();
        settings
            .upsert(
                input(None, "Relay", "https://same.example/v1", "key-b"),
                false,
            )
            .unwrap();
        let second = settings.active_id.clone();
        settings
            .upsert(
                input(Some(&first), "Renamed", "https://same.example/v1", ""),
                false,
            )
            .unwrap();
        assert_eq!(settings.active().unwrap().api_key, "key-a");
        assert_eq!(settings.profile(&second).unwrap().config.api_key, "key-b");
        assert!(settings
            .upsert(
                input(Some(&first), "Official", "https://other.example/v1", ""),
                false
            )
            .is_err());
        settings
            .upsert(input(None, "No key", "https://same.example/v1", ""), false)
            .unwrap();
        assert!(settings.active().unwrap().api_key.is_empty());
        settings.activate(&second).unwrap();
        assert_eq!(settings.active().unwrap().api_key, "key-b");
        settings.remove(&second).unwrap();
        assert!(settings.active_id.is_empty());
        assert!(settings.activate(&second).is_err());
        assert!(settings
            .upsert(
                input(Some(&second), "Stale", "https://same.example/v1", ""),
                false
            )
            .is_err());
        settings
            .upsert(
                input(
                    Some(&first),
                    "Official",
                    "https://same.example/v1",
                    "ignored",
                ),
                true,
            )
            .unwrap();
        assert!(settings.active().unwrap().api_key.is_empty());
    }
    #[test]
    fn endpoint_policy() {
        for url in [
            "https://api.openai.com/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234/v1",
            "http://[::1]:1234/v1",
        ] {
            assert!(validate_url(url).is_ok(), "{url}");
        }
        for url in [
            "http://example.com/v1",
            "https://user:secret@example.com",
            "file:///key",
            "https://a.com?k=secret",
            "https://a.com/#token",
        ] {
            assert!(validate_url(url).is_err(), "{url}");
        }
    }
    #[cfg(windows)]
    #[test]
    fn encrypted_round_trip() {
        let plain = b"test-key-not-a-real-credential";
        let ciphertext = protect(plain, true).unwrap();
        assert_ne!(ciphertext, plain);
        assert_eq!(protect(&ciphertext, false).unwrap(), plain);
    }
    #[test]
    fn classifies_transient_provider_failures_and_requested_waits() {
        use std::time::{Duration, SystemTime};
        for status in [408, 409, 425, 429, 500, 502, 503, 504, 529] {
            assert!(transient_status(status), "{status}");
        }
        for status in [400, 401, 402, 403, 404, 413, 422, 501, 505] {
            assert!(!transient_status(status), "{status}");
        }
        assert!(quota_exhausted(
            br#"{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}"#
        ));
        assert!(quota_exhausted("账户余额不足，请充值".as_bytes()));
        assert!(!quota_exhausted(
            br#"{"error":{"message":"Rate limit: 5 requests per minute"}}"#
        ));
        use crate::error::ErrorKind;
        use serde_json::json;
        for transient in [
            json!({"error":{"type":"server_error","message":"upstream reset"}}),
            json!({"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}),
            json!({"type":"error","code":"rate_limit_exceeded","message":"Slow down"}),
            json!({"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}),
            serde_json::Value::Null,
        ] {
            let error = provider_error(&transient);
            assert!(matches!(error.kind, ErrorKind::Network), "{transient}");
        }
        for rejected in [
            json!({"error":{"type":"invalid_request_error","code":"context_length_exceeded"}}),
            json!({"error":{"type":"authentication_error","message":"bad key"}}),
            json!({"error":{"code":400,"status":"INVALID_ARGUMENT"}}),
            json!({"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}),
        ] {
            let error = provider_error(&rejected);
            assert!(matches!(error.kind, ErrorKind::Internal), "{rejected}");
        }
        assert_eq!(
            provider_error(&json!({"error":{"message":"Overloaded"}})).message,
            "模型服务错误：Overloaded"
        );
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_445_412_470);
        let parse = |pairs: &[(&'static str, &str)]| {
            let mut headers = reqwest::header::HeaderMap::new();
            for (name, value) in pairs {
                headers.insert(*name, value.parse().unwrap());
            }
            retry_after(&headers, now)
        };
        assert_eq!(parse(&[("retry-after", "7")]), Some(Duration::from_secs(7)));
        assert_eq!(
            parse(&[("retry-after-ms", "1500"), ("retry-after", "7")]),
            Some(Duration::from_millis(1500))
        );
        assert_eq!(
            parse(&[("retry-after", "Wed, 21 Oct 2015 07:28:00 GMT")]),
            Some(Duration::from_secs(10))
        );
        assert_eq!(
            parse(&[("retry-after", "86400")]),
            Some(Duration::from_secs(600))
        );
        assert_eq!(parse(&[("retry-after", "soon")]), None);
        assert_eq!(parse(&[]), None);
    }
}
#[cfg(test)]
mod http_tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    async fn mock(
        status: &str,
        body: &str,
        extra: &str,
    ) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let response=format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",body.len());
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let count = stream.read(&mut buf).await.unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..count]);
                if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|n| n.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let _ = stream.write_all(response.as_bytes()).await;
            request
        });
        (format!("http://{address}/v1"), task)
    }
    fn config(url: String) -> Config {
        Config {
            limits: Limits::default(),
            api_format: ApiFormat::Openai,
            enabled: true,
            base_url: url,
            model: "mock-tool-model".into(),
            api_key: "test-placeholder-only".into(),
        }
    }
    #[tokio::test]
    async fn claude_tool_round_trip_uses_native_messages_and_headers() {
        let response = r#"{"role":"assistant","stop_reason":"tool_use","content":[{"type":"text","text":"Checking"},{"type":"tool_use","id":"toolu_1","name":"server_status","input":{"probe":"disk"}}]}"#;
        let (url, server) = mock("200 OK", response, "").await;
        let mut claude = config(url);
        claude.api_format = ApiFormat::Anthropic;
        let initial = vec![
            serde_json::json!({"role":"system","content":"system rule"}),
            serde_json::json!({"role":"user","content":"check disk"}),
        ];
        let result = completion(
            &claude,
            &initial,
            Some(super::super::policy::definitions("ssh")),
        )
        .await
        .unwrap();
        let request = String::from_utf8(server.await.unwrap()).unwrap();
        assert!(request.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(request.contains("x-api-key: test-placeholder-only"));
        assert!(request.contains("anthropic-version: 2023-06-01"));
        assert!(!request.contains("authorization:"));
        let body: serde_json::Value =
            serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["system"][0]["text"], "system rule");
        assert_eq!(body["tools"][0]["name"], "server_status");
        assert!(body["tools"][0]["input_schema"].is_object());
        assert_eq!(body["tool_choice"]["disable_parallel_tool_use"], true);
        assert_eq!(body["max_tokens"], 4096);
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        let call = &result["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(call["id"], "toolu_1");
        assert_eq!(call["function"]["arguments"], "{\"probe\":\"disk\"}");
        let (url, server) = mock(
            "200 OK",
            r#"{"content":[{"type":"text","text":"Done"}],"stop_reason":"end_turn"}"#,
            "",
        )
        .await;
        claude.base_url = url;
        let mut history = initial;
        history.push(super::super::protocol::history_message(
            &result["choices"][0]["message"],
        ));
        history.push(
            serde_json::json!({"role":"tool","tool_call_id":"toolu_1","content":"disk output"}),
        );
        let followup = completion(&claude, &history, None).await.unwrap();
        assert_eq!(followup["choices"][0]["message"]["content"], "Done");
        let request = String::from_utf8(server.await.unwrap()).unwrap();
        let body: serde_json::Value =
            serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["messages"][1]["content"][1]["type"], "tool_use");
        assert_eq!(body["messages"][2]["role"], "user");
        assert_eq!(body["messages"][2]["content"][0]["tool_use_id"], "toolu_1");
        assert_eq!(body["messages"][2]["content"][0]["content"], "disk output");
        assert!(!request.contains("_anthropic_content"));
    }
    #[tokio::test]
    async fn sends_compatible_tool_request_and_parses_response() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"server_status","arguments":"{\"probe\":\"disk\"}"}}]}}]}"#;
        let (url, server) = mock("200 OK", body, "").await;
        let result = completion(
            &config(url),
            &[serde_json::json!({"role":"user","content":"check disk"})],
            Some(super::super::policy::definitions("ssh")),
        )
        .await
        .unwrap();
        assert_eq!(
            result["choices"][0]["message"]["tool_calls"][0]["id"],
            "call-1"
        );
        let request = server.await.unwrap();
        let text = String::from_utf8(request).unwrap();
        assert!(text.starts_with("POST /v1/chat/completions HTTP/1.1"));
        let json: serde_json::Value =
            serde_json::from_str(text.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(json["parallel_tool_calls"], false);
        assert_eq!(json["max_tokens"], 4096);
        assert_eq!(json["tools"][0]["function"]["name"], "server_status");
        assert_eq!(json["messages"].as_array().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn redirects_never_receive_credentials() {
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let location = format!(
            "Location: http://{}/stolen\r\n",
            destination.local_addr().unwrap()
        );
        let (url, server) = mock("307 Temporary Redirect", "{}", &location).await;
        assert!(completion(&config(url), &[], None)
            .await
            .unwrap_err()
            .message
            .contains("307"));
        server.await.unwrap();
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), destination.accept())
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn provider_error_does_not_echo_response_secrets() {
        let (url, server) = mock("401 Unauthorized", "{\"secret\":\"do-not-echo\"}", "").await;
        let error = completion(&config(url), &[], None).await.unwrap_err();
        assert!(error.message.contains("401"));
        assert!(!error.message.contains("do-not-echo"));
        // Credentials do not start working by themselves; never re-send this request.
        assert!(matches!(error.kind, crate::error::ErrorKind::Internal));
        server.await.unwrap();
    }
    #[tokio::test]
    async fn rate_limits_are_transient_and_carry_the_requested_wait() {
        let (url, server) = mock(
            "429 Too Many Requests",
            r#"{"error":{"message":"Rate limit: 5 requests per minute"}}"#,
            "Retry-After: 3\r\n",
        )
        .await;
        let error = completion(&config(url), &[], None).await.unwrap_err();
        assert!(matches!(error.kind, crate::error::ErrorKind::Network));
        assert_eq!(error.retry_after, Some(std::time::Duration::from_secs(3)));
        assert!(error
            .message
            .contains("429 · Rate limit: 5 requests per minute"));
        server.await.unwrap();
        let (url, server) = mock(
            "429 Too Many Requests",
            r#"{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}"#,
            "",
        )
        .await;
        let error = completion(&config(url), &[], None).await.unwrap_err();
        assert!(matches!(error.kind, crate::error::ErrorKind::Internal));
        server.await.unwrap();
    }
    #[tokio::test]
    async fn oversized_model_response_is_rejected() {
        let (url, server) = mock("200 OK", &"x".repeat(1_048_577), "").await;
        assert!(completion(&config(url), &[], None)
            .await
            .unwrap_err()
            .message
            .contains("1 MB"));
        server.await.unwrap();
    }
}
