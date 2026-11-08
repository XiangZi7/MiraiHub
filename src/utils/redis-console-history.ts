/** Redis 控制台命令历史在本地存储中的键。 */
export const REDIS_CONSOLE_HISTORY_KEY = 'miraihub:redis-console-history'

/**
 * 判断命令文本是否包含凭据：AUTH、HELLO ... AUTH、CONFIG SET requirepass/masterauth、
 * MIGRATE ... AUTH/AUTH2、ACL SETUSER、SENTINEL 密码设置等。多行文本任一行命中即视为敏感。
 */
export function isSensitiveRedisCommand(text: string): boolean {
  return text.split('\n').some(line => {
    const upper = line.trim().toUpperCase()
    return (
      /^AUTH\b/.test(upper) ||
      /^HELLO\b.*\bAUTH\b/.test(upper) ||
      /^CONFIG\s+SET\b.*\b(REQUIREPASS|MASTERAUTH|MASTERUSER)\b/.test(upper) ||
      /^MIGRATE\b.*\bAUTH2?\b/.test(upper) ||
      /^ACL\s+SETUSER\b/.test(upper) ||
      /^SENTINEL\s+(SET\b.*\bAUTH-(PASS|USER)\b|CONFIG\s+SET\b.*\bSENTINEL-(PASS|USER)\b)/.test(
        upper
      )
    )
  })
}

/** 清掉历史列表里的敏感命令与无效条目；没有需要清理的内容时返回 null。 */
export function sanitizeRedisHistory(items: unknown): string[] | null {
  if (!Array.isArray(items)) return []
  const kept = items.filter(
    (item): item is string =>
      typeof item === 'string' && !isSensitiveRedisCommand(item)
  )
  return kept.length === items.length ? null : kept
}

/** 启动时清理旧版本已写入本地存储的含凭据命令；存储不可用或内容损坏时直接移除该键。 */
export function purgeSensitiveRedisHistory(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage
): void {
  try {
    const raw = storage.getItem(REDIS_CONSOLE_HISTORY_KEY)
    if (raw === null) return
    const next = sanitizeRedisHistory(JSON.parse(raw))
    if (next) storage.setItem(REDIS_CONSOLE_HISTORY_KEY, JSON.stringify(next))
  } catch {
    try {
      storage.removeItem(REDIS_CONSOLE_HISTORY_KEY)
    } catch {
      // 本地存储不可用时无需处理。
    }
  }
}
