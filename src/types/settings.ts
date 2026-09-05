export type SettingValue = string | boolean

/**
 * 全部设置项及默认值。
 *
 * 每一项都必须有消费方：没有地方读取的开关只会让用户误以为它有效。
 * 语言切换与空闲锁定尚无实现基础，暂不提供。
 */
export const DEFAULT_SETTINGS = {
  launchAtStartup: false,
  restoreLastSession: true,
  timeFormat: '24-hour',
  dateFormat: 'YYYY-MM-DD',
  showTrayIcon: true,
  minimizeToTray: false,

  windowMaterial: 'acrylic',
  compactLayout: false,
  uiScale: '100',
  reduceMotion: false,
  skinTheme: 'default',
  skinBase: 'default',
  skinLibrary: '[]',
  skinStyle: 'builtin',
  skinCustomCss: '',
  skinBackground: 'theme',
  skinBackgroundImage: '',
  skinBackgroundName: '',
  skinBackgroundOpacity: '30',
  skinBackgroundBlur: '0',
  skinBackgroundFit: 'cover',
  skinBackgroundPosition: 'center',

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
  transferBufferSizeKb: '128',

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
  rememberPasswords: true,
  clipboardClearTimeout: '0',

  notifyConnectionChanges: true,
  notifyTransferComplete: true,
  notifyErrors: true,
  notificationSound: false,
} satisfies Record<string, SettingValue>

export type SettingsValues = {
  [
    K in keyof typeof DEFAULT_SETTINGS
  ]: (typeof DEFAULT_SETTINGS)[K] extends boolean ? boolean : string
}
export type SettingKey = keyof SettingsValues

export type SettingsPageId =
  | 'backup'
  | 'ai'
  | 'general'
  | 'appearance'
  | 'skin'
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
  description?: string
}

/** 数值输入的合法范围，保存时校验。 */
export interface SettingRange {
  min: number
  max: number
}

export interface EditableSettingField {
  key: SettingKey
  label: string
  description?: string
  control: 'switch' | 'select' | 'text' | 'shortcut' | 'directory' | 'scale'
  options?: readonly SettingOption[]
  placeholder?: string
  inputmode?: 'text' | 'numeric' | 'url'
  size?: 'sm' | 'md' | 'lg'
  /** 仅 control = text 且 inputmode = numeric 时生效 */
  range?: SettingRange
  /** 依赖的开关项为 false 时禁用本项 */
  dependsOn?: SettingKey
}

export interface DisplaySettingField {
  /** 运行时可覆盖的取值 id，如版本号 */
  id?: string
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
  description?: string
  icon: string
  groups: readonly SettingsGroup[]
}
