import type { SettingsPage } from '@/types/settings'
import { LOCAL_SHELL_OPTIONS } from '@/constants/connection'

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    id: 'general',
    label: '通用',
    title: '通用设置',
    description: '启动行为、时间显示与系统托盘。',
    icon: 'lucide:settings-2',
    groups: [
      {
        title: '启动',
        fields: [
          {
            key: 'launchAtStartup',
            label: '开机时自动启动',
            description: '登录 Windows 后自动运行 MiraiHub',
            control: 'switch',
          },
          {
            key: 'restoreLastSession',
            label: '启动时恢复上次打开的标签',
            description: '重新打开退出前的连接标签，但不会自动建立连接以外的操作',
            control: 'switch',
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
        title: '系统托盘',
        fields: [
          {
            key: 'showTrayIcon',
            label: '显示系统托盘图标',
            description: '托盘菜单可快速显示主窗口或退出应用',
            control: 'switch',
          },
          {
            key: 'minimizeToTray',
            label: '关闭窗口时最小化到托盘',
            description: '点击关闭按钮只隐藏窗口，应用继续在后台运行',
            control: 'switch',
            dependsOn: 'showTrayIcon',
          },
        ],
      },
    ],
  },
  {
    id: 'appearance',
    label: '外观',
    title: '外观设置',
    description: '窗口材质、界面密度与动效。',
    icon: 'lucide:palette',
    groups: [
      {
        title: '窗口',
        fields: [
          {
            key: 'windowMaterial',
            label: '窗口材质',
            description: 'Mica 仅 Windows 11 可用，其他系统会退回到模糊效果',
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
          {
            key: 'compactLayout',
            label: '紧凑布局',
            description: '收紧列表行高与按钮间距，一屏显示更多内容',
            control: 'switch',
          },
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
          {
            key: 'reduceMotion',
            label: '减少动画效果',
            description: '关闭过渡与浮层动画',
            control: 'switch',
          },
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    title: '快捷键',
    description: '点击输入框后按下新的组合键即可修改。',
    icon: 'lucide:keyboard',
    groups: [
      {
        title: '全局快捷键',
        fields: [
          { key: 'shortcutPalette', label: '打开命令面板', control: 'shortcut', size: 'lg' },
          { key: 'shortcutTerminal', label: '新建本地终端', control: 'shortcut', size: 'lg' },
          { key: 'shortcutSearch', label: '全局搜索', control: 'shortcut', size: 'lg' },
          { key: 'shortcutFiles', label: '打开文件面板', control: 'shortcut', size: 'lg' },
        ],
      },
    ],
  },
  {
    id: 'connections',
    label: '连接',
    title: '连接设置',
    description: '新建连接时的默认值，以及数据库与传输的运行参数。',
    icon: 'lucide:link-2',
    groups: [
      {
        title: 'SSH 默认值',
        fields: [
          {
            key: 'sshTimeout',
            label: '连接超时时间（秒）',
            description: '作为新建 SSH 连接的默认值',
            control: 'text',
            inputmode: 'numeric',
            size: 'sm',
            range: { min: 1, max: 3600 },
          },
          {
            key: 'keepConnectionAlive',
            label: '默认开启 Keep Alive',
            description: '新建连接默认每 60 秒发送一次心跳',
            control: 'switch',
          },
          {
            key: 'autoReconnect',
            label: '连接意外断开后自动重连',
            description: '最多尝试 3 次，主动退出的会话不会重连',
            control: 'switch',
          },
        ],
      },
      {
        title: '数据库',
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
            label: '每个连接的连接池上限',
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
            label: '单条 SQL 执行超时（秒）',
            control: 'select',
            size: 'sm',
            options: [
              { value: '60', label: '60' },
              { value: '300', label: '300' },
              { value: '600', label: '600' },
              { value: '0', label: '不限制' },
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
            description: '超出的任务排队等待',
            control: 'select',
            size: 'sm',
            options: [
              { value: '1', label: '1' },
              { value: '3', label: '3' },
              { value: '5', label: '5' },
            ],
          },
          {
            key: 'transferBufferSizeKb',
            label: '传输缓冲区大小（KB）',
            description: '更大的缓冲区能提升大文件吞吐，部分服务器不支持超过 256 KB 的数据包',
            control: 'select',
            size: 'sm',
            options: [
              { value: '32', label: '32' },
              { value: '64', label: '64' },
              { value: '128', label: '128' },
              { value: '256', label: '256' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'terminal',
    label: '终端',
    title: '终端设置',
    description: '修改后立即作用于所有已打开的终端。',
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
            description: '新建本地终端时预选的 Shell',
            control: 'select',
            size: 'lg',
            options: LOCAL_SHELL_OPTIONS.map(option => ({ value: option.value, label: option.label })),
          },
          {
            key: 'terminalScrollback',
            label: '回滚行数',
            control: 'text',
            inputmode: 'numeric',
            size: 'md',
            range: { min: 100, max: 200000 },
          },
        ],
      },
    ],
  },
  {
    id: 'files',
    label: '文件',
    title: '文件设置',
    description: '远端文件浏览与下载行为。',
    icon: 'lucide:folder',
    groups: [
      {
        title: '文件浏览',
        fields: [
          { key: 'showHiddenFiles', label: '显示隐藏文件', description: '显示以 . 开头的文件和目录', control: 'switch' },
          { key: 'confirmFileDelete', label: '删除前确认', control: 'switch' },
          {
            key: 'overwriteBehavior',
            label: '上传遇到同名文件时',
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
            description: '下载对话框默认打开的位置，留空则跟随系统',
            control: 'directory',
            placeholder: '跟随系统下载目录',
            size: 'lg',
          },
        ],
      },
    ],
  },
  {
    id: 'data',
    label: '数据',
    title: '数据设置',
    description: '会话与查询历史的保存策略。',
    icon: 'lucide:database',
    groups: [
      {
        title: '历史记录',
        fields: [
          { key: 'saveSessionHistory', label: '记录最近会话', description: '关闭后「最近」视图不再更新', control: 'switch' },
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
            label: '最近会话数量上限',
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
    label: '安全',
    title: '安全设置',
    description: '主机密钥、凭据与剪贴板。',
    icon: 'lucide:shield-check',
    groups: [
      {
        title: '连接安全',
        fields: [
          {
            key: 'verifyHostKey',
            label: '验证 SSH 主机密钥',
            description: '首次连接记录到 ~/.ssh/known_hosts，之后密钥变化将拒绝连接',
            control: 'switch',
          },
          {
            key: 'rememberPasswords',
            label: '允许保存连接密码',
            description: '关闭后连接表单不再提供「保存密码」，连接时临时输入',
            control: 'switch',
          },
        ],
      },
      {
        title: '剪贴板',
        fields: [
          {
            key: 'clipboardClearTimeout',
            label: '自动清空剪贴板',
            description: '在应用内复制的内容会在指定时间后从剪贴板清除',
            control: 'select',
            size: 'md',
            options: [
              { value: '0', label: '关闭' },
              { value: '30', label: '30 秒后' },
              { value: '60', label: '60 秒后' },
              { value: '300', label: '5 分钟后' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'notifications',
    label: '通知',
    title: '通知设置',
    description: '控制右下角弹出的提示。',
    icon: 'lucide:bell',
    groups: [
      {
        title: '应用通知',
        fields: [
          { key: 'notifyConnectionChanges', label: '连接建立与断开', control: 'switch' },
          { key: 'notifyTransferComplete', label: '文件传输完成', control: 'switch' },
          {
            key: 'notifyErrors',
            label: '错误与异常',
            description: '关闭后操作失败只在对应面板内提示，不再弹出通知',
            control: 'switch',
          },
          { key: 'notificationSound', label: '播放提示音', control: 'switch' },
        ],
      },
    ],
  },
  {
    id: 'about',
    label: '关于',
    title: '关于应用',
    icon: 'lucide:info',
    groups: [
      {
        title: 'MiraiHub',
        fields: [
          { id: 'version', label: '版本', control: 'display', displayValue: '0.1.0' },
          { id: 'tauriVersion', label: 'Tauri 版本', control: 'display', displayValue: '—' },
          { label: '运行框架', control: 'display', displayValue: 'Tauri 2 + Vue 3' },
          { label: '终端引擎', control: 'display', displayValue: 'xterm.js' },
          { id: 'platform', label: '运行平台', control: 'display', displayValue: '—' },
        ],
      },
    ],
  },
] as const
