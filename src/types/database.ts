/** 与 Rust `db/models.rs` 对齐的数据库 IPC 类型。 */

import type { ConnectionTagColor } from './connection'

export type DatabaseKind = 'mysql' | 'postgresql'
/** 工作台连接协议；SQL 方言仍限定为 DatabaseKind。 */
export type DatabaseConnectionKind = DatabaseKind | 'redis'
export type DatabaseSslMode =
  'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

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
}

export interface DatabaseIndex {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
  /** 前缀索引长度（如 name(10) 的 10）；非前缀索引为 null。 */
  subPart: number | null
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
  comment: string | null
  /** 自增计数器当前值；PostgreSQL / 读不出来时为 null。 */
  autoIncrement: number | null
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
}

export interface RowPageRequest {
  schema: string
  table: string
  offset?: number
  limit?: number
  sort?: RowSort
  filters?: RowFilter[]
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
  elapsedMs: number
}

export interface DatabaseHistoryEntry {
  id: string
  connectionId: string
  database: string
  sql: string
  executedAt: number
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
