/**
 * 已保存的连接。
 *
 * 侧栏项目树、顶部标签页、最近会话都以此为数据源 ——
 * 在此之前这些都是各写各的常量，切换服务器只是换了个高亮。
 */

import type { SshAuthMethod, SshConfig } from '@/types/ssh'
import type {
  DatabaseConfig,
  DatabaseKind,
  DatabaseSslMode,
} from '@/types/database'
import { settingNumber, settingsSnapshot } from '@/composables/useSettings'

/** 连接协议。SSH 与数据库共用一套存储，靠这个字段分流 */
export type ConnectionKind = 'ssh' | 'local' | DatabaseKind

export type ConnectionTagColor =
  'red' | 'orange' | 'amber' | 'green' | 'cyan' | 'blue' | 'violet' | 'gray'

/** 可被所有连接复用的标签定义。连接记录只保存标签名，目录负责共享与配色。 */
export interface ConnectionTagDefinition {
  name: string
  color: ConnectionTagColor
  createdAt: number
}

export type LocalShellKind = 'powershell' | 'cmd' | 'git-bash'

/** 侧边栏分组按 SSH / 数据库两棵树隔离。 */
export type ConnectionGroupKind = 'ssh' | 'database'

/** 用户显式创建的分组；即使暂时没有连接也会保留。 */
export interface ConnectionGroup {
  id: string
  name: string
  kind: ConnectionGroupKind
  createdAt: number
}

/** 侧边栏消费的分组视图，包含聚合后的连接。 */
export interface ConnectionGroupView extends ConnectionGroup {
  items: SavedConnection[]
  /** 未分组是运行时虚拟分组，不写入存储。 */
  virtual?: boolean
}

/** SSH 连接的专属配置 */
export interface SshConnectionSettings {
  auth: SshAuthMethod
  /** 连接超时秒数 */
  timeoutSecs: number
  /** keepalive 间隔秒数 */
  keepaliveSecs: number
  /** 终端类型，如 xterm-256color */
  terminalType: string
  /** 连上后自动执行的命令，空表示不执行 */
  startupCommand: string
}

/** 数据库连接的专属配置 */
export interface DatabaseConnectionSettings {
  /** 默认打开的库名 */
  database: string
  password: string
  /** 是否走 SSL */
  ssl: boolean
  /** 完整 SSL 策略。可选是为了兼容只保存过 ssl 布尔值的旧连接。 */
  sslMode?: DatabaseSslMode
  caCertificate?: string
  clientCertificate?: string
  clientKey?: string
}

/** 本地 PTY 终端的专属配置 */
export interface LocalConnectionSettings {
  shell: LocalShellKind
  /** 空串表示继承当前用户目录 */
  workingDirectory: string
}

/**
 * 一条已保存的连接。
 *
 * SSH 与数据库放同一个结构里，共有字段（名称、地址、分组）不重复定义，
 * 差异部分收在 settings 的 tag 化联合里 —— 与 Rust 侧 AuthMethod 一个思路：
 * "是 SSH 就必须有 auth，是数据库就必须有 database"由类型保证。
 */
export interface SavedConnection {
  id: string
  /** 显示名，如 "Production API" */
  name: string
  kind: ConnectionKind
  host: string
  port: number
  username: string
  /** 所属分组名，空串表示未分组 */
  group: string
  /** 备注 */
  description: string
  /** 侧栏展示的短标签，可配置多个 */
  tags: readonly string[]
  /** 标签徽章与标签页下划线颜色 */
  tagColor: ConnectionTagColor
  /** 创建时间，Unix 毫秒 */
  createdAt: number
  /** 最后一次连接时间，从未连过为 0 */
  lastUsedAt: number
  settings:
    SshConnectionSettings | LocalConnectionSettings | DatabaseConnectionSettings
}

/** 保存新连接时的入参，id 与时间戳由存储层生成 */
export type NewConnection = Omit<
  SavedConnection,
  'id' | 'createdAt' | 'lastUsedAt'
>

/** 类型收窄：这条连接是 SSH 吗 */
export function isSshConnection(
  connection: SavedConnection
): connection is SavedConnection & { settings: SshConnectionSettings } {
  return connection.kind === 'ssh'
}

/** 类型收窄：这条连接是数据库吗 */
export function isDatabaseConnection(
  connection: SavedConnection
): connection is SavedConnection & {
  kind: DatabaseKind
  settings: DatabaseConnectionSettings
} {
  return connection.kind === 'mysql' || connection.kind === 'postgresql'
}

export function isLocalConnection(
  connection: SavedConnection
): connection is SavedConnection & { settings: LocalConnectionSettings } {
  return connection.kind === 'local'
}

/**
 * 已保存的连接 → 建立 SSH 连接的入参。
 *
 * 两者刻意不共用一个类型：SavedConnection 是持久化的形状（含 UI 用的名称、分组），
 * SshConfig 是给 Rust 的入参。合并会让后端被迫接收一堆用不上的字段，
 * 也让存储格式的演进牵扯到 IPC 契约。
 */
export function toSshConfig(connection: SavedConnection): SshConfig {
  if (!isSshConnection(connection))
    throw new Error(`连接 ${connection.name} 不是 SSH 类型`)

  const { settings } = connection

  return {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    auth: settings.auth,
    timeoutSecs: settings.timeoutSecs,
    keepaliveSecs: settings.keepaliveSecs,
    verifyHostKey: settingsSnapshot().verifyHostKey,
  }
}

/** 已保存的数据库连接 → Rust 驱动入参。 */
export function toDatabaseConfig(
  connection: SavedConnection,
  passwordOverride?: string
): DatabaseConfig {
  if (!isDatabaseConnection(connection))
    throw new Error(`连接 ${connection.name} 不是数据库类型`)

  const { settings } = connection
  return {
    kind: connection.kind,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: passwordOverride ?? settings.password,
    database: settings.database,
    sslMode: settings.sslMode ?? (settings.ssl ? 'prefer' : 'disable'),
    caCertificate: settings.caCertificate ?? '',
    clientCertificate: settings.clientCertificate ?? '',
    clientKey: settings.clientKey ?? '',
    timeoutSecs: settingNumber('databaseTimeout', 30),
    maxConnections: settingNumber('maxDatabaseConnections', 10),
  }
}

/** `user@host:port`，列表与标题栏展示用 */
export function endpointOf(connection: SavedConnection): string {
  if (isLocalConnection(connection))
    return connection.settings.workingDirectory || '本机'

  return `${connection.username}@${connection.host}:${connection.port}`
}

export function groupKindOf(kind: ConnectionKind): ConnectionGroupKind {
  return kind === 'mysql' || kind === 'postgresql' ? 'database' : 'ssh'
}
