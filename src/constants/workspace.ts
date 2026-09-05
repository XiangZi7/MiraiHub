import type {
  CommandGroup,
  CommandTarget,
  MachineViewId,
  NavId,
  NavItem,
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

/** 快捷操作 */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'terminal',
    label: 'Terminal',
    icon: 'lucide:square-terminal',
    tone: 'text-accent',
  },
  { id: 'files', label: 'Files', icon: 'mirai:folder', tone: 'text-blue' },
  {
    id: 'database',
    label: 'Database',
    icon: 'lucide:database',
    tone: 'text-pink',
  },
  {
    id: 'refresh',
    label: '刷新指标',
    icon: 'lucide:refresh-cw',
    tone: 'text-cyan',
  },
  { id: 'upload', label: 'Upload', icon: 'lucide:upload', tone: 'text-amber' },
  {
    id: 'copy-info',
    label: '复制信息',
    icon: 'lucide:copy',
    tone: 'text-txt-2',
  },
]

/** 命令面板分组。id 语义化，COMMAND_TARGETS 靠它决定跳转落点 */
export const COMMAND_GROUPS: CommandGroup[] = [
  {
    id: 'connections',
    label: 'Connections',
    items: [
      {
        id: 'connect-server',
        label: 'Connect to Server',
        icon: 'lucide:server',
        shortcut: '⌘⇧S',
      },
      {
        id: 'new-database',
        label: 'New Database Connection',
        icon: 'lucide:database',
        shortcut: '⌘⇧D',
      },
      {
        id: 'new-terminal',
        label: 'New Terminal',
        icon: 'lucide:square-terminal',
        shortcut: '⌘T',
      },
    ],
  },
  {
    id: 'actions',
    label: 'Actions',
    items: [
      {
        id: 'split-terminal',
        label: 'Split Terminal',
        icon: 'lucide:columns-2',
        shortcut: '⌘\\',
      },
      {
        id: 'open-files',
        label: 'Open Files',
        icon: 'lucide:folder-open',
        shortcut: '⌘O',
      },
      { id: 'run-sql', label: 'Run SQL', icon: 'lucide:play', shortcut: '⌘⏎' },
      {
        id: 'upload-files',
        label: 'Upload Files',
        icon: 'lucide:upload',
        shortcut: '⌘⇧U',
      },
    ],
  },
  {
    id: 'search',
    label: 'Search',
    items: [
      {
        id: 'search-servers',
        label: 'Search Servers',
        icon: 'lucide:search',
        shortcut: '⌘F',
      },
      {
        id: 'global-search',
        label: 'Global Search',
        icon: 'lucide:scan-search',
        shortcut: '⌘⇧F',
      },
      {
        id: 'recent-sessions',
        label: 'Recent Sessions',
        icon: 'lucide:clock',
        shortcut: '⌘⇧R',
      },
      {
        id: 'manage-keys',
        label: 'Manage SSH Keys',
        icon: 'lucide:key-round',
        shortcut: '⌘⇧K',
      },
    ],
  },
]

/**
 * 命令 id → 落点。
 *
 * 新建类命令直接开配置窗口并预选类型；
 * 其余命令负责把人送到能干这件事的视图。
 */
export const COMMAND_TARGETS: Record<string, CommandTarget> = {
  'connect-server': { newConnection: 'ssh' },
  'new-database': { newConnection: 'database' },
  'new-terminal': { newConnection: 'local' },
  'split-terminal': { nav: 'servers' },
  'open-files': { nav: 'servers', machineView: 'files' },
  'run-sql': { nav: 'databases' },
  'upload-files': { nav: 'servers', machineView: 'files' },
  'search-servers': { nav: 'servers', focusSearch: true },
  'global-search': { focusSearch: true },
  'recent-sessions': { nav: 'recent' },
  'manage-keys': { nav: 'ssh-keys' },
}
