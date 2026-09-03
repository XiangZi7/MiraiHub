/**
 * 已保存的连接。
 *
 * 侧栏项目树、顶部标签页、最近会话都以此为数据源 ——
 * 在此之前这些都是各写各的常量，切换服务器只是换了个高亮。
 */

import type { SshAuthMethod, SshConfig } from '@/types/ssh'

/** 连接协议。SSH 与数据库共用一套存储，靠这个字段分流 */
export type ConnectionKind = 'ssh' | 'mysql' | 'postgresql'

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
  /** 创建时间，Unix 毫秒 */
  createdAt: number
  /** 最后一次连接时间，从未连过为 0 */
  lastUsedAt: number
  settings: SshConnectionSettings | DatabaseConnectionSettings
}

/** 保存新连接时的入参，id 与时间戳由存储层生成 */
export type NewConnection = Omit<SavedConnection, 'id' | 'createdAt' | 'lastUsedAt'>

/** 类型收窄：这条连接是 SSH 吗 */
export function isSshConnection(
  connection: SavedConnection,
): connection is SavedConnection & { settings: SshConnectionSettings } {
  return connection.kind === 'ssh'
}

/** 类型收窄：这条连接是数据库吗 */
export function isDatabaseConnection(
  connection: SavedConnection,
): connection is SavedConnection & { settings: DatabaseConnectionSettings } {
  return connection.kind !== 'ssh'
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
  }
}

/** `user@host:port`，列表与标题栏展示用 */
export function endpointOf(connection: SavedConnection): string {
  return `${connection.username}@${connection.host}:${connection.port}`
}
