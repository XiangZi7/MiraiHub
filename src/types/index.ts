/** 连接状态 */
export type ConnectionStatus = 'online' | 'offline' | 'connecting'

/** 侧栏导航项 */
export interface NavItem {
  id: string
  label: string
  icon: string
}

/** 收藏项 */
export interface FavoriteItem {
  id: string
  label: string
}

/** 项目分组下的服务器节点 */
export interface ProjectNode {
  id: string
  label: string
  status: ConnectionStatus
}

/** 项目分组 */
export interface ProjectGroup {
  id: string
  label: string
  expanded: boolean
  children: ProjectNode[]
}

/** 服务器资源指标卡 */
export interface MetricCard {
  id: string
  label: string
  /** 主数值，如 "32%" 或 "6.2" */
  value: string
  /** 主数值后缀，如 "/ 16 GB" */
  suffix?: string
  /** 副标题，如 "39%" */
  caption?: string
  /** 上行速率文案，仅网络卡使用 */
  up?: string
  /** 下行速率文案，仅网络卡使用 */
  down?: string
  /** 折线颜色 CSS 变量 */
  color: string
  /** 折线数据 */
  trend: number[]
}

/** 快捷操作 */
export interface QuickAction {
  id: string
  label: string
  icon: string
  /** 图标颜色 class */
  tone: string
}

/** 最近活动 */
export interface ActivityItem {
  id: string
  text: string
  time: string
  tone: 'accent' | 'blue' | 'violet' | 'amber'
}

/** 文件条目 */
export interface FileEntry {
  id: string
  name: string
  size: string
  modified: string
  kind: 'folder' | 'json' | 'markdown' | 'js' | 'env' | 'yaml'
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

/** 终端输出行片段 */
export interface TermSpan {
  text: string
  tone?: 'fg' | 'green' | 'blue' | 'cyan' | 'dim'
  bold?: boolean
}
