import type {
  DatabaseDataExportFormat,
  DatabaseExportData,
} from '@/types/database-export'
import { exportDataText } from './database-export-text'
import { runDatabaseWorkbook } from './database-xlsx-worker'

export { exportCsvCell, exportDataText } from './database-export-text'

export const databaseExportFormats = [
  { id: 'sql', label: 'SQL', extension: 'sql', mime: 'application/sql' },
  {
    id: 'xlsx',
    label: 'Excel',
    extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    id: 'dictionary',
    label: '数据字典',
    extension: 'html',
    mime: 'text/html;charset=utf-8',
  },
  {
    id: 'txt',
    label: 'TXT',
    extension: 'txt',
    mime: 'text/plain;charset=utf-8',
  },
  { id: 'csv', label: 'CSV', extension: 'csv', mime: 'text/csv;charset=utf-8' },
  {
    id: 'json',
    label: 'JSON',
    extension: 'json',
    mime: 'application/json;charset=utf-8',
  },
] as const

/** 为小型文件或测试生成字节；Excel 交给 Worker 编码，生产数据导出使用 Worker 分批编码与文件流写入。 */
export async function exportDataBytes(
  data: DatabaseExportData,
  format: DatabaseDataExportFormat,
  tableName = data.name
): Promise<Uint8Array> {
  if (format !== 'xlsx') {
    const text = exportDataText(data, format, tableName)
    return new TextEncoder().encode(
      format === 'csv' || format === 'txt' ? `\uFEFF${text}` : text
    )
  }
  // 只传编码需要的字段，表详情等元数据不跨线程复制。
  const reply = await runDatabaseWorkbook({
    action: 'workbook',
    data: {
      name: data.name,
      columns: data.columns.map(column => ({ name: column.name })),
      rows: data.rows.map(row => Array.from(row)),
    },
  })
  return reply.bytes!
}

/** 生成当前本地时间的默认文件名；日期和时间开关可独立选择，移除系统不允许的字符。 */
export function databaseExportFileName(
  name: string,
  extension: string,
  options: { database?: string; date?: boolean; time?: boolean },
  now = new Date()
): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const parts = [options.database, name].filter(Boolean)
  if (options.date)
    parts.push(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    )
  if (options.time)
    parts.push(
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    )
  const base =
    parts
      .join('_')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
      .trim()
      .replace(/[. ]+$/gu, '')
      .slice(0, 180) || 'result'
  return `${base}.${extension}`
}
