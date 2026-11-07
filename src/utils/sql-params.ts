import type { DatabaseKind } from '@/types/database'

/** SQL 中识别到的一个占位符出现位置。 */
export interface SqlParamOccurrence {
  /** 归一化后的参数键：命名参数为名字，`?` 为 `?1`…，`$1` 为 `$1` */
  key: string
  from: number
  to: number
}

export interface SqlParamScan {
  /** 去重后的参数键，按首次出现顺序 */
  keys: string[]
  occurrences: SqlParamOccurrence[]
}

const identStart = /[\p{L}_]/u
const identPart = /[\p{L}\p{N}_$]/u

/**
 * 扫描 SQL 里的 `:name` / `?` / `$1` 占位符，跳过字符串、引号标识符、注释和
 * PostgreSQL 的 `$tag$` 字符串。`::type` 类型转换和 MySQL 的 `:=` 赋值不算参数；
 * PostgreSQL 中 `?` 是 jsonb 运算符，也不识别为参数。
 */
export function scanSqlParams(sql: string, kind: DatabaseKind): SqlParamScan {
  const occurrences: SqlParamOccurrence[] = []
  let positional = 0
  let index = 0
  const length = sql.length
  while (index < length) {
    const char = sql[index]!
    const next = sql[index + 1]
    // 注释
    if (
      (char === '-' && next === '-') ||
      (char === '#' && kind === 'mysql')
    ) {
      const end = sql.indexOf('\n', index)
      index = end < 0 ? length : end + 1
      continue
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2)
      index = end < 0 ? length : end + 2
      continue
    }
    // 字符串与引号标识符：成对引号视为转义，MySQL 字符串另支持反斜杠转义
    if (char === "'" || char === '"' || char === '`') {
      index++
      while (index < length) {
        const current = sql[index]!
        if (current === '\\' && kind === 'mysql' && char !== '`') {
          index += 2
          continue
        }
        if (current === char) {
          if (sql[index + 1] === char) {
            index += 2
            continue
          }
          break
        }
        index++
      }
      index++
      continue
    }
    if (char === '$') {
      // PostgreSQL 美元引号字符串 $tag$ ... $tag$
      const tag =
        kind === 'postgresql'
          ? sql.slice(index).match(/^\$([\p{L}_][\p{L}\p{N}_]*)?\$/u)?.[0]
          : undefined
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length)
        index = end < 0 ? length : end + tag.length
        continue
      }
      const digits = sql.slice(index + 1).match(/^\d+/u)?.[0]
      const before = sql[index - 1]
      if (
        digits &&
        kind !== 'mysql' &&
        !(before && identPart.test(before))
      ) {
        const to = index + 1 + digits.length
        occurrences.push({ key: `$${Number(digits)}`, from: index, to })
        index = to
        continue
      }
    }
    if (char === '?' && kind !== 'postgresql') {
      occurrences.push({ key: `?${++positional}`, from: index, to: index + 1 })
      index++
      continue
    }
    if (
      char === ':' &&
      next &&
      identStart.test(next) &&
      sql[index - 1] !== ':' &&
      !(sql[index - 1] && identPart.test(sql[index - 1]!))
    ) {
      let to = index + 2
      while (to < length && identPart.test(sql[to]!)) to++
      occurrences.push({ key: sql.slice(index + 1, to), from: index, to })
      index = to
      continue
    }
    index++
  }
  const keys = [...new Set(occurrences.map(item => item.key))]
  return { keys, occurrences }
}

/** 参数在面板里展示的名字。 */
export function sqlParamLabel(key: string): string {
  if (key.startsWith('?') || key.startsWith('$')) return key
  return `:${key}`
}

/**
 * 把占位符改写成方言原生写法并按顺序给出绑定值：MySQL / SQLite 每处出现都写成
 * `?` 并重复绑定；PostgreSQL 同名参数共用一个 `$n`。值为 null 时绑定 SQL NULL。
 */
export function bindSqlParams(
  sql: string,
  kind: DatabaseKind,
  scan: SqlParamScan,
  values: Readonly<Record<string, string | null>>
): { sql: string; params: (string | null)[] } {
  const params: (string | null)[] = []
  const indexes = new Map<string, number>()
  let output = ''
  let cursor = 0
  for (const occurrence of scan.occurrences) {
    output += sql.slice(cursor, occurrence.from)
    const value = values[occurrence.key] ?? null
    if (kind === 'postgresql') {
      let position = indexes.get(occurrence.key)
      if (position === undefined) {
        params.push(value)
        position = params.length
        indexes.set(occurrence.key, position)
      }
      output += `$${position}`
    } else {
      params.push(value)
      output += '?'
    }
    cursor = occurrence.to
  }
  output += sql.slice(cursor)
  return { sql: output, params }
}

const STORAGE_KEY = 'miraihub.database.sql-params'
const MAX_REMEMBERED = 200

export interface RememberedSqlParam {
  value: string
  isNull: boolean
}

function readRemembered(): Record<string, RememberedSqlParam> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 读取上次为这些参数填过的值；位置参数按连接区分意义不大，同样按键记忆。 */
export function rememberedSqlParams(
  scope: string,
  keys: readonly string[]
): Record<string, RememberedSqlParam> {
  const stored = readRemembered()
  const result: Record<string, RememberedSqlParam> = {}
  for (const key of keys) {
    const value = stored[`${scope}\u0000${key}`] ?? stored[`*\u0000${key}`]
    if (value) result[key] = value
  }
  return result
}

/** 记住本次填写的值；同时写一份不分连接的兜底值，换连接时也能预填。 */
export function rememberSqlParams(
  scope: string,
  values: Readonly<Record<string, RememberedSqlParam>>
): void {
  const stored = readRemembered()
  for (const [key, value] of Object.entries(values)) {
    for (const name of [`${scope}\u0000${key}`, `*\u0000${key}`]) {
      delete stored[name]
      stored[name] = value
    }
  }
  // 对象键保持插入顺序，超出上限时丢掉最早写入的
  const entries = Object.entries(stored)
  const trimmed = Object.fromEntries(entries.slice(-MAX_REMEMBERED))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // 存储不可用时只是不记忆，不影响执行。
  }
}
