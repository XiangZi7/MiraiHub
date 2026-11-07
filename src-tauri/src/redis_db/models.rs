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
    /// 经 SSH 隧道连接；建立后 host/port 改写为本机转发端口。
    #[serde(default)]
    pub ssh_tunnel: Option<crate::ssh::models::SshConfig>,
    /// 已建立的隧道，AI 等派生连接克隆配置时共享。
    #[serde(skip)]
    pub(crate) tunnel: Option<std::sync::Arc<crate::db::tunnel::DatabaseTunnel>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSession {
    pub session_id: String,
    pub database: String,
    pub endpoint: String,
}

#[derive(Clone, Serialize)]
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

/// 集合成员的原始字节：text 用于展示，raw 为 Base64 原值，写回时用它定位成员。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisBytes {
    pub text: String,
    pub raw: String,
    pub binary: bool,
    pub size: usize,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisCollectionItem {
    /// Hash 字段名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<RedisBytes>,
    /// Hash 值、List 元素、Set / ZSet 成员；Stream 条目为空。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<RedisBytes>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<i64>,
    /// Stream 条目 ID 与字段。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<[RedisBytes; 2]>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisCollectionPage {
    /// 下一页游标；"0" 表示已读完。
    pub cursor: String,
    pub items: Vec<RedisCollectionItem>,
    pub total: u64,
}

/// 集合写操作。成员与值均为 Base64 原始字节，保证二进制内容无损往返。
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RedisCollectionOp {
    HashSet {
        field: String,
        value: String,
        old_field: Option<String>,
    },
    HashDelete {
        field: String,
    },
    ListSet {
        index: i64,
        old: String,
        value: String,
    },
    ListPush {
        value: String,
        head: bool,
    },
    ListDelete {
        index: i64,
        old: String,
    },
    SetAdd {
        member: String,
        old: Option<String>,
    },
    SetDelete {
        member: String,
    },
    ZsetAdd {
        member: String,
        score: f64,
        old: Option<String>,
    },
    ZsetDelete {
        member: String,
    },
    StreamAdd {
        id: String,
        fields: Vec<[String; 2]>,
    },
    StreamDelete {
        id: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisPatternPreview {
    pub keys: Vec<RedisKey>,
    pub count: u64,
    /// 是否已扫描完整个键空间；未完成时 count 为下限。
    pub complete: bool,
}

/// INFO 的一个分节，条目保持服务器返回顺序。
#[derive(Serialize)]
pub struct RedisInfoSection {
    pub name: String,
    pub entries: Vec<[String; 2]>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSlowlogEntry {
    pub id: i64,
    pub timestamp: i64,
    pub duration_us: i64,
    pub args: Vec<String>,
    pub client: String,
    pub client_name: String,
}

#[derive(Serialize)]
pub struct RedisSlowlog {
    pub total: i64,
    pub entries: Vec<RedisSlowlogEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisBigKey {
    pub key: RedisKey,
    pub key_type: String,
    pub bytes: u64,
    /// 元素数量或字符串长度；扫描期间键已删除时为 0。
    pub length: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisBigKeyProgress {
    pub scanned: u64,
    pub total: u64,
    pub done: bool,
    pub cancelled: bool,
    pub error: Option<String>,
    pub keys: Vec<RedisBigKey>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisPubSubMessage {
    pub channel: String,
    pub pattern: Option<String>,
    pub payload: RedisBytes,
    pub received_at: u64,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RedisPubSubEvent {
    Messages { items: Vec<RedisPubSubMessage> },
    Closed { error: Option<String> },
}
