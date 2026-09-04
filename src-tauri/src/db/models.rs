//! 数据库 IPC 模型。字段统一以 camelCase 序列化，与 `src/types/database.ts` 对齐。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
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
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
}

fn default_timeout_secs() -> u64 {
    20
}

fn default_max_connections() -> u32 {
    8
}

impl DatabaseConfig {
    pub fn endpoint(&self) -> String {
        format!("{}@{}:{}", self.username, self.host, self.port)
    }
}

/// 连上之后回给前端的会话概要。密码等敏感字段不在其中。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSession {
    pub session_id: String,
    pub kind: DatabaseKind,
    pub endpoint: String,
    /// 当前活动库；MySQL 未指定库时为空。
    pub database: String,
    pub server_version: String,
}

// ---------------------------------------------------------------------------
// 元数据
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseObjectKind {
    Table,
    View,
    Procedure,
    Function,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObject {
    pub schema: String,
    pub name: String,
    pub kind: DatabaseObjectKind,
    /// PostgreSQL 重载例程的参数类型列表；表、视图与 MySQL 例程为空。
    pub identity: String,
    /// 统计信息里的行数估算，未知为 None。精确值太贵，不在列表里做。
    pub row_estimate: Option<i64>,
    pub comment: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub ordinal: i32,
    pub primary_key: bool,
    pub auto_increment: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseIndex {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseForeignKey {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_schema: String,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
}

/// 一张表/视图的完整结构，对象树展开与结构面板共用。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseTableDetail {
    pub schema: String,
    pub name: String,
    pub kind: DatabaseObjectKind,
    pub columns: Vec<DatabaseColumn>,
    pub indexes: Vec<DatabaseIndex>,
    pub foreign_keys: Vec<DatabaseForeignKey>,
    /// 主键列，按键内顺序；无主键时为空，此时数据网格只读。
    pub primary_key: Vec<String>,
    pub row_estimate: Option<i64>,
    pub ddl: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRoutineParameter {
    pub name: String,
    pub data_type: String,
    pub mode: String,
    pub ordinal: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRoutineDetail {
    pub schema: String,
    pub name: String,
    pub kind: DatabaseObjectKind,
    pub identity: String,
    pub parameters: Vec<DatabaseRoutineParameter>,
    pub return_type: Option<String>,
    pub language: String,
    pub definition: String,
    pub ddl: String,
    pub comment: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

// ---------------------------------------------------------------------------
// 查询执行
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryColumn {
    pub name: String,
    pub data_type: String,
}

/// 单条语句的执行结果。多语句脚本里每条都会产出一个，失败的那条带 error。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatementResult {
    /// 语句原文，结果页签用它做标题。
    pub statement: String,
    /// 在提交的 SQL 里的起始字节偏移，供编辑器定位报错位置。
    pub offset: usize,
    pub columns: Vec<DatabaseQueryColumn>,
    /// 每行与 columns 等长；SQL NULL 序列化为 JSON null。
    pub rows: Vec<Vec<Option<String>>>,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
    pub message: String,
    /// 该语句自身的错误。为 Some 时后续语句不再执行。
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseExecution {
    pub statements: Vec<DatabaseStatementResult>,
    pub elapsed_ms: u64,
    /// 用户中途取消，已完成的语句仍在 statements 里。
    pub cancelled: bool,
}

// ---------------------------------------------------------------------------
// 数据浏览
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowSort {
    pub column: String,
    #[serde(default)]
    pub descending: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RowFilterOperator {
    Equals,
    NotEquals,
    Contains,
    StartsWith,
    GreaterThan,
    LessThan,
    IsNull,
    NotNull,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowFilter {
    pub column: String,
    pub operator: RowFilterOperator,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowPageRequest {
    pub schema: String,
    pub table: String,
    #[serde(default)]
    pub offset: u64,
    #[serde(default = "default_page_size")]
    pub limit: u32,
    #[serde(default)]
    pub sort: Option<RowSort>,
    #[serde(default)]
    pub filters: Vec<RowFilter>,
}

fn default_page_size() -> u32 {
    200
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRowPage {
    pub columns: Vec<DatabaseQueryColumn>,
    pub rows: Vec<Vec<Option<String>>>,
    pub offset: u64,
    pub limit: u32,
    /// 后面还有数据。多取一行判断出来，避免额外 COUNT。
    pub has_more: bool,
    pub elapsed_ms: u64,
    /// 实际执行的 SQL，回显给用户，便于复制到编辑器继续改。
    pub sql: String,
}

// ---------------------------------------------------------------------------
// 数据编辑
// ---------------------------------------------------------------------------

/// 一个单元格的值。None 表示 SQL NULL，与空字符串区分开。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellValue {
    pub column: String,
    pub value: Option<String>,
}

/// 一次行级改动。定位条件统一用主键列，没有主键的表在前端就禁用编辑。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RowMutation {
    #[serde(rename_all = "camelCase")]
    Insert { values: Vec<CellValue> },
    #[serde(rename_all = "camelCase")]
    Update {
        keys: Vec<CellValue>,
        changes: Vec<CellValue>,
    },
    #[serde(rename_all = "camelCase")]
    Delete { keys: Vec<CellValue> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationRequest {
    pub schema: String,
    pub table: String,
    pub mutations: Vec<RowMutation>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub rows_affected: u64,
    /// 实际执行的语句（占位符未展开），提交后展示在消息面板里。
    pub statements: Vec<String>,
    pub elapsed_ms: u64,
}

// ---------------------------------------------------------------------------
// SQL 导入 / 导出
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseExportResult {
    pub path: String,
    pub objects: usize,
    pub rows: u64,
    pub bytes: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseImportResult {
    pub path: String,
    pub statements: usize,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
}
