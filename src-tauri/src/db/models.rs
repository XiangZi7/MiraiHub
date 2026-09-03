//! 数据库 IPC 模型。字段统一以 camelCase 序列化，与 `src/types/database.ts` 对齐。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseKind {
    Mysql,
    Postgresql,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum DatabaseSslMode {
    Disable,
    #[default]
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConfig {
    pub kind: DatabaseKind,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub ssl_mode: DatabaseSslMode,
    #[serde(default)]
    pub ca_certificate: String,
    #[serde(default)]
    pub client_certificate: String,
    #[serde(default)]
    pub client_key: String,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

fn default_timeout_secs() -> u64 {
    20
}

impl DatabaseConfig {
    pub fn endpoint(&self) -> String {
        format!("{}@{}:{}", self.username, self.host, self.port)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseObjectKind {
    Table,
    View,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObject {
    pub schema: String,
    pub name: String,
    pub kind: DatabaseObjectKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub ordinal: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryResult {
    pub columns: Vec<DatabaseQueryColumn>,
    /// 每行与 columns 等长；SQL NULL 序列化为 JSON null。
    pub rows: Vec<Vec<Option<String>>>,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
    pub message: String,
}
