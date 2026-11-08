//! 数据库 IPC 模型。字段统一以 camelCase 序列化，与 `src/types/database.ts` 对齐。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseKind {
    Mysql,
    Postgresql,
    /// 本地文件库：`host` 存文件路径，活动库固定为 `main`。
    Sqlite,
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

/// 连接所属环境。生产环境下的危险语句需要输入库名二次确认。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseEnvironment {
    #[default]
    Development,
    Testing,
    Production,
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
    #[serde(default)]
    pub environment: DatabaseEnvironment,
    /// 只读模式：后端拒绝写语句，并在会话层面开启只读事务作为兜底。
    #[serde(default)]
    pub read_only: bool,
    /// 经 SSH 隧道连接；连上后 host/port 会被改写成本机转发端口。
    #[serde(default)]
    pub ssh_tunnel: Option<crate::ssh::models::SshConfig>,
    /// 已建立的隧道。派生会话（切库、导出、AI）克隆配置时共享同一条隧道。
    #[serde(skip)]
    pub(crate) tunnel: Option<std::sync::Arc<super::tunnel::DatabaseTunnel>>,
}

fn default_timeout_secs() -> u64 {
    20
}

fn default_max_connections() -> u32 {
    8
}

impl DatabaseConfig {
    pub fn endpoint(&self) -> String {
        if self.kind == DatabaseKind::Sqlite {
            return self.host.clone();
        }
        if let Some(tunnel) = &self.tunnel {
            return format!(
                "{}@{} (SSH {})",
                self.username,
                tunnel.target(),
                tunnel.via()
            );
        }
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
    pub environment: DatabaseEnvironment,
    pub read_only: bool,
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
    /// 字段级字符集与排序规则；不适用的类型为 None。
    pub charset: Option<String>,
    pub collation: Option<String>,
    /// MySQL 的 ON UPDATE CURRENT_TIMESTAMP。
    pub on_update_current_timestamp: bool,
    /// 默认值是表达式而不是字面量（MySQL 8 DEFAULT_GENERATED）。
    pub default_is_expression: bool,
    /// 生成列的表达式，普通列为 None。
    pub generated_expression: Option<String>,
    pub generated_stored: bool,
}

/// 索引里的一项：普通列或表达式。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseIndexPart {
    pub column: String,
    pub sub_part: Option<i64>,
    pub descending: bool,
    pub expression: bool,
    /// PostgreSQL INCLUDE 列，不是键的一部分。
    pub included: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseIndex {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
    /// 前缀索引的长度（如 name(10) 的 10）；非前缀索引为 None。
    #[serde(default)]
    pub sub_part: Option<i64>,
    /// 索引方法：BTREE / HASH / FULLTEXT / SPATIAL / gin 等；读不出来时为 None。
    pub index_type: Option<String>,
    pub comment: Option<String>,
    /// PostgreSQL 部分索引的 WHERE 条件。
    pub predicate: Option<String>,
    /// 索引由 UNIQUE / EXCLUDE 约束持有，只能通过 DROP CONSTRAINT 删除。
    pub constraint_backed: bool,
    pub parts: Vec<DatabaseIndexPart>,
}

/// 引用某张表的外键（反向外键）：`schema.table(columns)` → 目标表 `(referenced_columns)`。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseReferencingKey {
    pub name: String,
    pub schema: String,
    pub table: String,
    pub columns: Vec<String>,
    pub referenced_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseForeignKey {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_schema: String,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
    /// ON UPDATE / ON DELETE 规则；读不出来时为空字符串。
    #[serde(default)]
    pub update_rule: String,
    #[serde(default)]
    pub delete_rule: String,
}

/// 表的当前选项。engine/charset/collation 只有 MySQL 有；auto_increment 是计数器当前值。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseTableOptions {
    pub engine: Option<String>,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub row_format: Option<String>,
    pub comment: Option<String>,
    pub auto_increment: Option<String>,
}

/// 一次表选项改动。None 表示不修改该选项；引擎/字符集在 Rust 侧按方言校验。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableAlterOptions {
    pub engine: Option<String>,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub comment: Option<String>,
    pub auto_increment: Option<i64>,
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
    /// 表的当前选项（引擎/字符集/备注/自增计数器），视图与读不出来时为 None。
    pub options: Option<DatabaseTableOptions>,
    /// CHECK 约束；不支持的版本或读不出来时为空。
    pub checks: Vec<DatabaseCheckConstraint>,
    pub triggers: Vec<DatabaseTrigger>,
    /// MySQL 分区信息，非分区表为 None。
    pub partition: Option<DatabasePartitionInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCheckConstraint {
    pub name: String,
    /// 不带外层 CHECK ( ) 的表达式。
    pub expression: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseTrigger {
    pub name: String,
    /// BEFORE / AFTER / INSTEAD OF
    pub timing: String,
    /// INSERT / UPDATE / DELETE / TRUNCATE，PostgreSQL 可多个。
    pub events: Vec<String>,
    /// MySQL 为触发语句体；PostgreSQL 为触发函数体（prosrc）。
    pub body: String,
    /// PostgreSQL 触发函数的限定名，MySQL 为空。
    pub function: String,
    /// PostgreSQL 触发函数仅被该触发器使用（可随触发器一起删除）；MySQL 恒为 false。
    pub function_exclusive: bool,
    /// ROW / STATEMENT
    pub level: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabasePartitionInfo {
    /// RANGE / LIST / HASH / KEY 等
    pub method: String,
    pub expression: String,
    pub partitions: Vec<DatabasePartition>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabasePartition {
    pub name: String,
    pub description: String,
    pub rows: Option<i64>,
}

/// 表设计器执行 DDL 的结果。支持事务 DDL 的方言失败会整体回滚。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDdlExecution {
    pub transactional: bool,
    /// 成功执行的语句数（事务回滚时这些也已撤销）。
    pub executed: usize,
    pub failed_index: Option<usize>,
    pub failed_statement: Option<String>,
    pub error: Option<String>,
    pub rolled_back: bool,
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
    GreaterOrEqual,
    LessOrEqual,
    NotContains,
    /// 值为逗号分隔的列表。
    In,
    NotIn,
    /// 区间两端分别取 `value` 与 `value2`，闭区间。
    Between,
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
    /// BETWEEN 的上界，其余运算符忽略。
    #[serde(default)]
    pub value2: String,
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
    /// 条件之间用 OR 连接；默认 AND。
    #[serde(default)]
    pub match_any: bool,
    /// 高级模式下用户手写的 WHERE 条件（不含 WHERE 关键字），与结构化条件以 AND 组合。
    #[serde(default)]
    pub where_sql: Option<String>,
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseTransferContent {
    #[default]
    All,
    Structure,
    Data,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DatabaseImportOptions {
    pub content: DatabaseTransferContent,
    pub include_database: bool,
    #[serde(default)]
    pub mappings: Option<Vec<super::import_data::ImportMapping>>,
}

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
    pub skipped_statements: usize,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
}
