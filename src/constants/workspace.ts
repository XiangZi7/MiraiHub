import type {
  ActivityItem,
  CommandGroup,
  CommandTarget,
  FavoriteItem,
  MachineViewId,
  MetricCard,
  NavId,
  NavItem,
  ProjectGroup,
  QuickAction,
} from '@/types'

/** 侧栏工作区导航。Files 不在此列 —— 它属于某台机器，见 MACHINE_VIEWS */
export const NAV_ITEMS: NavItem<NavId>[] = [
  { id: 'servers', label: 'Servers', icon: 'lucide:server' },
  { id: 'databases', label: 'Databases', icon: 'lucide:database' },
  { id: 'ssh-keys', label: 'SSH Keys', icon: 'lucide:key-round' },
  { id: 'recent', label: 'Recent', icon: 'lucide:clock' },
]

/** 机器详情面板的视图切换 */
export const MACHINE_VIEWS: NavItem<MachineViewId>[] = [
  { id: 'overview', label: 'Overview', icon: 'lucide:gauge' },
  { id: 'files', label: 'Files', icon: 'mirai:folder' },
]

/** 收藏夹 */
export const FAVORITES: FavoriteItem[] = [
  { id: 'fav-prod', label: 'Production' },
  { id: 'fav-dev', label: 'Development' },
]

/** 项目树 */
export const PROJECT_GROUPS: ProjectGroup[] = [
  {
    id: 'prod',
    label: 'Production',
    expanded: true,
    children: [
      { id: 'api', label: 'API Server', status: 'online' },
      { id: 'db', label: 'Database Server', status: 'online' },
      { id: 'worker', label: 'Worker Server', status: 'online' },
    ],
  },
  {
    id: 'dev',
    label: 'Development',
    expanded: true,
    children: [
      { id: 'dev-server', label: 'Dev Server', status: 'offline' },
      { id: 'test-server', label: 'Test Server', status: 'offline' },
    ],
  },
]

/**
 * 生成确定性的拟真监控波形：低频趋势 + 中频起伏 + 高频抖动。
 * 用函数而不是手写数组，是为了让曲线密度接近真实采样；
 * 确定性保证每次渲染形状一致，不会一刷新就跳。
 * 接入真实系统指标后这里会被替换掉。
 */
function waveform(seed: number, points = 44): number[] {
  return Array.from({ length: points }, (_, i) => {
    const trend = Math.sin((i / points) * Math.PI * 2 + seed) * 18
    const ripple = Math.sin(i * 0.9 + seed * 2) * 8
    const jitter = Math.sin(i * 2.3 + seed * 5) * 4
    return Number((50 + trend + ripple + jitter).toFixed(2))
  })
}

/** 服务器指标卡 */
export const METRIC_CARDS: MetricCard[] = [
  {
    id: 'cpu',
    label: 'CPU',
    value: '32%',
    caption: '39%',
    color: 'var(--color-blue)',
    trend: waveform(0.4),
  },
  {
    id: 'memory',
    label: 'Memory',
    value: '6.2',
    suffix: '/ 16 GB',
    caption: '39%',
    color: 'var(--color-violet)',
    trend: waveform(1.7),
  },
  {
    id: 'disk',
    label: 'Disk',
    value: '124',
    suffix: '/ 500 GB',
    caption: '24%',
    color: 'var(--color-accent)',
    trend: waveform(3.1),
  },
  {
    id: 'network',
    label: 'Network',
    value: '',
    down: '12 MB/s',
    up: '3 MB/s',
    color: 'var(--color-cyan)',
    trend: waveform(4.6),
  },
]

/** 快捷操作 */
export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'terminal', label: 'Terminal', icon: 'lucide:square-terminal', tone: 'text-accent' },
  { id: 'files', label: 'Files', icon: 'mirai:folder', tone: 'text-blue' },
  { id: 'database', label: 'Database', icon: 'lucide:database', tone: 'text-pink' },
  { id: 'port', label: 'Port Forward', icon: 'lucide:share-2', tone: 'text-cyan' },
  { id: 'upload', label: 'Upload', icon: 'lucide:upload', tone: 'text-amber' },
  { id: 'more', label: 'More', icon: 'lucide:ellipsis', tone: 'text-txt-2' },
]

/** 最近活动 */
export const ACTIVITIES: ActivityItem[] = [
  { id: 'a1', text: 'SSH connected', time: '2 minutes ago', tone: 'accent' },
  { id: 'a2', text: 'File uploaded: /var/log/app.log', time: '10 minutes ago', tone: 'blue' },
  { id: 'a3', text: 'MySQL connected', time: '15 minutes ago', tone: 'violet' },
  { id: 'a4', text: 'Restarted service: nginx', time: '1 hour ago', tone: 'amber' },
]

/** 命令面板分组。id 语义化，COMMAND_TARGETS 靠它决定跳转落点 */
export const COMMAND_GROUPS: CommandGroup[] = [
  {
    id: 'connections',
    label: 'Connections',
    items: [
      { id: 'connect-server', label: 'Connect to Server', icon: 'lucide:server', shortcut: '⌘⇧S' },
      { id: 'new-database', label: 'New Database Connection', icon: 'lucide:database', shortcut: '⌘⇧D' },
      { id: 'new-terminal', label: 'New Terminal', icon: 'lucide:square-terminal', shortcut: '⌘T' },
    ],
  },
  {
    id: 'actions',
    label: 'Actions',
    items: [
      { id: 'split-terminal', label: 'Split Terminal', icon: 'lucide:columns-2', shortcut: '⌘\\' },
      { id: 'open-files', label: 'Open Files', icon: 'lucide:folder-open', shortcut: '⌘O' },
      { id: 'run-sql', label: 'Run SQL', icon: 'lucide:play', shortcut: '⌘⏎' },
      { id: 'upload-files', label: 'Upload Files', icon: 'lucide:upload', shortcut: '⌘⇧U' },
    ],
  },
  {
    id: 'search',
    label: 'Search',
    items: [
      { id: 'search-servers', label: 'Search Servers', icon: 'lucide:search', shortcut: '⌘F' },
      { id: 'global-search', label: 'Global Search', icon: 'lucide:scan-search', shortcut: '⌘⇧F' },
      { id: 'recent-sessions', label: 'Recent Sessions', icon: 'lucide:clock', shortcut: '⌘⇧R' },
      { id: 'manage-keys', label: 'Manage SSH Keys', icon: 'lucide:key-round', shortcut: '⌘⇧K' },
    ],
  },
]

/**
 * 命令 id → 落点。
 * 会话层还没接上，"新建连接""执行 SQL"这类命令暂时只负责把人送到能干这件事的视图；
 * 等 Tauri 侧的连接能力就位，这张表会换成真正的动作分发。
 */
export const COMMAND_TARGETS: Record<string, CommandTarget> = {
  'connect-server': { nav: 'servers' },
  'new-database': { nav: 'databases' },
  'new-terminal': { nav: 'servers' },
  'split-terminal': { nav: 'servers' },
  'open-files': { nav: 'servers', machineView: 'files' },
  'run-sql': { nav: 'databases' },
  'upload-files': { nav: 'servers', machineView: 'files' },
  'search-servers': { nav: 'servers', focusSearch: true },
  'global-search': { focusSearch: true },
  'recent-sessions': { nav: 'recent' },
  'manage-keys': { nav: 'ssh-keys' },
}
