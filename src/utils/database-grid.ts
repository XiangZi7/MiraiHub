import type { DatabaseExportData } from '@/types/database-export'
import {
  exportDataText,
  exportSqlLiteral,
  exportSqlQuote,
} from './database-export-text'

/** 单元格选区，行列都是闭区间。 */
export interface GridRange {
  top: number
  bottom: number
  left: number
  right: number
}

export type GridCopyFormat =
  | 'insert'
  | 'update'
  | 'json'
  | 'markdown'
  | 'tsv'
  | 'csv'
  | 'in'

const NUMERIC_TYPE =
  /^(?:unsigned\s+)?(?:tinyint|smallint|mediumint|bigint|int\d*|integer|serial|bigserial|smallserial|decimal|numeric|float\d*|double(?:\s+precision)?|real|money)\b/iu
const BINARY_TYPE = /(binary|blob|bytea|^bit)/iu
const NUMERIC_VALUE = /^-?\d+(?:\.\d+)?$/u

export function isNumericType(dataType = ''): boolean {
  return NUMERIC_TYPE.test(dataType.trim())
}

/** 后端把二进制列编码成 `base64:` 前缀的文本，这里同时看列类型，避免误判普通字符串。 */
export function isBinaryValue(
  value: string | null,
  dataType = ''
): value is string {
  return Boolean(value?.startsWith('base64:')) && BINARY_TYPE.test(dataType)
}

export function decodeBinaryValue(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value.slice(7)), char => char.charCodeAt(0))
  } catch {
    return null
  }
}

/** 粘贴到 Excel 时能还原的 TSV 单元格：NULL 为空，含分隔符的值加引号。 */
function tsvCell(value: string | null): string {
  if (value === null) return ''
  return /[\t\r\n"]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function gridTsv(rows: ReadonlyArray<ReadonlyArray<string | null>>): string {
  // 单个单元格直接复制原值，不做表格转义
  if (rows.length === 1 && rows[0]?.length === 1) return rows[0][0] ?? ''
  return rows.map(row => row.map(tsvCell).join('\t')).join('\r\n')
}

function markdownCell(value: string | null): string {
  if (value === null) return 'NULL'
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/\r?\n/gu, '<br>')
}

/** 数值列的合法数字直接写出，比十六进制表达式更易读，也能走索引。 */
function gridLiteral(
  data: DatabaseExportData,
  value: string | null,
  dataType: string
): string {
  if (value !== null && isNumericType(dataType) && NUMERIC_VALUE.test(value))
    return value
  return exportSqlLiteral(data.databaseKind, value, dataType)
}

function updateStatements(data: DatabaseExportData, keys: readonly string[]): string {
  const quote = (name: string): string => exportSqlQuote(data.databaseKind, name)
  const target = [data.schema, data.name]
    .filter((part): part is string => Boolean(part))
    .map(quote)
    .join('.')
  const columns = data.columns.map((column, index) => ({
    name: column.name,
    dataType: column.dataType,
    index,
  }))
  // 没有主键（如查询结果）时用整行做条件，至少不会更新到无关的行
  const keyColumns = keys.length
    ? columns.filter(column => keys.includes(column.name))
    : columns
  const setColumns = keys.length
    ? columns.filter(column => !keys.includes(column.name))
    : columns
  return data.rows
    .map(row => {
      const assignments = setColumns.map(
        column =>
          `${quote(column.name)} = ${gridLiteral(data, row[column.index] ?? null, column.dataType)}`
      )
      const conditions = keyColumns.map(column => {
        const value = row[column.index] ?? null
        return value === null
          ? `${quote(column.name)} IS NULL`
          : `${quote(column.name)} = ${gridLiteral(data, value, column.dataType)}`
      })
      return `UPDATE ${target} SET ${assignments.join(', ')} WHERE ${conditions.join(' AND ')};`
    })
    .join('\n')
}

function markdownTable(data: DatabaseExportData): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  return [
    line(data.columns.map(column => markdownCell(column.name))),
    line(
      data.columns.map(column =>
        isNumericType(column.dataType) ? '---:' : '---'
      )
    ),
    ...data.rows.map(row =>
      line(data.columns.map((_, index) => markdownCell(row[index] ?? null)))
    ),
  ].join('\n')
}

/** 选区内所有非空值去重后组成 IN 列表。 */
function inList(data: DatabaseExportData): string {
  const items = new Set<string>()
  for (const row of data.rows)
    data.columns.forEach((column, index) => {
      const value = row[index] ?? null
      if (value !== null) items.add(gridLiteral(data, value, column.dataType))
    })
  return `(${[...items].join(', ')})`
}

/**
 * 把选区编码成指定格式。INSERT / UPDATE 总是取整行；其他格式在只选一个单元格或
 * 选满整行时取整行，框选部分列时只取这些列。
 */
export function formatGridSelection(
  format: GridCopyFormat,
  base: DatabaseExportData,
  range: GridRange,
  valueAt: (row: number, column: number) => string | null,
  keys: readonly string[] = []
): string {
  const single = range.top === range.bottom && range.left === range.right
  const wholeRows =
    format === 'insert' ||
    format === 'update' ||
    (format !== 'in' && single) ||
    (range.left === 0 && range.right === base.columns.length - 1)
  const left = wholeRows ? 0 : range.left
  const right = wholeRows ? base.columns.length - 1 : range.right
  const rows: Array<Array<string | null>> = []
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: Array<string | null> = []
    for (let column = left; column <= right; column += 1)
      cells.push(valueAt(row, column))
    rows.push(cells)
  }
  const data = {
    ...base,
    columns: base.columns.slice(left, right + 1),
    rows,
  } as DatabaseExportData
  switch (format) {
    case 'insert':
      return exportDataText(data, 'sql', data.name, false).trimEnd()
    case 'update':
      return updateStatements(data, keys)
    case 'json':
      return exportDataText(data, 'json')
    case 'csv':
      return exportDataText(data, 'csv')
    case 'markdown':
      return markdownTable(data)
    case 'in':
      return inList(data)
    default:
      return [data.columns.map(column => tsvCell(column.name)).join('\t'), ...rows.map(row => row.map(tsvCell).join('\t'))].join('\r\n')
  }
}
