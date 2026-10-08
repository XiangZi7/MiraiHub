import type { RedisKey } from '@/types/redis'

export type RedisSearchMode = 'contains' | 'prefix' | 'glob'

/** 普通搜索按字面匹配，只有 glob 模式解释 Redis 通配符。 */
export function redisSearchPattern(query: string, mode: RedisSearchMode) {
  if (!query) return '*'
  if (mode === 'glob') return query
  const literal = query.replace(/[\\*?\[\]]/g, '\\$&')
  return mode === 'prefix' ? `${literal}*` : `*${literal}*`
}

export interface RedisKeyGroup {
  prefix: string
  keys: RedisKey[]
}

/** 只把冒号分隔的命名空间分组，URL 的协议冒号与二进制展示名不参与。 */
export function groupRedisKeys(
  keys: RedisKey[],
  depth: number
): RedisKeyGroup[] {
  const groups = new Map<string, RedisKey[]>()
  for (const key of keys) {
    let end = 0
    if (!key.name.startsWith('base64:')) {
      for (let level = 0; level < depth; level++) {
        const colon = key.name.indexOf(':', end)
        if (
          colon < 0 ||
          colon === key.name.length - 1 ||
          key.name.slice(colon, colon + 3) === '://'
        )
          break
        end = colon + 1
      }
    }
    const prefix = key.name.slice(0, end)
    const group = groups.get(prefix)
    if (group) group.push(key)
    else groups.set(prefix, [key])
  }
  return [...groups].map(([prefix, keys]) => ({ prefix, keys }))
}
