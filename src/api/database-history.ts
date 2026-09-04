import type { DatabaseHistoryEntry } from '@/types/database'

const STORAGE_KEY = 'miraihub.database-query-history.v1'
const MAX_ENTRIES = 50

function readAll(): DatabaseHistoryEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value))
      return []

    return value.filter((entry): entry is DatabaseHistoryEntry => (
      typeof entry?.id === 'string'
      && typeof entry?.connectionId === 'string'
      && typeof entry?.database === 'string'
      && typeof entry?.sql === 'string'
      && typeof entry?.executedAt === 'number'
    ))
  }
  catch {
    return []
  }
}

function writeAll(entries: DatabaseHistoryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
}

export function listQueryHistory(connectionId?: string): DatabaseHistoryEntry[] {
  const entries = readAll().sort((a, b) => b.executedAt - a.executedAt)
  return connectionId ? entries.filter(entry => entry.connectionId === connectionId) : entries
}

export function addQueryHistory(input: Omit<DatabaseHistoryEntry, 'id' | 'executedAt'>): DatabaseHistoryEntry {
  const now = Date.now()
  const entry: DatabaseHistoryEntry = {
    ...input,
    id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
    executedAt: now,
  }
  const entries = readAll().filter(existing => !(
    existing.connectionId === entry.connectionId
    && existing.database === entry.database
    && existing.sql.trim() === entry.sql.trim()
  ))
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
