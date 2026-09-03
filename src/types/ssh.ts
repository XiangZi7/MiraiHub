/**
 * SSH 相关类型。
 *
 * 与 Rust 侧 `src-tauri/src/ssh/models.rs` 逐字段对应 —— Rust 那边统一 camelCase 序列化，
 * 所以两边字段名可以直接对齐。改动任意一侧都要同步另一侧。
 */

/** 认证方式。tag 化联合，与 Rust 的 `#[serde(tag = "type")]` 对应 */
export type SshAuthMethod
  = | { type: 'password', password: string }
    | { type: 'privateKey', path: string, passphrase?: string }
    | { type: 'agent' }

/** 建立连接的入参 */
export interface SshConfig {
  host: string
  port: number
  username: string
  auth: SshAuthMethod
  /** 连接超时秒数，缺省 20 */
  timeoutSecs?: number
  /** keepalive 间隔秒数，0 表示不发，缺省 30 */
  keepaliveSecs?: number
}

/** 打开交互式 shell 的终端参数 */
export interface PtyOptions {
  /** 终端类型，缺省 xterm-256color */
  term?: string
  cols: number
  rows: number
}

/** 会话状态 */
export type SshSessionStatus = 'connecting' | 'connected' | 'disconnected'

/** 会话摘要 */
export interface SshSessionInfo {
  id: string
  host: string
  port: number
  username: string
  status: SshSessionStatus
  /** 建立时间，Unix 毫秒 */
  connectedAt: number
}

/** 远端命令执行结果 */
export interface SshCommandOutput {
  stdout: string
  stderr: string
  /** 被信号杀死等拿不到退出码时为 null */
  exitCode: number | null
}

/** SSH 密钥算法 */
export type SshKeyKind = 'ed25519' | 'rsa' | 'ecdsa'

/** 本地扫描到的密钥。只含公开信息，私钥内容不会过 IPC */
export interface SshKeyInfo {
  /** 私钥文件绝对路径，同时是唯一标识 */
  id: string
  label: string
  kind: SshKeyKind
  bits: number
  fingerprint: string
  publicKey: string
  comment: string
  encrypted: boolean
  /** 私钥文件修改时间，Unix 毫秒 */
  modifiedAt: number
}

/** 生成密钥的入参 */
export interface GenerateKeyRequest {
  /** 私钥文件名，不允许含路径分隔符 */
  label: string
  kind: SshKeyKind
  /** 仅 rsa 生效，缺省 4096 */
  bits?: number
  /** 缺省 user@hostname */
  comment?: string
  /** 空表示不加密 */
  passphrase?: string
}

/** 错误分类。与 Rust 的 ErrorKind 对应 */
export type AppErrorKind
  = | 'invalidInput'
    | 'network'
    | 'auth'
    | 'notFound'
    | 'io'
    | 'internal'

/** 跨 IPC 边界的错误载荷 */
export interface AppError {
  kind: AppErrorKind
  message: string
}

/** 终端输出事件负载 */
export interface SshOutputEvent {
  sessionId: string
  /** base64 编码的原始字节 */
  data: string
  isStderr: boolean
}

/** 会话状态变更事件负载 */
export interface SshStatusEvent {
  sessionId: string
  status: SshSessionStatus
  exitCode: number | null
  reason: string | null
}
