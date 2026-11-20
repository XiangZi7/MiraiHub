import type { DatabaseQueryColumn } from '@/types/database'

/** 隐藏括号中的类型参数，保留 unsigned、时区、数组后缀及带引号的类型名。 */
function withoutTypeParameters(dataType: string): string {
  let label = ''
  let depth = 0
  let quote = ''
  for (let index = 0; index < dataType.length; index++) {
    const char = dataType[index]!
    if (quote) {
      if (!depth) label += char
      if (char === '\\' && index + 1 < dataType.length) {
        index += 1
        if (!depth) label += dataType[index]
      } else if (char === quote) {
        if (dataType[index + 1] === quote) {
          index += 1
          if (!depth) label += dataType[index]
        } else quote = ''
      }
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char
      if (!depth) label += char
    } else if (char === '(') {
      if (!depth) label = label.trimEnd()
      depth += 1
    } else if (char === ')' && depth) {
      depth -= 1
    } else if (!depth) label += char
  }
  // 不完整的类型声明原样保留，不猜测缺失的参数或类型名。
  return depth || quote ? dataType : label.trim()
}

/**
 * 表头优先显示已读取的结构类型；驱动常只返回 VARCHAR / NUMERIC 等基础名。
 * 仅按同名列补齐现有元数据，不查询或扫描行值，也不改动网格原始列信息。
 */
export function databaseColumnTypeLabels(
  columns: readonly DatabaseQueryColumn[],
  showParameters: boolean,
  schemaColumns: readonly DatabaseQueryColumn[] = []
): string[] {
  const schemaTypes = new Map(
    schemaColumns.map(column => [column.name, column.dataType.trim()])
  )
  return columns.map(column => {
    const dataType = schemaTypes.get(column.name) || column.dataType.trim()
    return showParameters ? dataType : withoutTypeParameters(dataType)
  })
}
