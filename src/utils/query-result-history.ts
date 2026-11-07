import type { DatabaseExecution } from '@/types/database'

/** 查询标签里保留的一次执行结果；固定后不会被自动淘汰。 */
export interface QueryResultEntry {
  id: string
  sql: string
  executedAt: number
  execution: DatabaseExecution | null
  error: string
  pinned: boolean
  /** 行数据因内存上限被丢弃，只剩摘要 */
  evicted: boolean
}

export interface QueryResultHistoryLimits {
  /** 未固定结果最多保留几次 */
  keep: number
  /** 所有结果行数据的估算总字节上限 */
  maxBytes: number
}

export const DEFAULT_RESULT_LIMITS: QueryResultHistoryLimits = {
  keep: 5,
  maxBytes: 64 * 1024 * 1024,
}

/** 粗略估算结果集占用：字符串按 UTF-16 两字节计，每个单元格额外算对象开销。 */
export function estimateExecutionBytes(
  execution: DatabaseExecution | null
): number {
  if (!execution) return 0
  let bytes = 0
  for (const statement of execution.statements) {
    for (const row of statement.rows) {
      for (const value of row) bytes += 16 + (value?.length ?? 0) * 2
    }
  }
  return bytes
}

/** 丢掉行数据但保留语句、消息与耗时，结果标签仍能展示摘要。 */
function evict(entry: QueryResultEntry): QueryResultEntry {
  if (!entry.execution) return { ...entry, evicted: true }
  return {
    ...entry,
    evicted: true,
    execution: {
      ...entry.execution,
      statements: entry.execution.statements.map(statement => ({
        ...statement,
        rows: [],
      })),
    },
  }
}

/**
 * 追加一次结果并按上限裁剪：未固定的结果只保留最近 keep 次；
 * 总内存超限时从最老的结果开始丢弃行数据（最新一次始终保留）。
 */
export function pushQueryResult(
  history: readonly QueryResultEntry[],
  entry: QueryResultEntry,
  limits: QueryResultHistoryLimits = DEFAULT_RESULT_LIMITS
): QueryResultEntry[] {
  const next = [...history, entry]
  let unpinned = next.filter(item => !item.pinned).length
  const kept = next.filter(item => {
    if (item.pinned || item === entry || unpinned <= limits.keep) return true
    unpinned--
    return false
  })
  let total = kept.reduce(
    (sum, item) => sum + estimateExecutionBytes(item.execution),
    0
  )
  return kept.map(item => {
    if (total <= limits.maxBytes || item === entry || item.evicted) return item
    total -= estimateExecutionBytes(item.execution)
    return evict(item)
  })
}

/** 从 SQL 驱动报错里提取错误码（MySQL 数字码、SQLSTATE、SQLite 错误码）。 */
export function extractErrorCode(message: string): string {
  const patterns = [
    /\b(?:ERROR|error)\s*:?\s*(\d{4,5})\b/u,
    /\(?\b(\d{4})\s*\(([0-9A-Z]{5})\)/u,
    /SQLSTATE\[?\s*([0-9A-Z]{5})/iu,
    /\bcode:?\s*([0-9A-Z]{4,5})\b/iu,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(message)
    if (match) return match.slice(1).filter(Boolean).join(' / ')
  }
  return ''
}

/** 后端偏移量按 UTF-8 字节计，这里换算成 JS 字符串下标。 */
export function byteOffsetToIndex(text: string, byteOffset: number): number {
  const encoder = new TextEncoder()
  let bytes = 0
  let index = 0
  for (const char of text) {
    if (bytes >= byteOffset) break
    bytes += encoder.encode(char).length
    index += char.length
  }
  return index
}
