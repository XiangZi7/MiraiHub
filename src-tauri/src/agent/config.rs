//! AI credentials never enter generic frontend settings or logs.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
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
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}
impl Config {
    pub fn public(&self) -> PublicConfig {
        PublicConfig {
            enabled: self.enabled,
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            has_api_key: !self.api_key.is_empty(),
        }
    }
    pub fn ready(&self) -> AppResult<()> {
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
pub fn read(app: &AppHandle) -> AppResult<Config> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::internal("无法定位设置目录"))?
        .join("ai-settings.bin");
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&protect(&bytes, false)?)
            .map_err(|_| AppError::internal("AI 设置损坏，无法解密")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(error) => Err(error.into()),
    }
}
pub fn save(app: &AppHandle, mut next: Config, clear_key: bool) -> AppResult<PublicConfig> {
    next.base_url = next.base_url.trim().trim_end_matches('/').into();
    next.model = next.model.trim().into();
    next.api_key = next.api_key.trim().into();
    validate_url(&next.base_url)?;
    if next.model.len() > 200 || next.api_key.len() > 8192 || next.api_key.contains(['\r', '\n']) {
        return Err(AppError::invalid_input("模型或密钥格式无效"));
    }
    let previous = read(app)?;
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
    if next.enabled {
        next.ready()?;
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::internal("无法定位设置目录"))?;
    std::fs::create_dir_all(&dir)?;
    let bytes = serde_json::to_vec(&next).map_err(|_| AppError::internal("保存 AI 设置失败"))?;
    // Entire file is encrypted for the current OS user; never write a plaintext temp file.
    std::fs::write(dir.join("ai-settings.bin"), protect(&bytes, true)?)?;
    Ok(next.public())
}
#[cfg(windows)]
fn protect(bytes: &[u8], encrypt: bool) -> AppResult<Vec<u8>> {
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
fn protect(_bytes: &[u8], _encrypt: bool) -> AppResult<Vec<u8>> {
    Err(AppError::invalid_input(
        "此平台尚未接入系统密钥存储，AI 配置暂不可保存",
    ))
}

pub async fn completion(
    config: &Config,
    messages: &[serde_json::Value],
    tools: Option<serde_json::Value>,
) -> AppResult<serde_json::Value> {
    config.ready()?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| AppError::internal("无法创建模型客户端"))?;
    let mut body = serde_json::json!({"model":config.model,"messages":messages,"stream":false,"max_completion_tokens":4096});
    if let Some(tools) = tools {
        body["tools"] = tools;
        body["parallel_tool_calls"] = false.into();
    }
    let mut request = client
        .post(format!(
            "{}/chat/completions",
            config.base_url.trim_end_matches('/')
        ))
        .json(&body);
    if !config.api_key.is_empty() {
        request = request.bearer_auth(&config.api_key);
    }
    let mut response = request.send().await.map_err(|_| {
        AppError::internal("模型请求失败，请检查网络、证书及 API 地址（60 秒超时）")
    })?;
    if !response.status().is_success() {
        return Err(AppError::internal(format!(
            "模型服务返回 HTTP {}，请检查地址、模型、密钥与额度",
            response.status().as_u16()
        )));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::internal("读取模型响应失败"))?
    {
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
            enabled: true,
            base_url: url,
            model: "mock-tool-model".into(),
            api_key: "test-placeholder-only".into(),
        }
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
        assert_eq!(json["max_completion_tokens"], 4096);
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
