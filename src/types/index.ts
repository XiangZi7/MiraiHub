/** 侧栏主视图 id */
export type NavId = 'servers' | 'databases' | 'ssh-keys' | 'recent'

/** 机器详情面板的视图 id */
export type MachineViewId = 'overview' | 'files'

/**
 * 导航项。侧栏与机器面板共用这个结构，各自把 Id 收窄成自己的字面量联合，
 * 这样"当前视图"在状态和模板里都是可校验的，不会写错一个字符串就静默降级到空状态。
 */
export interface NavItem<Id extends string = string> {
  id: Id
  label: string
  icon: string
}

/** 快捷操作 */
export interface QuickAction {
  id: string
  label: string
  icon: string
  /** 图标颜色 class */
  tone: string
}

/** 数据库对象树节点 */
export interface DbNode {
  id: string
  label: string
  icon: string
  depth: number
  expanded?: boolean
  leaf?: boolean
  active?: boolean
}

/** SQL 结果集行 */
export interface QueryRow {
  id: number
  username: string
  email: string
  createdAt: string
}

/** SQL 代码高亮片段 */
export interface CodeToken {
  text: string
  /** 语法类别 */
  kind?: 'keyword' | 'func' | 'num' | 'plain'
}

/** SQL 编辑器行 */
export interface CodeLine {
  no: number
  tokens: CodeToken[]
}

/** 命令面板条目 */
export interface CommandItem {
  id: string
  label: string
  icon: string
  shortcut: string
}

/** 命令面板分组 */
export interface CommandGroup {
  id: string
  label: string
  items: CommandItem[]
}

/**
 * 命令面板某条命令的落点。
 * 一条命令要么直接打开新建连接窗口，要么把人送到能干这件事的视图。
 */
export interface CommandTarget {
  /** 切到哪个主视图，省略表示留在当前视图 */
  nav?: NavId
  /** 若指定，同时展开机器面板并切到该视图 */
  machineView?: MachineViewId
  /** 是否把焦点交给标题栏搜索框 */
  focusSearch?: boolean
  /** 若指定，打开连接配置窗口并预选该类型 */
  newConnection?: 'ssh' | 'local' | 'database'
}

/** SSH 密钥相关类型见 `@/types/ssh` —— 那边与 Rust 侧的模型一一对应 */

/** 会话类型 */
export type SessionKind = 'ssh' | 'local' | 'database' | 'sftp'

/**
 * 最近会话记录。
 * 由已保存连接的 lastUsedAt 派生而来，不是独立存储的一份历史 ——
 * 真正的会话历史（每次连接的起止、结果）等数据库模块落地后再建表。
 */
export interface RecentSession {
  /** 与来源连接的 id 一致 */
  id: string
  /** 连接名 */
  label: string
  kind: SessionKind
  /** 地址，含端口 */
  address: string
  /** 最后使用时间，Unix 毫秒，从未用过为 0 */
  usedAt: number
}

/** 最近会话按时间分组 */
export interface RecentGroup {
  id: string
  label: string
  items: RecentSession[]
}

/** 最近会话的类型筛选项 */
export interface RecentFilter {
  id: 'all' | SessionKind
  label: string
}
