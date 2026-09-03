/** 与 Rust `db/models.rs` 对齐的数据库 IPC 类型。 */

export type DatabaseKind = 'mysql' | 'postgresql'
export type DatabaseSslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

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
}

export type DatabaseObjectKind = 'table' | 'view'

export interface DatabaseObject {
  schema: string
  name: string
  kind: DatabaseObjectKind
}

export interface DatabaseColumn {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  ordinal: number
}

export interface DatabaseQueryColumn {
  name: string
  dataType: string
}

export interface DatabaseQueryResult {
  columns: DatabaseQueryColumn[]
  /** SQL NULL 会保留为 null，而不是与字符串 "NULL" 混淆。 */
  rows: Array<Array<string | null>>
  rowsAffected: number
  elapsedMs: number
  truncated: boolean
  message: string
}
