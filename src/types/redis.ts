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
/** 集合成员原始字节：text 用于展示，raw 为 Base64 原值。 */
export interface RedisBytes {
  text: string
  raw: string
  binary: boolean
  size: number
  /** 超出单值回传上限，只读。 */
  truncated: boolean
}
export interface RedisCollectionItem {
  field?: RedisBytes
  value?: RedisBytes
  score?: string
  index?: number
  id?: string
  fields?: [RedisBytes, RedisBytes][]
}
export interface RedisCollectionPage {
  /** "0" 表示已读完。 */
  cursor: string
  items: RedisCollectionItem[]
  total: number
}
/** 成员与值均为 Base64 原始字节。 */
export type RedisCollectionOp =
  | { op: 'hashSet'; field: string; value: string; oldField?: string }
  | { op: 'hashDelete'; field: string }
  | { op: 'listSet'; index: number; old: string; value: string }
  | { op: 'listPush'; value: string; head: boolean }
  | { op: 'listDelete'; index: number; old: string }
  | { op: 'setAdd'; member: string; old?: string }
  | { op: 'setDelete'; member: string }
  | { op: 'zsetAdd'; member: string; score: number; old?: string }
  | { op: 'zsetDelete'; member: string }
  | { op: 'streamAdd'; id: string; fields: [string, string][] }
  | { op: 'streamDelete'; id: string }
export interface RedisPatternPreview {
  keys: RedisKey[]
  count: number
  /** 未扫描完时 count 为下限。 */
  complete: boolean
}
