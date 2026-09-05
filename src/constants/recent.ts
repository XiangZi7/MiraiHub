import type { RecentFilter, SessionKind } from '@/types'

/** 会话类型 → 图标、徽章文案与配色，与终端 / 数据库 / 文件三处入口的色系保持一致 */
export const SESSION_KIND_META: Record<
  SessionKind,
  { label: string; icon: string; tone: string }
> = {
  ssh: { label: 'SSH', icon: 'lucide:square-terminal', tone: 'text-accent' },
  local: { label: 'LOCAL', icon: 'lucide:terminal', tone: 'text-violet' },
  database: { label: 'DB', icon: 'lucide:database', tone: 'text-pink' },
  sftp: { label: 'SFTP', icon: 'mirai:folder', tone: 'text-blue' },
}

/** 类型筛选。SFTP 暂不单列 —— 文件浏览挂在 SSH 会话上，没有独立的会话记录 */
export const RECENT_FILTERS: RecentFilter[] = [
  { id: 'all', label: 'All' },
  { id: 'ssh', label: 'SSH' },
  { id: 'local', label: 'Local' },
  { id: 'database', label: 'Database' },
]

/** 时间分组的边界，单位毫秒。从近到远匹配，命中即归入该组 */
export const RECENT_BUCKETS: { id: string; label: string; within: number }[] = [
  { id: 'today', label: 'Today', within: 86_400_000 },
  { id: 'yesterday', label: 'Yesterday', within: 172_800_000 },
  { id: 'week', label: 'Earlier this week', within: 604_800_000 },
  { id: 'month', label: 'Earlier this month', within: 2_592_000_000 },
  // 兜底桶，Infinity 保证任何更早的记录都能落进来
  { id: 'older', label: 'Older', within: Number.POSITIVE_INFINITY },
]
