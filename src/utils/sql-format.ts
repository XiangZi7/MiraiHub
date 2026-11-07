import type { DatabaseKind } from '@/types/database'

/**
 * 按方言格式化 SQL；关键字统一大写，失败（语法无法识别）时抛出给调用方提示。
 * 格式化器首次使用时才加载，且只取项目支持的方言，避免全部方言打进首屏。
 */
export async function formatSql(
  sql: string,
  kind: DatabaseKind
): Promise<string> {
  // 解构动态导入，打包器才能摇掉未用到的方言
  const {
    formatDialect,
    mysql,
    postgresql,
    sqlite,
    sql: generic,
  } = await import('sql-formatter')
  const dialects = { mysql, postgresql, sqlite }
  return formatDialect(sql, {
    // 未知方言退回通用 SQL，与原先 language: 'sql' 一致
    dialect: dialects[kind] ?? generic,
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
