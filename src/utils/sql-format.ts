import { format, type SqlLanguage } from 'sql-formatter'
import type { DatabaseKind } from '@/types/database'

const formatterLanguage: Record<DatabaseKind, SqlLanguage> = {
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlite: 'sqlite',
}

/** 按方言格式化 SQL；关键字统一大写，失败（语法无法识别）时抛出给调用方提示。 */
export function formatSql(sql: string, kind: DatabaseKind): string {
  return format(sql, {
    language: formatterLanguage[kind] ?? 'sql',
    keywordCase: 'upper',
    tabWidth: 2,
    linesBetweenQueries: 1,
  })
}

/**
 * 找出光标所在的那条语句（以不在字符串 / 注释 / 引号标识符中的分号分隔）。
 * 光标恰好落在语句之间的空白里时，取前一条非空语句。
 */
export function statementAtCursor(sql: string, cursor: number): string {
  const ranges: { from: number; to: number }[] = []
  let start = 0
  let quote = ''
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!
    const next = sql[i + 1]
    if (quote) {
      if (quote === '--' || quote === '#') {
        if (char === '\n') quote = ''
      } else if (quote === '/*') {
        if (char === '*' && next === '/') {
          quote = ''
          i++
        }
      } else if (char === '\\' && quote !== '`') i++
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '-' && next === '-') quote = '--'
    else if (char === '#') quote = '#'
    else if (char === '/' && next === '*') quote = '/*'
    else if (char === ';') {
      ranges.push({ from: start, to: i })
      start = i + 1
    }
  }
  ranges.push({ from: start, to: sql.length })
  const index = ranges.findIndex(range => cursor <= range.to + 1)
  const candidates = ranges.slice(0, (index < 0 ? ranges.length : index) + 1)
  for (const range of candidates.reverse()) {
    const text = sql.slice(range.from, range.to).trim()
    if (text) return text
  }
  return ''
}
