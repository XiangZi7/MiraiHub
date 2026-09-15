import type { DatabaseConnectionConfig } from './database'

export type RedisConfig = DatabaseConnectionConfig
export interface RedisSession {
  sessionId: string
  database: string
  endpoint: string
}
export interface RedisKey {
  /** 原始键字节的 Base64 编码，避免二进制键被 UTF-8 转码后指向其他键。 */
  id: string
  name: string
}
export interface RedisKeyPage {
  cursor: string
  keys: RedisKey[]
}
export interface RedisKeyDetail {
  key: RedisKey
  keyType: string
  ttlMs: number
  length: number
  value: unknown
  truncated: boolean
  /** 仅完整 UTF-8 string 值可直接编辑。 */
  editable: boolean
}
export interface RedisCommandResult {
  value: unknown
  elapsedMs: number
  truncated: boolean
}
