import type { RecentFilter, RecentGroup, SessionKind } from '@/types'

/** 会话类型 → 图标、徽章文案与配色，与终端 / 数据库 / 文件三处入口的色系保持一致 */
export const SESSION_KIND_META: Record<SessionKind, { label: string, icon: string, tone: string }> = {
  ssh: { label: 'SSH', icon: 'lucide:square-terminal', tone: 'text-accent' },
  database: { label: 'DB', icon: 'lucide:database', tone: 'text-pink' },
  sftp: { label: 'SFTP', icon: 'mirai:folder', tone: 'text-blue' },
}

/** 类型筛选 */
export const RECENT_FILTERS: RecentFilter[] = [
  { id: 'all', label: 'All' },
  { id: 'ssh', label: 'SSH' },
  { id: 'database', label: 'Database' },
  { id: 'sftp', label: 'Files' },
]

/**
 * 最近会话。示例数据，接入会话历史后替换。
 * 按时间分组而不是给一个长列表 —— "最近"的用法是找刚才那台机器，日期边界比精确时刻更好定位。
 */
export const RECENT_GROUPS: RecentGroup[] = [
  {
    id: 'today',
    label: 'Today',
    items: [
      {
        id: 's1',
        label: 'Production Server',
        kind: 'ssh',
        address: '192.168.1.100:22',
        duration: '1h 12m',
        time: '2 minutes ago',
        status: 'success',
      },
      {
        id: 's2',
        label: 'production · MySQL',
        kind: 'database',
        address: '192.168.1.101:3306',
        duration: '48m',
        time: '15 minutes ago',
        status: 'success',
      },
      {
        id: 's3',
        label: 'API Server',
        kind: 'sftp',
        address: '192.168.1.102:22',
        duration: '6m',
        time: '1 hour ago',
        status: 'success',
      },
      {
        id: 's4',
        label: 'Dev Server',
        kind: 'ssh',
        address: '10.0.0.24:22',
        duration: '',
        time: '3 hours ago',
        status: 'failed',
      },
    ],
  },
  {
    id: 'yesterday',
    label: 'Yesterday',
    items: [
      {
        id: 's5',
        label: 'Worker Server',
        kind: 'ssh',
        address: '192.168.1.103:22',
        duration: '2h 05m',
        time: 'Yesterday 21:15',
        status: 'success',
      },
      {
        id: 's6',
        label: 'analytics · PostgreSQL',
        kind: 'database',
        address: '192.168.1.104:5432',
        duration: '33m',
        time: 'Yesterday 18:30',
        status: 'success',
      },
    ],
  },
  {
    id: 'earlier',
    label: 'Earlier this week',
    items: [
      {
        id: 's7',
        label: 'Test Server',
        kind: 'ssh',
        address: '10.0.0.31:22',
        duration: '17m',
        time: 'Monday 14:02',
        status: 'success',
      },
      {
        id: 's8',
        label: 'Database Server',
        kind: 'sftp',
        address: '192.168.1.101:22',
        duration: '',
        time: 'Monday 09:48',
        status: 'failed',
      },
    ],
  },
]
