import type { NavId } from '@/types'

export type WindowSurface =
  'workspace' | 'settings' | 'connection' | 'remote-editor' | 'splash'
export interface WindowEntry {
  surface: WindowSurface
  path: string
}

export function isWorkspaceNav(value: unknown): value is NavId {
  return ['servers', 'databases', 'ssh-keys', 'recent'].includes(String(value))
}

/** 旧版 Rust query 入口集中转换；窗口身份一经启动确定，不随路由改变。 */
export function resolveWindowEntry(
  search: string,
  hash: string,
  nativeLabel?: string
): WindowEntry {
  const query = new URLSearchParams(search)
  const path = hash.replace(/^#/, '').split('?')[0]
  const requested = query.get('window') ?? path.split('/')[1]
  const surface: WindowSurface = nativeLabel
    ? nativeLabel.startsWith('remote-editor-')
      ? 'remote-editor'
      : ['settings', 'connection', 'splash'].includes(nativeLabel)
        ? (nativeLabel as WindowSurface)
        : 'workspace'
    : ['settings', 'connection', 'remote-editor', 'splash'].includes(
          requested ?? ''
        )
      ? (requested as WindowSurface)
      : 'workspace'
  if (surface === 'connection') {
    const kind = ['ssh', 'local', 'database'].includes(query.get('type') ?? '')
      ? query.get('type')!
      : 'ssh'
    const connectionId = query.get('connectionId')
    return {
      surface,
      path: `/connection/${kind}${connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ''}`,
    }
  }
  return {
    surface,
    path:
      surface === 'workspace'
        ? '/servers'
        : surface === 'settings'
          ? '/settings/general'
          : `/${surface}`,
  }
}
