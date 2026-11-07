import type { SettingKey } from '@/types/settings'
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
]

/** 机器详情面板的视图切换 */
export const MACHINE_VIEWS: NavItem<MachineViewId>[] = [
  { id: 'files', label: 'Files', icon: 'mirai:folder' },
  { id: 'agent', label: 'AI Agent', icon: 'lucide:bot' },
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
        shortcut: 'Ctrl+Shift+S',
      },
      {
        id: 'new-database',
        label: 'New Database Connection',
        icon: 'lucide:database',
        shortcut: 'Ctrl+Shift+D',
      },
      {
        id: 'new-terminal',
        label: 'New Terminal',
        icon: 'lucide:square-terminal',
        shortcut: 'Ctrl+T',
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
        shortcut: 'Ctrl+\\',
      },
      {
        id: 'open-files',
        label: 'Open Files',
        icon: 'lucide:folder-open',
        shortcut: 'Ctrl+O',
      },
      {
        id: 'run-sql',
        label: 'Run SQL',
        icon: 'lucide:play',
        shortcut: 'Ctrl+Enter',
      },
      {
        id: 'upload-files',
        label: 'Upload Files',
        icon: 'lucide:upload',
        shortcut: 'Ctrl+Shift+U',
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
        shortcut: 'Ctrl+F',
      },
      {
        id: 'global-search',
        label: 'Global Search',
        icon: 'lucide:scan-search',
        shortcut: 'Ctrl+Shift+F',
      },
    ],
  },
]

/**
 * 命令 id → 用户可配置的快捷键设置项。
 * 命中的命令显示用户真实设置，其余回退到 COMMAND_GROUPS 里的默认串。
 */
export const COMMAND_SHORTCUT_SETTINGS: Partial<Record<string, SettingKey>> = {
  'new-terminal': 'shortcutTerminal',
  'open-files': 'shortcutFiles',
  'run-sql': 'shortcutDbExecute',
  'global-search': 'shortcutSearch',
}

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
}
