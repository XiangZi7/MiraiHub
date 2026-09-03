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

import type { NewConnection, SavedConnection } from '@/types/connection'

const STORAGE_KEY = 'miraihub.connections.v1'

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
    if (!raw)
      return []

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as SavedConnection[] : []
  }
  catch (err) {
    console.warn('读取连接配置失败，按空列表处理：', err)
    return []
  }
}

function writeAll(connections: SavedConnection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connections))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

/** 生成连接 id。时间戳前缀让列表天然按创建顺序有序 */
function newId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 列出全部连接，按最近使用倒序 —— 常用的排前面 */
export async function list(): Promise<SavedConnection[]> {
  return readAll().sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

/** 按 id 取单条 */
export async function get(id: string): Promise<SavedConnection | undefined> {
  return readAll().find(item => item.id === id)
}

/** 新增一条，返回补全了 id 与时间戳的记录 */
export async function create(input: NewConnection): Promise<SavedConnection> {
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
  patch: Partial<Omit<SavedConnection, 'id'>>,
): Promise<void> {
  writeAll(
    readAll().map(item => (item.id === id ? { ...item, ...patch } : item)),
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
    if (event.key === STORAGE_KEY || event.key === null)
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
