import type { ConnectionTagColor, LocalShellKind } from '@/types/connection'
import type { DatabaseConnectionKind } from '@/types/database'
import { DESKTOP_PLATFORM } from '@/utils/platform'

/** 侧栏和连接标签统一使用 Iconify 原版彩色产品图标。 */
export const DATABASE_CONNECTION_ICONS: Record<
  DatabaseConnectionKind,
  { name: string; label: string }
> = {
  mysql: { name: 'logos:mysql-icon', label: 'MySQL' },
  redis: { name: 'logos:redis', label: 'Redis' },
  postgresql: { name: 'logos:postgresql', label: 'PostgreSQL' },
  sqlite: { name: 'logos:sqlite', label: 'SQLite' },
}

export interface ConnectionTagColorOption {
  id: ConnectionTagColor
  label: string
  css: string
}

/** 连接标签与终端标签页共用的颜色，全部来自现有主题令牌。 */
export const CONNECTION_TAG_COLORS: readonly ConnectionTagColorOption[] = [
  { id: 'red', label: '红色', css: 'var(--color-danger)' },
  { id: 'orange', label: '橙色', css: 'var(--color-orange)' },
  { id: 'amber', label: '黄色', css: 'var(--color-amber)' },
  { id: 'green', label: '绿色', css: 'var(--color-success)' },
  { id: 'cyan', label: '青色', css: 'var(--color-cyan)' },
  { id: 'blue', label: '蓝色', css: 'var(--color-blue)' },
  { id: 'violet', label: '紫色', css: 'var(--color-violet)' },
  { id: 'gray', label: '灰色', css: 'var(--color-txt-3)' },
]

export const LOCAL_SHELL_OPTIONS: readonly {
  value: LocalShellKind
  label: string
  description: string
}[] =
  DESKTOP_PLATFORM === 'windows'
    ? [
        {
          value: 'powershell',
          label: 'Windows PowerShell',
          description: 'Windows 自带 PowerShell',
        },
        {
          value: 'cmd',
          label: 'Command Prompt',
          description: 'Windows 命令提示符',
        },
        {
          value: 'git-bash',
          label: 'Git Bash',
          description: 'Git for Windows 提供的 Bash',
        },
      ]
    : [
        {
          value: 'system',
          label: '系统默认 Shell',
          description: '使用当前用户的登录 Shell',
        },
        { value: 'bash', label: 'Bash', description: '启动 Bash 登录终端' },
        {
          value: 'zsh',
          label: 'Zsh',
          description: '启动 Zsh 登录终端（需已安装）',
        },
      ]

export function connectionTagColorCss(
  color: ConnectionTagColor | undefined
): string {
  return (
    CONNECTION_TAG_COLORS.find(option => option.id === color)?.css ??
    'var(--color-accent)'
  )
}
