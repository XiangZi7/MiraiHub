import type {
  DatabaseColumn,
  DatabaseKind,
  DatabaseQueryColumn,
  DatabaseTableDetail,
} from './database'

export type DatabaseDataExportFormat =
  'sql' | 'xlsx' | 'dictionary' | 'txt' | 'csv' | 'json'

export interface DatabaseExportData {
  name: string
  schema?: string
  databaseKind: DatabaseKind
  columns: readonly (DatabaseQueryColumn | DatabaseColumn)[]
  rows: readonly (readonly (string | null)[])[]
  detail?: DatabaseTableDetail | null
  truncated?: boolean
}

export interface DatabaseExportLoadContext {
  signal: AbortSignal
  onProgress: (rows: number) => void
  /** 每批写完后才读取下一批，避免全部行滞留内存。 */
  onRows?: (rows: DatabaseExportData['rows']) => Promise<void>
}
export type DatabaseExportLoader = (
  context: DatabaseExportLoadContext
) => Promise<DatabaseExportData>
