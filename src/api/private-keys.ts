/**
 * SSH 私钥路径注册表。
 *
 * 密钥文件始终留在用户选择的位置；这里只持久化多个路径、显示名和默认项。
 * 连接窗口与 SSH Keys 主视图通过 storage + 自定义事件保持同步。
 */

import { open } from '@tauri-apps/plugin-dialog'
import type { StoredPrivateKey, PrivateKeyRegistrySnapshot } from '@/types/private-key'
import type { SshKeyInfo } from '@/types/ssh'
import { IS_TAURI } from '@/utils/window'

const STORAGE_KEY = 'miraihub.private-keys.v1'
const CHANGE_EVENT = 'miraihub:private-keys-changed'
const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

function identity(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/$/, '')
  return IS_WINDOWS ? normalized.toLocaleLowerCase() : normalized
}

function labelFromPath(path: string): string {
  return path.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? path.trim()
}

function emptySnapshot(): PrivateKeyRegistrySnapshot {
  return { keys: [], defaultPath: '' }
}

function sanitize(raw: unknown): PrivateKeyRegistrySnapshot {
  if (typeof raw !== 'object' || raw === null)
    return emptySnapshot()

  const value = raw as Partial<PrivateKeyRegistrySnapshot>
  const seen = new Set<string>()
  const keys = Array.isArray(value.keys)
    ? value.keys.flatMap((candidate): StoredPrivateKey[] => {
        if (typeof candidate !== 'object' || candidate === null)
          return []

        const item = candidate as Partial<StoredPrivateKey>
        if (typeof item.path !== 'string' || !item.path.trim())
          return []

        const key = identity(item.path)
        if (seen.has(key))
          return []

        seen.add(key)
        return [{
          path: item.path.trim(),
          label: typeof item.label === 'string' && item.label.trim()
            ? item.label.trim()
            : labelFromPath(item.path),
          source: item.source === 'local' ? 'local' : 'imported',
          addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
        }]
      })
    : []

  const requestedDefault = typeof value.defaultPath === 'string' ? value.defaultPath : ''
  const defaultPath = keys.find(item => identity(item.path) === identity(requestedDefault))?.path ?? ''

  return { keys, defaultPath }
}

function read(): PrivateKeyRegistrySnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitize(JSON.parse(raw)) : emptySnapshot()
  }
  catch (error) {
    console.warn('读取 SSH 私钥列表失败，已按空列表处理：', error)
    return emptySnapshot()
  }
}

function write(snapshot: PrivateKeyRegistrySnapshot): PrivateKeyRegistrySnapshot {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  return snapshot
}

function mergeKeys(
  current: readonly StoredPrivateKey[],
  incoming: readonly Omit<StoredPrivateKey, 'addedAt'>[],
): StoredPrivateKey[] {
  const next = [...current]

  for (const candidate of incoming) {
    const existingIndex = next.findIndex(item => identity(item.path) === identity(candidate.path))
    if (existingIndex >= 0) {
      const existing = next[existingIndex]
      next[existingIndex] = {
        ...existing,
        label: candidate.label || existing.label,
        // 用户显式选择过的路径不能被一次 ~/.ssh 扫描降级成可清理的 local 项。
        source: existing.source === 'imported' ? 'imported' : candidate.source,
      }
      continue
    }

    next.push({ ...candidate, addedAt: Date.now() })
  }

  return next
}

export function getSnapshot(): PrivateKeyRegistrySnapshot {
  return read()
}

/** 记住文件选择器选中的一个或多个私钥；第一把会在无默认值时成为默认。 */
export function rememberImported(paths: readonly string[]): PrivateKeyRegistrySnapshot {
  const current = read()
  const candidates = paths
    .map(path => path.trim())
    .filter(path => path && !path.toLocaleLowerCase().endsWith('.pub'))
    .map(path => ({ path, label: labelFromPath(path), source: 'imported' as const }))
  const keys = mergeKeys(current.keys, candidates)
  const defaultPath = current.defaultPath || keys[0]?.path || ''

  return write({ keys, defaultPath })
}

/** 把 Rust 扫描到的 ~/.ssh 密钥并入注册表，并清掉已经不存在的 local 记录。 */
export function syncLocalKeys(keys: readonly SshKeyInfo[]): PrivateKeyRegistrySnapshot {
  const current = read()
  const livePaths = new Set(keys.map(key => identity(key.id)))
  const retained = current.keys.filter(item => item.source === 'imported' || livePaths.has(identity(item.path)))
  const merged = mergeKeys(retained, keys.map(key => ({
    path: key.id,
    label: key.label,
    source: 'local' as const,
  })))
  const defaultStillExists = merged.some(item => identity(item.path) === identity(current.defaultPath))
  const defaultPath = defaultStillExists ? current.defaultPath : merged[0]?.path || ''

  return write({ keys: merged, defaultPath })
}

export function forget(path: string): PrivateKeyRegistrySnapshot {
  const current = read()
  const keys = current.keys.filter(item => identity(item.path) !== identity(path))
  const defaultPath = identity(current.defaultPath) === identity(path)
    ? keys[0]?.path || ''
    : current.defaultPath

  return write({ keys, defaultPath })
}

export function setDefaultPath(path: string): PrivateKeyRegistrySnapshot {
  const current = read()
  const defaultPath = current.keys.find(item => identity(item.path) === identity(path))?.path ?? ''
  return write({ ...current, defaultPath })
}

/** 打开系统原生文件选择器；支持一次选择多把私钥。 */
export async function pickPrivateKeys(): Promise<string[]> {
  if (!IS_TAURI)
    throw new Error('系统文件选择器需要在 MiraiHub 桌面应用中运行')

  const selected = await open({
    title: '选择 SSH 私钥',
    directory: false,
    multiple: true,
  })

  if (!selected)
    return []

  const privateKeyPaths = selected.filter(path => !path.toLocaleLowerCase().endsWith('.pub'))
  if (!privateKeyPaths.length)
    throw new Error('请选择私钥文件，不要选择 .pub 公钥文件')

  return privateKeyPaths
}

export function subscribe(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY || event.key === null)
      listener()
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('focus', listener)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('focus', listener)
  }
}
