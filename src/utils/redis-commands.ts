import type { RedisKey } from '@/types/redis'

/** 与原生命令解析器一致的引号/字节转义，避免键名被拆成多个参数。 */
export function quoteRedisArgument(value: string) {
  return (
    '"' +
    value.replace(/[\\"\x00-\x1f\x7f]/g, char => {
      if (char === '\\' || char === '"') return '\\' + char
      return '\\x' + char.charCodeAt(0).toString(16).padStart(2, '0')
    }) +
    '"'
  )
}

export function quoteRedisKey(key: RedisKey) {
  const bytes = Uint8Array.from(atob(key.id), char => char.charCodeAt(0))
  try {
    return quoteRedisArgument(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    )
  } catch {
    return (
      '"' +
      [...bytes]
        .map(byte => '\\x' + byte.toString(16).padStart(2, '0'))
        .join('') +
      '"'
    )
  }
}

export const REDIS_COMMAND_GROUPS = [
  '常用查询',
  'String',
  'Hash',
  'List',
  'Set',
  'Sorted Set',
  'Stream',
  '写入与删除',
] as const
export type RedisCommandGroup = (typeof REDIS_COMMAND_GROUPS)[number]
export interface RedisCommandTemplate {
  id: string
  group: RedisCommandGroup
  label: string
  description: string
  write?: boolean
  usesKey?: boolean
  build: (key: string, pattern: string) => string
}

export const REDIS_COMMAND_TEMPLATES: RedisCommandTemplate[] = [
  {
    id: 'ping',
    group: '常用查询',
    label: '测试连接',
    description: '返回 PONG 表示连接正常。',
    build: () => 'PING',
  },
  {
    id: 'dbsize',
    group: '常用查询',
    label: '统计当前库键数',
    description: '返回当前 DB 的全部键数量，与左侧已加载数量不同。',
    build: () => 'DBSIZE',
  },
  {
    id: 'scan',
    group: '常用查询',
    label: '按模式查找键',
    description:
      '结果第一项是下一游标；替换命令中的 0 继续，返回 0 才结束。COUNT 是批量提示，可能返回空批次。',
    build: (_key, pattern) =>
      `SCAN 0 MATCH ${quoteRedisArgument(pattern)} COUNT 100`,
  },
  {
    id: 'type',
    group: '常用查询',
    label: '查看键类型',
    description:
      '先确认类型，再选择对应的读取命令；类型不匹配会返回 WRONGTYPE。',
    usesKey: true,
    build: key => `TYPE ${key}`,
  },
  {
    id: 'ttl',
    group: '常用查询',
    label: '查看过期时间',
    description: '返回剩余秒数；-1 表示永不过期，-2 表示键不存在。',
    usesKey: true,
    build: key => `TTL ${key}`,
  },
  {
    id: 'exists',
    group: '常用查询',
    label: '检查键是否存在',
    description: '返回 1 表示存在，0 表示不存在。',
    usesKey: true,
    build: key => `EXISTS ${key}`,
  },
  {
    id: 'memory',
    group: '常用查询',
    label: '查看键内存占用',
    description: '返回该键及其值占用的内存字节数（Redis 4.0+）。',
    usesKey: true,
    build: key => `MEMORY USAGE ${key}`,
  },
  {
    id: 'info',
    group: '常用查询',
    label: '查看内存概况',
    description: '查看 Redis 已用内存、峰值与内存限制。',
    build: () => 'INFO memory',
  },
  {
    id: 'get',
    group: 'String',
    label: '读取字符串',
    description: '读取 String 值；键不存在时返回 null。大值建议使用 GETRANGE。',
    usesKey: true,
    build: key => `GET ${key}`,
  },
  {
    id: 'getrange',
    group: 'String',
    label: '分段读取字符串',
    description: '读取前 1024 个字节；修改起止位置可继续读取。',
    usesKey: true,
    build: key => `GETRANGE ${key} 0 1023`,
  },
  {
    id: 'strlen',
    group: 'String',
    label: '查看字符串长度',
    description: '返回字符串的字节长度。',
    usesKey: true,
    build: key => `STRLEN ${key}`,
  },
  {
    id: 'hget',
    group: 'Hash',
    label: '读取一个字段',
    description: '将 field 替换为要读取的 Hash 字段名。',
    usesKey: true,
    build: key => `HGET ${key} "field"`,
  },
  {
    id: 'hscan',
    group: 'Hash',
    label: '分批读取字段和值',
    description: '返回下一游标与字段/值数组；替换游标可继续读取。',
    usesKey: true,
    build: key => `HSCAN ${key} 0 MATCH "*" COUNT 100`,
  },
  {
    id: 'hlen',
    group: 'Hash',
    label: '统计字段数量',
    description: '返回 Hash 中的字段数量。',
    usesKey: true,
    build: key => `HLEN ${key}`,
  },
  {
    id: 'lrange',
    group: 'List',
    label: '读取列表前 100 项',
    description:
      '下标从 0 开始，结束下标包含在结果中；改为 100 199 读取下一段。',
    usesKey: true,
    build: key => `LRANGE ${key} 0 99`,
  },
  {
    id: 'llen',
    group: 'List',
    label: '统计列表长度',
    description: '返回 List 中的元素数量。',
    usesKey: true,
    build: key => `LLEN ${key}`,
  },
  {
    id: 'sscan',
    group: 'Set',
    label: '分批读取集合',
    description: '返回下一游标和成员数组；替换游标可继续读取。',
    usesKey: true,
    build: key => `SSCAN ${key} 0 MATCH "*" COUNT 100`,
  },
  {
    id: 'scard',
    group: 'Set',
    label: '统计集合成员',
    description: '返回 Set 中不重复的成员数量。',
    usesKey: true,
    build: key => `SCARD ${key}`,
  },
  {
    id: 'sismember',
    group: 'Set',
    label: '检查集合成员',
    description: '将 member 替换为成员；返回 1 表示属于该集合。',
    usesKey: true,
    build: key => `SISMEMBER ${key} "member"`,
  },
  {
    id: 'zrange',
    group: 'Sorted Set',
    label: '读取成员及分数',
    description: '按分数升序读取前 100 项，同时返回分数。',
    usesKey: true,
    build: key => `ZRANGE ${key} 0 99 WITHSCORES`,
  },
  {
    id: 'zcard',
    group: 'Sorted Set',
    label: '统计有序集合成员',
    description: '返回 Sorted Set 中的成员数量。',
    usesKey: true,
    build: key => `ZCARD ${key}`,
  },
  {
    id: 'zscore',
    group: 'Sorted Set',
    label: '查看成员分数',
    description: '将 member 替换为要查询的成员。',
    usesKey: true,
    build: key => `ZSCORE ${key} "member"`,
  },
  {
    id: 'xrange',
    group: 'Stream',
    label: '读取流前 100 条',
    description:
      '返回消息 ID 和字段；用 (上一批最后ID 作为起点可继续（Redis 6.2+）。',
    usesKey: true,
    build: key => `XRANGE ${key} - + COUNT 100`,
  },
  {
    id: 'xlen',
    group: 'Stream',
    label: '统计流消息',
    description: '返回 Stream 中的消息数量。',
    usesKey: true,
    build: key => `XLEN ${key}`,
  },
  {
    id: 'set',
    group: '写入与删除',
    label: '创建字符串键',
    description:
      '仅在键不存在时写入 value，并在 3600 秒后过期；请先修改示例值。',
    write: true,
    usesKey: true,
    build: key => `SET ${key} "value" NX EX 3600`,
  },
  {
    id: 'hset',
    group: '写入与删除',
    label: '写入 Hash 字段',
    description: '新增或覆盖 field 字段的值，执行后立即生效。',
    write: true,
    usesKey: true,
    build: key => `HSET ${key} "field" "value"`,
  },
  {
    id: 'lpush',
    group: '写入与删除',
    label: '向列表头部添加',
    description: '将 value 添加到 List 头部；键不存在时创建列表。',
    write: true,
    usesKey: true,
    build: key => `LPUSH ${key} "value"`,
  },
  {
    id: 'sadd',
    group: '写入与删除',
    label: '添加集合成员',
    description: '将 member 添加到 Set，已有成员不会重复添加。',
    write: true,
    usesKey: true,
    build: key => `SADD ${key} "member"`,
  },
  {
    id: 'zadd',
    group: '写入与删除',
    label: '添加有序集合成员',
    description: '以分数 0 添加 member；成员已存在时更新分数。',
    write: true,
    usesKey: true,
    build: key => `ZADD ${key} 0 "member"`,
  },
  {
    id: 'xadd',
    group: '写入与删除',
    label: '追加流消息',
    description: '自动生成消息 ID，追加 field 和 value 字段。',
    write: true,
    usesKey: true,
    build: key => `XADD ${key} * "field" "value"`,
  },
  {
    id: 'expire',
    group: '写入与删除',
    label: '设置过期时间',
    description: '将键设置为 3600 秒后过期，会替换已有过期时间。',
    write: true,
    usesKey: true,
    build: key => `EXPIRE ${key} 3600`,
  },
  {
    id: 'persist',
    group: '写入与删除',
    label: '取消过期时间',
    description: '移除键的过期时间，使其持续保留。',
    write: true,
    usesKey: true,
    build: key => `PERSIST ${key}`,
  },
  {
    id: 'unlink',
    group: '写入与删除',
    label: '删除指定键',
    description: '立即删除整个键，内存异步释放；此操作无法撤销（Redis 4.0+）。',
    write: true,
    usesKey: true,
    build: key => `UNLINK ${key}`,
  },
]

// 只对明确的只读命令跳过列表刷新；未知命令仍按可能写入处理。
const READ_COMMANDS = new Set(
  'PING ECHO GET MGET GETRANGE STRLEN EXISTS TYPE TTL PTTL SCAN DBSIZE INFO HGET HMGET HGETALL HLEN HSCAN HEXISTS HKEYS HVALS LRANGE LLEN LINDEX SSCAN SCARD SISMEMBER SMISMEMBER SMEMBERS SRANDMEMBER ZRANGE ZREVRANGE ZRANGEBYSCORE ZCARD ZSCORE ZMSCORE ZRANK ZREVRANK ZCOUNT ZSCAN XRANGE XREVRANGE XLEN XPENDING'.split(
    ' '
  )
)
export function isRedisReadCommand(command: string) {
  const name = command.match(/^\s*(?:"([a-z]+)"|'([a-z]+)'|([a-z]+))(?=\s|$)/i)
  if (!name) return false
  const token = (name[1] || name[2] || name[3]).toUpperCase()
  if (token === 'MEMORY')
    return /^\s*MEMORY\s+(?:USAGE|STATS|DOCTOR|HELP)(?:\s|$)/i.test(command)
  return READ_COMMANDS.has(token)
}
