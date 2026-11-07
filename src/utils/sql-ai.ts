import type { DatabaseStatementResult } from '@/types/database'

export interface SqlDiffLine {
  kind: 'same' | 'add' | 'remove'
  text: string
}

export interface SqlAiChartSpec {
  type: 'bar' | 'line'
  x: string
  y: string[]
  title: string
}

const SAMPLE_ROWS = 50
const SAMPLE_COLUMNS = 40
const SAMPLE_VALUE_CHARS = 120

/** 取模型回复里的第一个 sql 代码块；没有代码块时把全文视为 SQL。 */
export function extractSqlBlock(text: string): string {
  const block = /```(?:sql)?[ \t]*\r?\n([\s\S]*?)```/iu.exec(text)
  if (block) return block[1]!.trim()
  // 流式未闭合或模型省略围栏时去掉残留的开头标记。
  return text.replace(/^```\w*\s*/u, '').trim()
}

/** 只在回复确实含 sql 代码块时返回内容，供“优化”判断能否提供 diff。 */
export function findSqlBlock(text: string): string {
  return /```sql[ \t]*\r?\n([\s\S]*?)```/iu.exec(text)?.[1]?.trim() ?? ''
}

/** 清理内联补全回复：去围栏，并去掉模型重复的光标所在行前缀。 */
export function cleanInlineCompletion(text: string, before: string): string {
  let value = text
    .replace(/^```\w*\r?\n?/u, '')
    .replace(/\r?\n?```\s*$/u, '')
    .replace(/\s+$/u, '')
  const line = before.slice(before.lastIndexOf('\n') + 1)
  if (line.trim() && value.startsWith(line)) value = value.slice(line.length)
  return value
}

/** 按行 LCS 计算 diff，用于预览 AI 改动；过大的输入退化为整段替换。 */
export function diffSqlLines(before: string, after: string): SqlDiffLine[] {
  const a = before ? before.split(/\r?\n/u) : []
  const b = after ? after.split(/\r?\n/u) : []
  if (a.length * b.length > 1_000_000)
    return [
      ...a.map(text => ({ kind: 'remove' as const, text })),
      ...b.map(text => ({ kind: 'add' as const, text })),
    ]
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1)
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  const lines: SqlDiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (
      j >= b.length ||
      (i < a.length && table[i + 1]![j]! >= table[i]![j + 1]!)
    )
      lines.push({ kind: 'remove', text: a[i++]! })
    else lines.push({ kind: 'add', text: b[j++]! })
  }
  return lines
}

/**
 * 预览阶段的危险语句提示；只负责提醒，只读拦截和生产确认仍由执行入口的守卫完成。
 */
export function sqlDangerReason(sql: string): string {
  const text = sql
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/'(?:[^']|'')*'/gu, "''")
  for (const statement of text.split(';')) {
    const words = statement.trim().toUpperCase()
    if (/^DROP\b/u.test(words)) return 'DROP'
    if (/^TRUNCATE\b/u.test(words)) return 'TRUNCATE'
    if (/^ALTER\b/u.test(words)) return 'ALTER'
    if (/^(DELETE|UPDATE)\b/u.test(words) && !/\bWHERE\b/u.test(words))
      return `${words.split(/\s+/u)[0]} (no WHERE)`
  }
  return ''
}

/** 解析回答末尾的 chart 代码块；列名必须真实存在，否则视为无图表。 */
export function parseChartSpec(
  text: string,
  columns: readonly string[]
): SqlAiChartSpec | null {
  const block = /```chart[ \t]*\r?\n([\s\S]*?)```/iu.exec(text)?.[1]
  if (!block) return null
  try {
    const spec = JSON.parse(block) as Partial<SqlAiChartSpec>
    const y = Array.isArray(spec.y)
      ? spec.y.filter(name => columns.includes(name)).slice(0, 4)
      : []
    if (
      (spec.type !== 'bar' && spec.type !== 'line') ||
      !columns.includes(spec.x ?? '') ||
      !y.length
    )
      return null
    return {
      type: spec.type,
      x: spec.x!,
      y,
      title: typeof spec.title === 'string' ? spec.title : '',
    }
  } catch {
    return null
  }
}

/** 从展示给用户的回答里去掉 chart 代码块（含流式中未闭合的部分）。 */
export function stripChartBlock(text: string): string {
  return text.replace(/```chart[\s\S]*?(?:```|$)/iu, '').trim()
}

/** 组装结果集问答的上下文：列信息、前若干行抽样和已加载行的逐列统计。 */
export function summarizeResult(statement: DatabaseStatementResult): string {
  const columns = statement.columns.slice(0, SAMPLE_COLUMNS)
  const stats = columns.map((column, index) => {
    const present: string[] = []
    for (const row of statement.rows) {
      const value = row[index]
      if (value !== null && value !== undefined) present.push(value)
    }
    let min = Infinity
    let max = -Infinity
    let sum = 0
    let numeric = present.length > 0
    for (const value of present) {
      const n = Number(value)
      if (!value.trim() || !Number.isFinite(n)) {
        numeric = false
        break
      }
      min = Math.min(min, n)
      max = Math.max(max, n)
      sum += n
    }
    return {
      name: column.name,
      type: column.dataType,
      nulls: statement.rows.length - present.length,
      distinct: new Set(present).size,
      ...(numeric ? { min, max, avg: sum / present.length } : {}),
    }
  })
  return JSON.stringify({
    loadedRows: statement.rows.length,
    truncated: statement.truncated,
    columns: stats,
    sample: statement.rows
      .slice(0, SAMPLE_ROWS)
      .map(row =>
        row
          .slice(0, SAMPLE_COLUMNS)
          .map(value => value?.slice(0, SAMPLE_VALUE_CHARS) ?? null)
      ),
  })
}
