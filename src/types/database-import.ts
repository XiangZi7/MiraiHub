import type { DatabaseColumn, CellValue } from './database'

/** 导入时可写入的目标表；计算列由后端排除。 */
export interface DatabaseImportTarget {
  schema: string
  name: string
  columns: DatabaseColumn[]
}

/** SQL 表或 Excel 工作表的统一预览信息。 */
export interface DatabaseImportSource {
  id: string
  name: string
  schema: string
  columns: string[]
  rows: Array<Array<string | null>>
  statementCount?: number
  columnCount?: number
}

export interface DatabaseImportMapping {
  sourceId: string
  targetSchema: string
  targetTable: string
  columns: Record<string, string>
}

export interface DatabaseSqlImportPreview {
  sources: DatabaseImportSource[]
  skippedStatements: number
}

export interface DatabaseImportRowsTable {
  schema: string
  table: string
  rows: CellValue[][]
}
