/** 数据库运维（会话监控、用户权限、原生备份）的前后端契约类型。 */

/** 服务器上的一个连接/会话 */
export interface ServerSession {
  id: number
  user: string
  host: string
  database: string
  command: string
  state: string
  durationMs?: number | null
  transactionMs?: number | null
  waitEvent: string
  application: string
  query: string
  /** 阻塞当前会话的会话 id */
  blockedBy: number[]
  /** 是否为本客户端自身的连接 */
  isSelf: boolean
}

export interface SessionSnapshot {
  sessions: ServerSession[]
  /** 权限不足等情况下的降级说明 */
  notice?: string | null
}

/** 终止方式：只取消当前语句，或断开整个连接 */
export type KillMode = 'query' | 'connection'

export interface DatabaseAccount {
  name: string
  /** MySQL 账号的 host；PostgreSQL 为空 */
  host?: string | null
  attributes: string[]
  memberOf: string[]
}

export interface AccountList {
  accounts: DatabaseAccount[]
  notice?: string | null
}

export type GrantLevel = 'global' | 'database' | 'schema' | 'table' | 'role'

/** 授权范围；后端字段均为非空字符串，未用到的留空串或省略 */
export interface GrantScope {
  level: GrantLevel
  database?: string
  schema?: string
  table?: string
  role?: string
}

export interface GrantEntry {
  sql: string
  privileges: string[]
  scope?: GrantScope | null
}

export type UserAction =
  | {
      type: 'create'
      name: string
      host?: string
      password: string
      login: boolean
    }
  | { type: 'drop'; name: string; host?: string }
  | {
      type: 'changePassword'
      name: string
      host?: string
      password: string
    }
  | {
      type: 'grant'
      name: string
      host?: string
      privileges: string[]
      scope: GrantScope
      withGrantOption: boolean
    }
  | {
      type: 'revoke'
      name: string
      host?: string
      privileges: string[]
      scope: GrantScope
    }

export interface BackupTool {
  path: string
  version: string
}

export interface BackupTools {
  dump?: BackupTool | null
  client?: BackupTool | null
}

export type BackupContent = 'all' | 'structure' | 'data'

export interface BackupRequest {
  sessionId: string
  path: string
  taskId: string
  toolDir?: string
  builtin?: boolean
  inserts?: boolean
  content?: BackupContent
  tables?: string[]
}

export interface RestoreRequest {
  sessionId: string
  path: string
  taskId: string
  toolDir?: string
  builtin?: boolean
}

export interface BackupResult {
  path: string
  bytes: number
  elapsedMs: number
  method: 'native' | 'builtin' | 'copy'
  tool?: string | null
  message: string
}

/** `db-backup-progress` 事件负载 */
export interface BackupProgress {
  taskId: string
  bytes: number
  total?: number | null
  elapsedMs: number
}

/** 本地保存的备份历史记录 */
export interface BackupRecord {
  id: string
  path: string
  database: string
  bytes: number
  elapsedMs: number
  method: BackupResult['method']
  content: BackupContent
  tables: number
  createdAt: number
}
