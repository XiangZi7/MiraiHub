import type {
  DatabaseExportData,
  DatabaseDataExportFormat,
} from '@/types/database-export'
import { exportDataText } from '@/utils/database-export'
import type ExcelJS from 'exceljs'

let source: DatabaseExportData
let format: DatabaseDataExportFormat
let tableName = ''
let rowCount = 0
let textBytes = 0
let workbook: ExcelJS.Workbook | undefined
let sheet: ExcelJS.Worksheet | undefined
let keys: string[] = []
const encoder = new TextEncoder()

/** 每个任务独占 Worker；分批接收数据，文本格式立即归还字节，Excel 编码也不占用界面线程。 */
self.onmessage = async (event: MessageEvent) => {
  const { id, action } = event.data
  try {
    let bytes = new Uint8Array()
    if (action === 'start') {
      source = event.data.source
      format = event.data.format
      tableName = event.data.tableName
      rowCount = 0
      textBytes = 0
      workbook = undefined
      sheet = undefined
      keys = []
      if (format === 'xlsx') {
        const { default: ExcelJS } = await import('exceljs')
        workbook = new ExcelJS.Workbook()
        sheet = workbook.addWorksheet(
          source.name
            .replace(/[\\/*?:[\]]/gu, '_')
            .replace(/^'+|'+$/gu, '')
            .slice(0, 31) || 'Result'
        )
        sheet.addRow(source.columns.map(column => column.name))
        sheet.getRow(1).font = { bold: true }
        sheet.views = [{ state: 'frozen', ySplit: 1 }]
        sheet.columns.forEach(column => {
          column.width = 24
        })
      } else if (format === 'dictionary')
        bytes = encoder.encode(exportDataText(source, format, tableName))
      else if (format === 'json') {
        const used = new Set<string>()
        keys = source.columns.map(column => {
          let name = column.name,
            suffix = 2
          while (used.has(name)) name = `${column.name}_${suffix++}`
          used.add(name)
          return name
        })
        bytes = encoder.encode('[\n')
      } else {
        const header =
          format === 'sql'
            ? `-- MiraiHub data export\n`
            : exportDataText({ ...source, rows: [] }, format, tableName)
        bytes = encoder.encode(
          (format === 'csv' || format === 'txt' ? '\uFEFF' : '') + header
        )
      }
    } else if (action === 'rows') {
      const rows = event.data.rows as DatabaseExportData['rows']
      if (format === 'xlsx') {
        const cells = (rowCount + rows.length + 1) * source.columns.length
        // ExcelJS 的浏览器编码需要驻留工作簿；主动限制体积，防止后台任务耗尽整机内存。
        for (const row of rows)
          for (const value of row)
            textBytes += value ? encoder.encode(value).length : 0
        if (cells > 200_000 || textBytes > 16 * 1024 * 1024)
          throw new Error(
            'Excel 数据超过安全容量（20 万单元格或 16 MB 文本），请选择 CSV、TXT、JSON 或 SQL 分批导出'
          )
        for (const row of rows)
          sheet!.addRow(source.columns.map((_, index) => row[index] ?? null))
      } else if (format === 'json') {
        const lines = rows.map(row =>
          JSON.stringify(
            Object.fromEntries(
              keys.map((key, index) => [key, row[index] ?? null])
            )
          )
        )
        bytes = encoder.encode(
          (rowCount && rows.length ? ',\n' : '') + lines.join(',\n')
        )
      } else if (format !== 'dictionary') {
        const body = exportDataText(
          { ...source, rows },
          format,
          tableName,
          false
        )
        bytes = encoder.encode(
          (format !== 'sql' && rows.length ? '\r\n' : '') +
            (rows.length ? body : '')
        )
      }
      rowCount += rows.length
    } else if (action === 'finish') {
      if (format === 'xlsx')
        bytes = new Uint8Array(await workbook!.xlsx.writeBuffer())
      else if (format === 'json') bytes = encoder.encode('\n]\n')
    }
    self.postMessage({ id, bytes, rowCount }, { transfer: [bytes.buffer] })
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
