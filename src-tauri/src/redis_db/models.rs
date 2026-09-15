use crate::db::models::DatabaseSslMode;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub database: String,
    pub ssl_mode: DatabaseSslMode,
    #[serde(default)]
    pub ca_certificate: String,
    #[serde(default)]
    pub client_certificate: String,
    #[serde(default)]
    pub client_key: String,
    pub timeout_secs: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSession {
    pub session_id: String,
    pub database: String,
    pub endpoint: String,
}

#[derive(Serialize)]
pub struct RedisKey {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct RedisKeyPage {
    pub cursor: String,
    pub keys: Vec<RedisKey>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyDetail {
    pub key: RedisKey,
    pub key_type: String,
    pub ttl_ms: i64,
    pub length: u64,
    pub value: serde_json::Value,
    pub truncated: bool,
    pub editable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisCommandResult {
    pub value: serde_json::Value,
    pub elapsed_ms: u64,
    pub truncated: bool,
}
