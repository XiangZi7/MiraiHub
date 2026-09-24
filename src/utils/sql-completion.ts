/** 光标前的 SQL 标识符；字符串/注释里不弹出字段建议。 */
export function sqlCompletionPrefix(
  sql: string,
  cursor: number
): string | null {
  const before = sql.slice(0, cursor)
  let quote = ''
  let comment = ''
  for (let index = 0; index < before.length; index += 1) {
    const char = before[index]
    const next = before[index + 1]
    if (comment === 'line') {
      if (char === '\n') comment = ''
    } else if (comment === 'block') {
      if (char === '*' && next === '/') {
        comment = ''
        index += 1
      }
    } else if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) {
        if (next === quote) index += 1
        else quote = ''
      }
    } else if (char === '-' && next === '-') {
      comment = 'line'
      index += 1
    } else if (char === '#') comment = 'line'
    else if (char === '/' && next === '*') {
      comment = 'block'
      index += 1
    } else if (char === "'" || char === '"' || char === '`') quote = char
  }
  if (comment || quote === "'") return null
  return before.match(/[\p{L}_][\p{L}\p{N}_$]*$/u)?.[0] ?? ''
}

export function filterSqlSuggestions(
  values: readonly string[],
  prefix: string
): string[] {
  const seen = new Set<string>()
  const lower = prefix.toLocaleLowerCase()
  return values
    .filter(value => {
      const key = value.toLocaleLowerCase()
      if (seen.has(key) || key === lower || !key.startsWith(lower)) return false
      seen.add(key)
      return true
    })
    .slice(0, 30)
}
