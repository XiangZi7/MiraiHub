/**
 * 连接配置的持久化。
 *
 * 现在落在 localStorage，接口按"将来是异步的数据库"设计 ——
 * 所有方法都返回 Promise，调用方已经在 await，
 * 换成 Tauri 侧的 SQLite 时只需要替换这个文件的实现，组件一行不动。
 *
 * 凭据也一并存着：这是本地桌面应用，数据不出机器；
 * 换到数据库后应当把 password/passphrase 挪到系统钥匙串，
 * 那时这里只留一个引用 id。
 */

import type {
  ConnectionGroup,
  ConnectionGroupKind,
  ConnectionTagDefinition,
  NewConnection,
  SavedConnection,
} from '@/types/connection'
import type { ConnectionTagColor } from '@/types/connection'
import { groupKindOf } from '@/types/connection'

const STORAGE_KEY = 'miraihub.connections.v1'
const GROUP_STORAGE_KEY = 'miraihub.connection-groups.v1'
const TAG_STORAGE_KEY = 'miraihub.connection-tags.v1'

/** 通知同一页面内的其他订阅者数据变了 */
const CHANGE_EVENT = 'miraihub:connections-changed'

/**
 * 读全量。
 *
 * 解析失败时返回空数组而不是抛错：存储被手改坏、或换了版本格式，
 * 都不该让整个应用打不开 —— 大不了从空列表重新开始。
 */
function readAll(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.map(connection => {
      const item = connection as Partial<SavedConnection>
      const tags = Array.isArray(item.tags)
        ? item.tags
            .filter((tag): tag is string => typeof tag === 'string')
            .map(tag => tag.trim())
            .filter(Boolean)
        : []
      const tagColor = isTagColor(item.tagColor) ? item.tagColor : 'green'

      return { ...item, tags, tagColor } as SavedConnection
    })
  } catch (err) {
    console.warn('读取连接配置失败，按空列表处理：', err)
    return []
  }
}

function isTagColor(value: unknown): value is ConnectionTagColor {
  return [
    'red',
    'orange',
    'amber',
    'green',
    'cyan',
    'blue',
    'violet',
    'gray',
  ].includes(String(value))
}

function writeAll(connections: SavedConnection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connections))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

function readGroups(): ConnectionGroup[] {
  try {
    const raw = localStorage.getItem(GROUP_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (group): group is ConnectionGroup =>
        typeof group === 'object' &&
        group !== null &&
        typeof group.id === 'string' &&
        typeof group.name === 'string' &&
        (group.kind === 'ssh' || group.kind === 'database') &&
        typeof group.createdAt === 'number'
    )
  } catch (error) {
    console.warn('读取连接分组失败，按空列表处理：', error)
    return []
  }
}

function writeGroups(groups: ConnectionGroup[]): void {
  localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(groups))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

function readTags(): ConnectionTagDefinition[] {
  try {
    const raw = localStorage.getItem(TAG_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    const tags = Array.isArray(parsed)
      ? parsed.filter(
          (tag): tag is ConnectionTagDefinition =>
            typeof tag === 'object' &&
            tag !== null &&
            typeof tag.name === 'string' &&
            isTagColor(tag.color) &&
            typeof tag.createdAt === 'number'
        )
      : []

    // 首次升级时把旧连接上的自由文本标签收进共享目录，已有数据无需重建。
    const known = new Set(tags.map(tag => normalizedName(tag.name)))
    let changed = false
    for (const connection of readAll()) {
      for (const name of connection.tags) {
        const key = normalizedName(name)
        if (!key || known.has(key)) continue
        tags.push({
          name: name.trim(),
          color: connection.tagColor,
          createdAt: connection.createdAt,
        })
        known.add(key)
        changed = true
      }
    }

    if (changed) localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(tags))

    return tags
  } catch (error) {
    console.warn('读取共享标签失败，按空列表处理：', error)
    return []
  }
}

function writeTags(tags: ConnectionTagDefinition[]): void {
  localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(tags))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

function ensureTags(names: readonly string[], color: ConnectionTagColor): void {
  const tags = readTags()
  const known = new Set(tags.map(tag => normalizedName(tag.name)))
  const additions: ConnectionTagDefinition[] = []

  for (const rawName of names) {
    const name = rawName.trim()
    const key = normalizedName(name)
    if (!key || known.has(key)) continue
    additions.push({ name, color, createdAt: Date.now() })
    known.add(key)
  }

  if (additions.length) writeTags([...tags, ...additions])
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function ensureGroup(
  kind: ConnectionGroupKind,
  name: string
): ConnectionGroup | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined

  const groups = readGroups()
  const existing = groups.find(
    group =>
      group.kind === kind &&
      normalizedName(group.name) === normalizedName(trimmed)
  )
  if (existing) return existing

  const group: ConnectionGroup = {
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    kind,
    createdAt: Date.now(),
  }
  writeGroups([...groups, group])
  return group
}

/** 生成连接 id。时间戳前缀让列表天然按创建顺序有序 */
function newId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 按持久化顺序列出全部连接。
 *
 * 最近使用时间只用于 Recent 视图；不能在这里排序，否则每次打开连接都会让
 * 侧栏项目跳到分组首位，破坏稳定的位置记忆和手动整理后的顺序。
 */
export async function list(): Promise<SavedConnection[]> {
  return readAll()
}

export async function listGroups(): Promise<ConnectionGroup[]> {
  const groups = readGroups()
  let changed = false

  // 旧版连接只有 group 字符串，没有独立分组记录；首次读取时自动补齐，
  // 这样旧分组也能重命名、删除，并且连接移走后仍然保留空分组。
  for (const connection of readAll()) {
    const name = connection.group.trim()
    if (!name) continue

    const kind = groupKindOf(connection.kind)
    const exists = groups.some(
      group =>
        group.kind === kind &&
        normalizedName(group.name) === normalizedName(name)
    )
    if (exists) continue

    groups.push({
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      kind,
      createdAt: connection.createdAt,
    })
    changed = true
  }

  if (changed) localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(groups))

  return groups.sort((a, b) => a.createdAt - b.createdAt)
}

export async function listTags(): Promise<ConnectionTagDefinition[]> {
  return readTags().sort((a, b) => a.createdAt - b.createdAt)
}

/** 按 id 取单条 */
export async function get(id: string): Promise<SavedConnection | undefined> {
  return readAll().find(item => item.id === id)
}

/** 新增一条，返回补全了 id 与时间戳的记录 */
export async function create(input: NewConnection): Promise<SavedConnection> {
  ensureGroup(groupKindOf(input.kind), input.group)
  ensureTags(input.tags, input.tagColor)

  const connection: SavedConnection = {
    ...input,
    id: newId(),
    createdAt: Date.now(),
    lastUsedAt: 0,
  }

  writeAll([...readAll(), connection])

  return connection
}

/** 更新部分字段。id 不存在时静默忽略 —— 并发下另一端可能刚删掉它 */
export async function update(
  id: string,
  patch: Partial<Omit<SavedConnection, 'id'>>
): Promise<void> {
  const existing = readAll().find(item => item.id === id)
  if (existing) {
    const nextKind = patch.kind ?? existing.kind
    const nextGroup = patch.group ?? existing.group
    ensureGroup(groupKindOf(nextKind), nextGroup)
    ensureTags(patch.tags ?? existing.tags, patch.tagColor ?? existing.tagColor)
  }

  writeAll(
    readAll().map(item => (item.id === id ? { ...item, ...patch } : item))
  )
}

/** 删除一条 */
export async function remove(id: string): Promise<void> {
  writeAll(readAll().filter(item => item.id !== id))
}

/** 记一次使用。连接成功时调用，驱动"最近"排序与最近会话列表 */
export async function touch(id: string): Promise<void> {
  await update(id, { lastUsedAt: Date.now() })
}

export async function createGroup(
  kind: ConnectionGroupKind,
  name: string
): Promise<ConnectionGroup | undefined> {
  return ensureGroup(kind, name)
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return

  const groups = readGroups()
  const target = groups.find(group => group.id === id)
  if (!target) return

  const duplicate = groups.some(
    group =>
      group.id !== id &&
      group.kind === target.kind &&
      normalizedName(group.name) === normalizedName(trimmed)
  )
  if (duplicate) return

  const connections = readAll().map(connection =>
    groupKindOf(connection.kind) === target.kind &&
    normalizedName(connection.group) === normalizedName(target.name)
      ? { ...connection, group: trimmed }
      : connection
  )

  writeAll(connections)
  writeGroups(
    groups.map(group => (group.id === id ? { ...group, name: trimmed } : group))
  )
}

/** 删除分组时保留连接，并统一移回 Ungrouped。 */
export async function removeGroup(id: string): Promise<void> {
  const groups = readGroups()
  const target = groups.find(group => group.id === id)
  if (!target) return

  writeAll(
    readAll().map(connection =>
      groupKindOf(connection.kind) === target.kind &&
      normalizedName(connection.group) === normalizedName(target.name)
        ? { ...connection, group: '' }
        : connection
    )
  )
  writeGroups(groups.filter(group => group.id !== id))
}

/**
 * 订阅变更，返回取消订阅函数。
 *
 * 监听三个来源：
 * - `storage`：其他窗口（连接配置窗口是独立 window）的改动
 * - 自定义事件：本窗口自己的改动 —— storage 事件按规范不会派发给发起改动的那个窗口
 * - `focus`：兜底。跨 WebView 窗口的 storage 事件在各平台的 webview 实现上不完全可靠，
 *   而"配置窗口关掉、主窗重新拿到焦点"恰好就是需要刷新的那一刻
 */
export function subscribe(handler: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (
      event.key === STORAGE_KEY ||
      event.key === GROUP_STORAGE_KEY ||
      event.key === TAG_STORAGE_KEY ||
      event.key === null
    )
      handler()
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, handler)
  window.addEventListener('focus', handler)

  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, handler)
    window.removeEventListener('focus', handler)
  }
}

/** 连接备份只包含连接、分组、标签；AI 密钥与查询记录不在此范围。 */
export async function backupSnapshot(): Promise<
  import('@/utils/connection-backup').ConnectionSnapshot
> {
  return {
    connections: readAll(),
    groups: await listGroups(),
    tags: readTags(),
  }
}

/** 预览后再次检查当前配置，失败时恢复原有三项存储。 */
export function applyBackupSnapshot(
  expected: import('@/utils/connection-backup').ConnectionSnapshot,
  next: import('@/utils/connection-backup').ConnectionSnapshot
): void {
  const current = {
    connections: readAll(),
    groups: readGroups().sort((a, b) => a.createdAt - b.createdAt),
    tags: readTags(),
  }
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error('预览后连接配置发生变化，请重新读取备份并预览')
  const keys = [STORAGE_KEY, GROUP_STORAGE_KEY, TAG_STORAGE_KEY]
  const before = keys.map(key => localStorage.getItem(key))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.connections))
    localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(next.groups))
    localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(next.tags))
  } catch (error) {
    keys.forEach((key, index) => {
      const value = before[index]
      if (value === null || value === undefined) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    })
    throw error
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}
