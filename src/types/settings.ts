export type SettingValue = string | boolean

export const DEFAULT_SETTINGS = {
  launchAtStartup: false,
  restoreLastSession: true,
  language: 'zh-CN',
  timeFormat: '24-hour',
  dateFormat: 'YYYY-MM-DD',
  showTrayIcon: true,
  minimizeToTray: false,

  theme: 'dark',
  windowMaterial: 'acrylic',
  compactLayout: false,
  uiScale: '100',
  reduceMotion: false,

  shortcutPalette: 'Ctrl+K',
  shortcutTerminal: 'Ctrl+T',
  shortcutSearch: 'Ctrl+Shift+F',
  shortcutFiles: 'Ctrl+O',

  sshTimeout: '30',
  keepConnectionAlive: true,
  autoReconnect: false,
  databaseTimeout: '30',
  maxDatabaseConnections: '10',
  sqlExecutionTimeout: '300',
  maxFileTransfers: '3',
  transferBufferSize: '8',

  terminalShell: 'powershell',
  terminalFont: 'jetbrains-mono',
  terminalFontSize: '13',
  terminalCursor: 'block',
  terminalCursorBlink: true,
  terminalScrollback: '5000',

  showHiddenFiles: false,
  confirmFileDelete: true,
  overwriteBehavior: 'ask',
  defaultDownloadDirectory: '',

  saveSessionHistory: true,
  saveQueryHistory: true,
  historyRetention: '30',
  maxRecentItems: '50',

  verifyHostKey: true,
  rememberPasswords: false,
  clipboardClearTimeout: '60',
  lockOnIdle: false,

  notifyConnectionChanges: true,
  notifyTransferComplete: true,
  notifyErrors: true,
  notificationSound: false,
} satisfies Record<string, SettingValue>

export type SettingsValues = typeof DEFAULT_SETTINGS
export type SettingKey = keyof SettingsValues

export type SettingsPageId =
  | 'general'
  | 'appearance'
  | 'shortcuts'
  | 'connections'
  | 'terminal'
  | 'files'
  | 'data'
  | 'security'
  | 'notifications'
  | 'about'

export interface SettingOption {
  value: string
  label: string
}

export interface EditableSettingField {
  key: SettingKey
  label: string
  description?: string
  control: 'switch' | 'select' | 'text' | 'shortcut'
  options?: readonly SettingOption[]
  placeholder?: string
  inputmode?: 'text' | 'numeric' | 'url'
  size?: 'sm' | 'md' | 'lg'
}

export interface DisplaySettingField {
  label: string
  description?: string
  control: 'display'
  displayValue: string
}

export type SettingField = EditableSettingField | DisplaySettingField

export interface SettingsGroup {
  title: string
  fields: readonly SettingField[]
}

export interface SettingsPage {
  id: SettingsPageId
  label: string
  title: string
  icon: string
  groups: readonly SettingsGroup[]
}
