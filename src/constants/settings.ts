import type { SettingsPage } from '@/types/settings'

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    id: 'general',
    label: '通用设置',
    title: '通用设置',
    icon: 'lucide:settings-2',
    groups: [
      {
        title: '启动设置',
        fields: [
          { key: 'launchAtStartup', label: '开机时自动启动', control: 'switch' },
          { key: 'restoreLastSession', label: '启动时打开上次会话', control: 'switch' },
        ],
      },
      {
        title: '语言设置',
        fields: [
          {
            key: 'language',
            label: '应用语言',
            control: 'select',
            size: 'md',
            options: [
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en-US', label: 'English' },
            ],
          },
        ],
      },
      {
        title: '日期和时间',
        fields: [
          {
            key: 'timeFormat',
            label: '时间格式',
            control: 'select',
            size: 'md',
            options: [
              { value: '24-hour', label: '24 小时制' },
              { value: '12-hour', label: '12 小时制' },
            ],
          },
          {
            key: 'dateFormat',
            label: '日期格式',
            control: 'select',
            size: 'md',
            options: [
              { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
              { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
              { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
            ],
          },
        ],
      },
      {
        title: '其他',
        fields: [
          { key: 'showTrayIcon', label: '显示系统托盘图标', control: 'switch' },
          { key: 'minimizeToTray', label: '最小化到系统托盘', control: 'switch' },
        ],
      },
    ],
  },
  {
    id: 'appearance',
    label: '外观设置',
    title: '外观设置',
    icon: 'lucide:sun',
    groups: [
      {
        title: '主题',
        fields: [
          {
            key: 'theme',
            label: '应用主题',
            control: 'select',
            size: 'md',
            options: [
              { value: 'dark', label: '深色' },
              { value: 'system', label: '跟随系统' },
            ],
          },
          {
            key: 'windowMaterial',
            label: '窗口材质',
            description: '更改后将在下次启动时生效',
            control: 'select',
            size: 'md',
            options: [
              { value: 'acrylic', label: 'Acrylic' },
              { value: 'mica', label: 'Mica' },
              { value: 'solid', label: '纯色' },
            ],
          },
        ],
      },
      {
        title: '界面',
        fields: [
          { key: 'compactLayout', label: '紧凑布局', control: 'switch' },
          {
            key: 'uiScale',
            label: '界面缩放',
            control: 'select',
            size: 'sm',
            options: [
              { value: '90', label: '90%' },
              { value: '100', label: '100%' },
              { value: '110', label: '110%' },
              { value: '125', label: '125%' },
            ],
          },
          { key: 'reduceMotion', label: '减少动画效果', control: 'switch' },
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    title: '快捷键',
    icon: 'lucide:keyboard',
    groups: [
      {
        title: '全局快捷键',
        fields: [
          { key: 'shortcutPalette', label: '打开命令面板', control: 'shortcut', size: 'md' },
          { key: 'shortcutTerminal', label: '新建终端', control: 'shortcut', size: 'md' },
          { key: 'shortcutSearch', label: '全局搜索', control: 'shortcut', size: 'md' },
          { key: 'shortcutFiles', label: '打开文件', control: 'shortcut', size: 'md' },
        ],
      },
    ],
  },
  {
    id: 'connections',
    label: '连接设置',
    title: '默认设置',
    icon: 'lucide:link-2',
    groups: [
      {
        title: '默认设置',
        fields: [
          { key: 'sshTimeout', label: '连接超时时间（秒）', control: 'text', inputmode: 'numeric', size: 'sm' },
          { key: 'keepConnectionAlive', label: '保持连接活跃', control: 'switch' },
          { key: 'autoReconnect', label: '自动重连', control: 'switch' },
        ],
      },
      {
        title: '数据库连接',
        fields: [
          {
            key: 'databaseTimeout',
            label: '连接超时时间（秒）',
            control: 'select',
            size: 'sm',
            options: [
              { value: '10', label: '10' },
              { value: '30', label: '30' },
              { value: '60', label: '60' },
            ],
          },
          {
            key: 'maxDatabaseConnections',
            label: '最大连接数',
            control: 'select',
            size: 'sm',
            options: [
              { value: '5', label: '5' },
              { value: '10', label: '10' },
              { value: '20', label: '20' },
            ],
          },
          {
            key: 'sqlExecutionTimeout',
            label: 'SQL 执行超时时间（秒）',
            control: 'select',
            size: 'sm',
            options: [
              { value: '60', label: '60' },
              { value: '300', label: '300' },
              { value: '600', label: '600' },
            ],
          },
        ],
      },
      {
        title: '文件传输',
        fields: [
          {
            key: 'maxFileTransfers',
            label: '最大并发传输数',
            control: 'select',
            size: 'sm',
            options: [
              { value: '1', label: '1' },
              { value: '3', label: '3' },
              { value: '5', label: '5' },
            ],
          },
          {
            key: 'transferBufferSize',
            label: '传输缓冲区大小（MB）',
            control: 'select',
            size: 'sm',
            options: [
              { value: '4', label: '4' },
              { value: '8', label: '8' },
              { value: '16', label: '16' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'terminal',
    label: '终端设置',
    title: '终端设置',
    icon: 'lucide:square-terminal',
    groups: [
      {
        title: '终端外观',
        fields: [
          {
            key: 'terminalFont',
            label: '终端字体',
            control: 'select',
            size: 'lg',
            options: [
              { value: 'jetbrains-mono', label: 'JetBrains Mono' },
              { value: 'cascadia-code', label: 'Cascadia Code' },
              { value: 'consolas', label: 'Consolas' },
            ],
          },
          {
            key: 'terminalFontSize',
            label: '字体大小',
            control: 'select',
            size: 'sm',
            options: [
              { value: '12', label: '12' },
              { value: '13', label: '13' },
              { value: '14', label: '14' },
              { value: '16', label: '16' },
            ],
          },
          {
            key: 'terminalCursor',
            label: '光标样式',
            control: 'select',
            size: 'md',
            options: [
              { value: 'block', label: '方块' },
              { value: 'bar', label: '竖线' },
              { value: 'underline', label: '下划线' },
            ],
          },
          { key: 'terminalCursorBlink', label: '光标闪烁', control: 'switch' },
        ],
      },
      {
        title: '终端行为',
        fields: [
          {
            key: 'terminalShell',
            label: '默认本地 Shell',
            control: 'select',
            size: 'lg',
            options: [
              { value: 'powershell', label: 'PowerShell' },
              { value: 'cmd', label: 'Command Prompt' },
              { value: 'git-bash', label: 'Git Bash' },
            ],
          },
          { key: 'terminalScrollback', label: '回滚行数', control: 'text', inputmode: 'numeric', size: 'md' },
        ],
      },
    ],
  },
  {
    id: 'files',
    label: '文件设置',
    title: '文件设置',
    icon: 'lucide:folder',
    groups: [
      {
        title: '文件浏览',
        fields: [
          { key: 'showHiddenFiles', label: '显示隐藏文件', control: 'switch' },
          { key: 'confirmFileDelete', label: '删除前确认', control: 'switch' },
          {
            key: 'overwriteBehavior',
            label: '文件冲突时',
            control: 'select',
            size: 'md',
            options: [
              { value: 'ask', label: '每次询问' },
              { value: 'overwrite', label: '直接覆盖' },
              { value: 'rename', label: '自动重命名' },
            ],
          },
        ],
      },
      {
        title: '下载',
        fields: [
          {
            key: 'defaultDownloadDirectory',
            label: '默认下载目录',
            control: 'text',
            placeholder: '跟随系统下载目录',
            size: 'lg',
          },
        ],
      },
    ],
  },
  {
    id: 'data',
    label: '数据设置',
    title: '数据设置',
    icon: 'lucide:database',
    groups: [
      {
        title: '历史记录',
        fields: [
          { key: 'saveSessionHistory', label: '保存会话历史', control: 'switch' },
          { key: 'saveQueryHistory', label: '保存 SQL 查询历史', control: 'switch' },
          {
            key: 'historyRetention',
            label: '历史保留天数',
            control: 'select',
            size: 'sm',
            options: [
              { value: '7', label: '7' },
              { value: '30', label: '30' },
              { value: '90', label: '90' },
              { value: '0', label: '永久' },
            ],
          },
          {
            key: 'maxRecentItems',
            label: '最近项目数量',
            control: 'select',
            size: 'sm',
            options: [
              { value: '20', label: '20' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'security',
    label: '安全设置',
    title: '安全设置',
    icon: 'lucide:shield-check',
    groups: [
      {
        title: '连接安全',
        fields: [
          { key: 'verifyHostKey', label: '验证 SSH 主机密钥', control: 'switch' },
          { key: 'rememberPasswords', label: '允许保存连接密码', control: 'switch' },
        ],
      },
      {
        title: '隐私',
        fields: [
          {
            key: 'clipboardClearTimeout',
            label: '剪贴板清理时间（秒）',
            control: 'select',
            size: 'sm',
            options: [
              { value: '0', label: '关闭' },
              { value: '30', label: '30' },
              { value: '60', label: '60' },
            ],
          },
          { key: 'lockOnIdle', label: '空闲时锁定应用', control: 'switch' },
        ],
      },
    ],
  },
  {
    id: 'notifications',
    label: '通知设置',
    title: '通知设置',
    icon: 'lucide:bell',
    groups: [
      {
        title: '应用通知',
        fields: [
          { key: 'notifyConnectionChanges', label: '连接状态变化', control: 'switch' },
          { key: 'notifyTransferComplete', label: '文件传输完成', control: 'switch' },
          { key: 'notifyErrors', label: '错误与异常', control: 'switch' },
          { key: 'notificationSound', label: '播放通知声音', control: 'switch' },
        ],
      },
    ],
  },
  {
    id: 'about',
    label: '关于应用',
    title: '关于应用',
    icon: 'lucide:info',
    groups: [
      {
        title: 'MiraiHub',
        fields: [
          { label: '版本', control: 'display', displayValue: '0.1.0' },
          { label: '运行框架', control: 'display', displayValue: 'Tauri 2 + Vue 3' },
          { label: '终端引擎', control: 'display', displayValue: 'xterm.js' },
        ],
      },
    ],
  },
] as const
