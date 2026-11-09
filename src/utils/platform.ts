import type { LocalShellKind } from '@/types/connection'

/** 根据桌面 WebView 的系统标识选择本机能力；无浏览器的测试环境沿用 Windows 默认值。 */
export function desktopPlatform(
  agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
): 'windows' | 'macos' | 'linux' {
  if (/Macintosh|Mac OS X/i.test(agent)) return 'macos'
  if (/Linux/i.test(agent)) return 'linux'
  return 'windows'
}

export const DESKTOP_PLATFORM = desktopPlatform()
export const DEFAULT_LOCAL_SHELL: LocalShellKind =
  DESKTOP_PLATFORM === 'windows' ? 'powershell' : 'system'

/** 打开跨系统导入的本地连接或旧设置时，将不兼容的 Shell 回退为本机默认 Shell。 */
export function normalizeLocalShell(shell: string): LocalShellKind {
  const supported =
    DESKTOP_PLATFORM === 'windows'
      ? ['powershell', 'cmd', 'git-bash']
      : ['system', 'bash', 'zsh']
  return supported.includes(shell)
    ? (shell as LocalShellKind)
    : DEFAULT_LOCAL_SHELL
}
