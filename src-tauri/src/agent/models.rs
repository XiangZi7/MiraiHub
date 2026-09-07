//! Read-only model discovery using an unsaved settings draft.
use super::config::{self, Config};
use crate::error::{AppError, AppResult};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelListInput {
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub clear_key: bool,
}

impl ModelListInput {
    pub fn resolve(self, previous: Config) -> AppResult<Config> {
        config::resolve_credentials(
            Config {
                base_url: self.base_url,
                api_key: self.api_key,
                ..Config::default()
            },
            previous,
            self.clear_key,
        )
    }
}

pub async fn list(config: &Config) -> AppResult<Vec<String>> {
    config::validate_url(&config.base_url)?;
    let mut request =
        config::client()?.get(format!("{}/models", config.base_url.trim_end_matches('/')));
    if !config.api_key.is_empty() {
        request = request.bearer_auth(&config.api_key);
    }
    let result = config::request_json(request).await?;
    let data = result
        .get("data")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| AppError::invalid_input("服务未返回兼容的模型列表，请手动输入模型 ID"))?;
    let mut models: Vec<String> = data
        .iter()
        .filter_map(|item| item.get("id").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|id| !id.is_empty() && id.len() <= 200 && !id.chars().any(char::is_control))
        .map(str::to_owned)
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn draft(url: &str, key: &str, clear_key: bool) -> ModelListInput {
        ModelListInput {
            base_url: url.into(),
            api_key: key.into(),
            clear_key,
        }
    }

    #[test]
    fn resolves_unsaved_credentials_without_requiring_a_model_or_enablement() {
        let previous = Config {
            api_key: "saved-test-key".into(),
            ..Config::default()
        };
        let url = previous.base_url.clone();
        let resolved = draft(&format!(" {url}/ "), "", false)
            .resolve(previous.clone())
            .unwrap();
        assert_eq!(resolved.api_key, "saved-test-key");
        assert_eq!(resolved.base_url, url);
        assert!(!resolved.enabled);
        assert!(resolved.model.is_empty());
        assert_eq!(
            draft(&url, " new-test-key ", false)
                .resolve(previous.clone())
                .unwrap()
                .api_key,
            "new-test-key"
        );
        assert!(draft(&url, "ignored-test-key", true)
            .resolve(previous.clone())
            .unwrap()
            .api_key
            .is_empty());
        assert!(draft("https://another.example/v1", "", false)
            .resolve(previous.clone())
            .is_err());
        assert!(draft("https://another.example/v1", "new-test-key", false)
            .resolve(previous.clone())
            .is_ok());
        assert!(draft("http://localhost:11434/v1", "", true)
            .resolve(previous)
            .unwrap()
            .api_key
            .is_empty());
        assert!(draft(&url, "bad\r\nkey", false)
            .resolve(Config::default())
            .is_err());
        assert!(draft("http://remote.example/v1", "", false)
            .resolve(Config::default())
            .is_err());
    }

    async fn mock(
        status: &str,
        body: &str,
        extra: &str,
    ) -> (Config, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}", body.len());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let count = stream.read(&mut buffer).await.unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..count]);
            }
            let _ = stream.write_all(response.as_bytes()).await;
            String::from_utf8(request).unwrap()
        });
        (
            draft(&url, "draft-test-key", false)
                .resolve(Config::default())
                .unwrap(),
            server,
        )
    }

    #[tokio::test]
    async fn gets_models_with_draft_key_and_normalizes_ids() {
        let body = r#"{"data":[{"id":"z-model"},{"id":" a-model "},{"id":"z-model"},{"id":""},{"id":3},{"other":"ignored"},{"id":"bad\nmodel"}]}"#;
        let (config, server) = mock("200 OK", body, "").await;
        assert_eq!(list(&config).await.unwrap(), vec!["a-model", "z-model"]);
        let request = server.await.unwrap();
        assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer draft-test-key\r\n"));
        assert!(request.ends_with("\r\n\r\n"));
    }

    #[tokio::test]
    async fn accepts_empty_list_and_local_service_without_key() {
        let (mut config, server) = mock("200 OK", r#"{"data":[]}"#, "").await;
        config.api_key.clear();
        assert!(list(&config).await.unwrap().is_empty());
        assert!(!server
            .await
            .unwrap()
            .to_ascii_lowercase()
            .contains("authorization:"));
    }

    #[tokio::test]
    async fn rejects_incompatible_and_failed_responses_without_echoing_secrets() {
        for (status, body, expected) in [
            ("200 OK", "not-json", "JSON"),
            ("200 OK", r#"{"models":[]}"#, "手动输入"),
            ("401 Unauthorized", "private-response", "401"),
            ("404 Not Found", "private-response", "404"),
        ] {
            let (config, server) = mock(status, body, "").await;
            let error = list(&config).await.unwrap_err();
            assert!(error.message.contains(expected));
            assert!(!error.message.contains("private-response"));
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn rejects_redirects_and_oversized_model_lists() {
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let location = format!(
            "Location: http://{}/stolen\r\n",
            destination.local_addr().unwrap()
        );
        let (config, server) = mock("302 Found", "{}", &location).await;
        assert!(list(&config).await.unwrap_err().message.contains("302"));
        server.await.unwrap();
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), destination.accept())
                .await
                .is_err()
        );
        let (config, server) = mock("200 OK", &"x".repeat(1_048_577), "").await;
        assert!(list(&config).await.unwrap_err().message.contains("1 MB"));
        server.await.unwrap();
    }
}
