/** 与 Rust `db/models.rs` 对齐的数据库 IPC 类型。 */

import type { ConnectionTagColor } from './connection'
import type { SshConfig } from './ssh'

export type DatabaseKind = 'mysql' | 'postgresql' | 'sqlite'
/** 工作台连接协议；SQL 方言仍限定为 DatabaseKind。 */
export type DatabaseConnectionKind = DatabaseKind | 'redis'
/** MySQL 协议下的具体产品，只影响表单默认值和显示，后端按 VERSION() 处理差异。 */
export type MysqlFlavor = 'mysql' | 'mariadb' | 'tidb'
export type DatabaseSslMode =
  'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

/** 连接所属环境，生产环境的危险语句需要输入库名确认。 */
export type DatabaseEnvironment = 'development' | 'testing' | 'production'

export interface DatabaseConfig {
  kind: DatabaseKind
  host: string
  port: number
  username: string
  password: string
  database: string
  sslMode: DatabaseSslMode
  caCertificate: string
  clientCertificate: string
  clientKey: string
  timeoutSecs: number
  maxConnections: number
  environment?: DatabaseEnvironment
  readOnly?: boolean
  /** 已解析好的 SSH 隧道配置，手动填写或由 sshTunnelConnectionId 解析而来。 */
  sshTunnel?: SshConfig
  /** 引用已保存的 SSH 连接；调用后端前在 API 层解析为 sshTunnel。 */
  sshTunnelConnectionId?: string
}

export type DatabaseConnectionConfig = Omit<DatabaseConfig, 'kind'> & {
  kind: DatabaseConnectionKind
}

export interface DatabaseSession {
  sessionId: string
  kind: DatabaseKind
  endpoint: string
  database: string
  serverVersion: string
  environment?: DatabaseEnvironment
  readOnly?: boolean
}

export type DatabaseObjectKind = 'table' | 'view' | 'procedure' | 'function'

export interface DatabaseObject {
  schema: string
  name: string
  kind: DatabaseObjectKind
  identity: string
  rowEstimate: number | null
  comment: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface DatabaseColumn {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  ordinal: number
  primaryKey: boolean
  autoIncrement: boolean
  comment: string | null
  charset?: string | null
  collation?: string | null
  onUpdateCurrentTimestamp?: boolean
  /** 默认值是表达式而不是字面量（MySQL 8 DEFAULT_GENERATED）。 */
  defaultIsExpression?: boolean
  /** 生成列的表达式，普通列为 null。 */
  generatedExpression?: string | null
  generatedStored?: boolean
}

export interface DatabaseIndexPart {
  column: string
  subPart: number | null
  descending: boolean
  expression: boolean
  /** PostgreSQL INCLUDE 列，不是键的一部分。 */
  included: boolean
}

export interface DatabaseIndex {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
  /** 前缀索引长度（如 name(10) 的 10）；非前缀索引为 null。 */
  subPart: number | null
  /** 索引方法：BTREE / HASH / FULLTEXT / SPATIAL / gin 等。 */
  indexType?: string | null
  comment?: string | null
  /** PostgreSQL 部分索引的 WHERE 条件。 */
  predicate?: string | null
  /** 由 UNIQUE / EXCLUDE 约束持有，只能通过 DROP CONSTRAINT 删除。 */
  constraintBacked?: boolean
  parts?: DatabaseIndexPart[]
}

export interface DatabaseForeignKey {
  name: string
  columns: string[]
  referencedSchema: string
  referencedTable: string
  referencedColumns: string[]
  /** ON UPDATE / ON DELETE 规则；读不出来时为空字符串。 */
  updateRule: string
  deleteRule: string
}

export interface DatabaseTableOptions {
  engine: string | null
  charset: string | null
  collation: string | null
  rowFormat: string | null
  comment: string | null
  /** MySQL 下次分配的自增计数器，以文本保留无符号 BIGINT 精度。 */
  autoIncrement: string | null
}

export interface TableAlterOptions {
  engine?: string
  charset?: string
  collation?: string
  comment?: string
  autoIncrement?: number
}

export interface DatabaseTableDetail {
  schema: string
  name: string
  kind: DatabaseObjectKind
  columns: DatabaseColumn[]
  indexes: DatabaseIndex[]
  foreignKeys: DatabaseForeignKey[]
  primaryKey: string[]
  rowEstimate: number | null
  ddl: string
  options: DatabaseTableOptions | null
  /** CHECK 约束；旧版本后端或不支持时缺省。 */
  checks?: DatabaseCheckConstraint[]
  triggers?: DatabaseTrigger[]
  partition?: DatabasePartitionInfo | null
}

export interface DatabaseCheckConstraint {
  name: string
  expression: string
}

export interface DatabaseTrigger {
  name: string
  timing: string
  events: string[]
  body: string
  /** PostgreSQL 触发函数的限定名。 */
  function: string
  /** PostgreSQL 触发函数仅被该触发器使用，删除触发器时可一并删除。 */
  functionExclusive?: boolean
  level: string
}

export interface DatabasePartitionInfo {
  method: string
  expression: string
  partitions: { name: string; description: string; rows: number | null }[]
}

export interface DatabaseDdlExecution {
  transactional: boolean
  executed: number
  failedIndex: number | null
  failedStatement: string | null
  error: string | null
  rolledBack: boolean
}

export interface DatabaseRoutineParameter {
  name: string
  dataType: string
  mode: string
  ordinal: number
}

export interface DatabaseRoutineDetail {
  schema: string
  name: string
  kind: 'procedure' | 'function'
  identity: string
  parameters: DatabaseRoutineParameter[]
  returnType: string | null
  language: string
  definition: string
  ddl: string
  comment: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface DatabaseQueryColumn {
  name: string
  dataType: string
}

export interface DatabaseStatementResult {
  statement: string
  offset: number
  columns: DatabaseQueryColumn[]
  /** SQL NULL 会保留为 null，而不是与字符串 "NULL" 混淆。 */
  rows: Array<Array<string | null>>
  rowsAffected: number
  elapsedMs: number
  truncated: boolean
  message: string
  error: string | null
}

export interface DatabaseExecution {
  statements: DatabaseStatementResult[]
  elapsedMs: number
  cancelled: boolean
}

export type RowFilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'startsWith'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterOrEqual'
  | 'lessOrEqual'
  | 'notContains'
  | 'in'
  | 'notIn'
  | 'between'
  | 'isNull'
  | 'notNull'

export interface RowSort {
  column: string
  descending: boolean
}

export interface RowFilter {
  column: string
  operator: RowFilterOperator
  value: string
  /** BETWEEN 的上界。 */
  value2?: string
}

export interface RowPageRequest {
  schema: string
  table: string
  offset?: number
  limit?: number
  sort?: RowSort
  filters?: RowFilter[]
  /** 条件之间用 OR 连接。 */
  matchAny?: boolean
  /** 高级模式手写的 WHERE 条件（不含关键字）。 */
  whereSql?: string
}

/** 引用某张表的外键（反向外键）。 */
export interface DatabaseReferencingKey {
  name: string
  schema: string
  table: string
  columns: string[]
  referencedColumns: string[]
}

export interface DatabaseRowPage {
  columns: DatabaseQueryColumn[]
  rows: Array<Array<string | null>>
  offset: number
  limit: number
  hasMore: boolean
  elapsedMs: number
  sql: string
}

export interface CellValue {
  column: string
  value: string | null
}

export type RowMutation =
  | { type: 'insert'; values: CellValue[] }
  | { type: 'update'; keys: CellValue[]; changes: CellValue[] }
  | { type: 'delete'; keys: CellValue[] }

export interface MutationRequest {
  schema: string
  table: string
  mutations: RowMutation[]
}

export interface MutationResult {
  rowsAffected: number
  statements: string[]
  elapsedMs: number
}

export type DatabaseTransferContent = 'all' | 'structure' | 'data'

export interface DatabaseImportOptions {
  mappings?: import('./database-import').DatabaseImportMapping[]
  content: DatabaseTransferContent
  includeDatabase: boolean
}

export interface DatabaseExportOptions extends DatabaseImportOptions {
  dropExisting: boolean
}

export interface DatabaseExportResult {
  path: string
  objects: number
  rows: number
  bytes: number
  elapsedMs: number
}

export interface DatabaseImportResult {
  path: string
  statements: number
  rowsAffected: number
  skippedStatements: number
  elapsedMs: number
}

export interface DatabaseHistoryEntry {
  id: string
  connectionId: string
  database: string
  sql: string
  executedAt: number
  /** 执行耗时（毫秒），旧记录没有 */
  durationMs?: number
  /** 是否全部语句成功 */
  ok?: boolean
  /** 返回行数或影响行数之和 */
  rowCount?: number
}

/** 表格列的“标签化显示”：把某些单元格值渲染成带颜色的标签，只影响显示，不改数据。 */
export type ColumnTagStyle = 'badge' | 'dot'

export interface ColumnTagRule {
  /** 与单元格文本精确匹配的值。 */
  value: string
  /** 标签上显示的文字；为空时显示原值。 */
  label: string
  color: ConnectionTagColor
}

export interface ColumnTagConfig {
  style: ColumnTagStyle
  rules: ColumnTagRule[]
}
