import type { AgentQueryResult } from '@/types/agent'

export interface DiffLine {
  kind: 'same' | 'add' | 'remove'
  text: string
  before?: number
  after?: number
}
/** Bounded LCS. Large documents use a complete replacement diff without guessing matches. */
export function configurationDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n'),
    b = after.split('\n')
  const result: DiffLine[] = []
  if ((a.length + 1) * (b.length + 1) > 400000) {
    return [
      ...a.map((text, index): DiffLine => ({
        kind: 'remove',
        text,
        before: index + 1,
      })),
      ...b.map((text, index): DiffLine => ({
        kind: 'add',
        text,
        after: index + 1,
      })),
    ]
  }
  const columns = b.length + 1
  const grid = new Uint32Array((a.length + 1) * columns)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      grid[i * columns + j] =
        a[i] === b[j]
          ? grid[(i + 1) * columns + j + 1]! + 1
          : Math.max(grid[(i + 1) * columns + j]!, grid[i * columns + j + 1]!)
  let i = 0,
    j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i]!, before: ++i, after: ++j })
    } else if (
      i < a.length &&
      (j === b.length ||
        grid[(i + 1) * columns + j]! >= grid[i * columns + j + 1]!)
    ) {
      result.push({ kind: 'remove', text: a[i]!, before: ++i })
    } else {
      result.push({ kind: 'add', text: b[j]!, after: ++j })
    }
  }
  return result
}
export function chartNumber(value: string | null | undefined): number | null {
  if (
    value == null ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  )
    return null
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER
    ? number
    : null
}
export function numericColumns(result: AgentQueryResult): number[] {
  return result.columns.flatMap((_, index) => {
    const values = result.rows
      .map(row => row[index])
      .filter(value => value != null)
    return values.length && values.every(value => chartNumber(value) !== null)
      ? [index]
      : []
  })
}
export function chartGeometry(result: AgentQueryResult, x: number, y: number) {
  const samples = result.rows.map(row => ({
    label: row[x] ?? 'NULL',
    value: chartNumber(row[y]),
  }))
  const values = samples.flatMap(sample =>
    sample.value === null ? [] : [sample.value]
  )
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values)
  const span = max - min || 1
  const coordinate = (value: number) => 178 - ((value - min) / span) * 144
  const points = samples.map((sample, index) => ({
    ...sample,
    x: 44 + (index / Math.max(1, samples.length - 1)) * 352,
    y: sample.value === null ? null : coordinate(sample.value),
  }))
  let connected = false
  const path = points
    .map(point => {
      if (point.y === null) {
        connected = false
        return ''
      }
      const part = `${connected ? 'L' : 'M'}${point.x},${point.y}`
      connected = true
      return part
    })
    .join(' ')
  return {
    points,
    path,
    min,
    max,
    baseline: coordinate(0),
    barWidth: Math.min(36, 300 / Math.max(1, points.length)),
  }
}
export function queryCsv(result: AgentQueryResult): string {
  const cell = (value: string | null) =>
    value === null ? '' : `"${value.replace(/"/g, '""')}"`
  return [result.columns, ...result.rows]
    .map(row => row.map(cell).join(','))
    .join('\r\n')
}
