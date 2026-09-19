import type { NavId } from '@/types'

export type WindowSurface =
  | 'workspace'
  | 'settings'
  | 'connection'
  | 'remote-editor'
  | 'splash'
  | 'column-tags'
export interface WindowEntry {
  surface: WindowSurface
  path: string
}

/** 由 Rust 用固定 label 创建的子窗口。 */
const NATIVE_SURFACES: readonly WindowSurface[] = [
  'settings',
  'connection',
  'splash',
  'column-tags',
]
/** 可以通过 `?window=` 或 hash 路径请求的子窗口。 */
const REQUESTABLE_SURFACES: readonly WindowSurface[] = [
  ...NATIVE_SURFACES,
  'remote-editor',
]

function surfaceOf(
  candidates: readonly WindowSurface[],
  value: string
): WindowSurface | undefined {
  return candidates.find(surface => surface === value)
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
      : (surfaceOf(NATIVE_SURFACES, nativeLabel) ?? 'workspace')
    : (surfaceOf(REQUESTABLE_SURFACES, requested ?? '') ?? 'workspace')
  if (surface === 'connection') {
    const kind = ['ssh', 'local', 'database'].includes(query.get('type') ?? '')
      ? query.get('type')!
      : 'ssh'
    const connectionId = query.get('connectionId')
    // 新建时可以带上预选分组；编辑已有连接时归属以存档为准，忽略它。
    const group = connectionId ? null : query.get('group')
    const params = new URLSearchParams()
    if (connectionId) params.set('connectionId', connectionId)
    if (group) params.set('group', group)
    const search = params.toString()
    return {
      surface,
      path: `/connection/${kind}${search ? `?${search}` : ''}`,
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
