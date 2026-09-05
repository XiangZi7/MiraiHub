import { settingNumber, settingsSnapshot } from '@/composables/useSettings'
import type { DatabaseHistoryEntry } from '@/types/database'

const STORAGE_KEY = 'miraihub.database-query-history.v1'
const MAX_ENTRIES = 50

function readAll(): DatabaseHistoryEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value)) return []

    return value.filter(
      (entry): entry is DatabaseHistoryEntry =>
        typeof entry?.id === 'string' &&
        typeof entry?.connectionId === 'string' &&
        typeof entry?.database === 'string' &&
        typeof entry?.sql === 'string' &&
        typeof entry?.executedAt === 'number'
    )
  } catch {
    return []
  }
}

function writeAll(entries: DatabaseHistoryEntry[]): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(entries.slice(0, MAX_ENTRIES))
  )
}

/** 按「历史保留天数」计算的最早时间戳；0 表示永久保留 */
function retentionCutoff(): number {
  const days = settingNumber('historyRetention', 30)
  return days > 0 ? Date.now() - days * 86_400_000 : 0
}

/** 读取时顺手清掉过期记录，保留策略变更后无需额外的清理入口。 */
function readRetained(): DatabaseHistoryEntry[] {
  const all = readAll()
  const cutoff = retentionCutoff()
  const kept = cutoff ? all.filter(entry => entry.executedAt >= cutoff) : all
  if (kept.length !== all.length) writeAll(kept)
  return kept
}

export function listQueryHistory(
  connectionId?: string
): DatabaseHistoryEntry[] {
  const entries = readRetained().sort((a, b) => b.executedAt - a.executedAt)
  return connectionId
    ? entries.filter(entry => entry.connectionId === connectionId)
    : entries
}

export function addQueryHistory(
  input: Omit<DatabaseHistoryEntry, 'id' | 'executedAt'>
): DatabaseHistoryEntry {
  const now = Date.now()
  const entry: DatabaseHistoryEntry = {
    ...input,
    id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
    executedAt: now,
  }

  // 关闭历史记录时仍返回条目对象，调用方无需区分
  if (!settingsSnapshot().saveQueryHistory) return entry

  const entries = readRetained().filter(
    existing =>
      !(
        existing.connectionId === entry.connectionId &&
        existing.database === entry.database &&
        existing.sql.trim() === entry.sql.trim()
      )
  )
  writeAll([entry, ...entries])
  return entry
}

export function clearQueryHistory(connectionId?: string): void {
  if (!connectionId) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  writeAll(readAll().filter(entry => entry.connectionId !== connectionId))
}
