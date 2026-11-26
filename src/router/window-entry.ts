import type { NavId } from '@/types'
import type { ConnectionFormKind } from '@/types/connection'

export type WindowSurface =
  | 'workspace'
  | 'settings'
  | 'connection'
  | 'remote-editor'
  | 'docker-logs'
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
  'docker-logs',
]

/** 动态原生窗口的标签带有目标标识，路由只需识别窗口类型。 */
function nativeSurface(label: string): WindowSurface {
  if (label.startsWith('docker-logs-')) return 'docker-logs'
  if (label.startsWith('remote-editor-')) return 'remote-editor'
  return surfaceOf(NATIVE_SURFACES, label) ?? 'workspace'
}

function surfaceOf(
  candidates: readonly WindowSurface[],
  value: string
): WindowSurface | undefined {
  return candidates.find(surface => surface === value)
}

/** 校验可保存并在下一次启动时恢复的工作区分类。 */
export function isWorkspaceNav(value: unknown): value is NavId {
  return ['servers', 'databases', 'docker'].includes(String(value))
}

/** 校验原生连接窗口和前端路由共同支持的表单类型。 */
export function isConnectionFormKind(
  value: unknown
): value is ConnectionFormKind {
  return (
    value === 'ssh' ||
    value === 'local' ||
    value === 'rdp' ||
    value === 'database' || value === 'docker'
  )
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
    ? nativeSurface(nativeLabel)
    : (surfaceOf(REQUESTABLE_SURFACES, requested ?? '') ?? 'workspace')
  if (surface === 'docker-logs') {
    const target = new URLSearchParams()
    const source = nativeLabel || query.has('window')
      ? query
      : new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
    for (const key of ['connectionId', 'containerId', 'containerName']) {
      const value = source.get(key)
      if (value) target.set(key, value)
    }
    return { surface, path: target.size ? `/docker-logs?${target}` : '/docker-logs' }
  }
  if (surface === 'connection') {
    const type = query.get('type')
    const kind = isConnectionFormKind(type) ? type : 'ssh'
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
