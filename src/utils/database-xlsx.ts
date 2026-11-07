import type ExcelJS from 'exceljs'
import type { DatabaseExportData } from '@/types/database-export'
import type {
  DatabaseImportSource,
  DatabaseImportTarget,
} from '@/types/database-import'

// 数据库 Excel 读写的全部 ExcelJS 逻辑；只由 Worker 和 Node 测试直接引用，主线程经 Worker 转发。

const metadataSheet = '__miraihub_template'

/** 按需加载工作簿库，Worker 处理文本格式时不承担 Excel 编码器体积。 */
async function loadExcel(): Promise<typeof ExcelJS> {
  return (await import('exceljs')).default
}

/** 解析 Excel 的实际单元格值；不执行公式，无缓存结果的公式和失去精度的整数直接报告位置。 */
export async function parseImportWorkbook(
  bytes: Uint8Array
): Promise<DatabaseImportSource[]> {
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error('Excel 文件超过 16 MB，请拆分后导入')
  const workbook = new (await loadExcel()).Workbook()
  // exceljs 的类型要求 Buffer，运行时接受任意 Uint8Array。
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer)
  const hints = new Map<string, { schema: string; name: string }>()
  workbook.getWorksheet(metadataSheet)?.eachRow((row, index) => {
    if (index > 1)
      hints.set(String(row.getCell(1).value), {
        schema: String(row.getCell(2).value ?? ''),
        name: String(row.getCell(3).value ?? ''),
      })
  })
  const sources: DatabaseImportSource[] = []
  let totalCells = 0
  for (const sheet of workbook.worksheets) {
    if (
      sheet.name === metadataSheet ||
      sheet.name === '导入说明' ||
      sheet.state !== 'visible'
    )
      continue
    totalCells += sheet.rowCount * sheet.columnCount
    if (totalCells > 200_000)
      throw new Error(`${sheet.name} 超过 20 万单元格，请拆分工作簿后导入`)
    const header = sheet.getRow(1)
    const width = Math.max(header.cellCount, sheet.columnCount)
    const columns = Array.from({ length: width }, (_, index) =>
      header.getCell(index + 1).text.trim()
    )
    while (columns.length && !columns.at(-1)) columns.pop()
    if (!columns.length) continue
    if (
      columns.some(name => !name) ||
      new Set(columns.map(name => name.toLocaleLowerCase())).size !==
        columns.length
    )
      throw new Error(`${sheet.name}：第一行字段名不能为空或重复`)
    const rows: DatabaseImportSource['rows'] = []
    for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
      const row = sheet.getRow(rowIndex)
      if (
        row.cellCount > columns.length &&
        Array.from(
          { length: row.cellCount - columns.length },
          (_, index) => row.getCell(columns.length + index + 1).value
        ).some(value => value !== null)
      )
        throw new Error(`${sheet.name} 第 ${rowIndex} 行包含没有字段名的数据列`)
      const values = columns.map((_, index): string | null => {
        const cell = row.getCell(index + 1)
        let value = cell.value
        if (
          value &&
          typeof value === 'object' &&
          ('formula' in value || 'sharedFormula' in value)
        ) {
          if (value.result === undefined)
            throw new Error(
              `${sheet.name}!${cell.address}：公式没有缓存结果，请先粘贴为值`
            )
          value = value.result
        }
        if (value === null || value === undefined) return ''
        if (value === '\\N') return null
        if (value instanceof Date)
          return value.toISOString().slice(0, 23).replace('T', ' ')
        if (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          !Number.isSafeInteger(value)
        )
          throw new Error(
            `${sheet.name}!${cell.address}：长整数已失去精度，请将该列设置为文本后重新填写`
          )
        if (typeof value === 'object') {
          if ('richText' in value)
            return value.richText.map(part => part.text).join('')
          if ('text' in value) return value.text
          throw new Error(
            `${sheet.name}!${cell.address}：不支持错误或复杂单元格，请转换为普通值`
          )
        }
        return String(value)
      })
      if (values.some(value => value !== '')) rows.push(values)
    }
    if (!rows.length) continue
    const hint = hints.get(sheet.name)
    sources.push({
      id: sheet.name,
      name: hint?.name || sheet.name,
      schema: hint?.schema || '',
      columns,
      rows,
    })
  }
  if (!sources.length)
    throw new Error(
      '工作簿没有可导入的数据，请保留第一行字段名并从第二行填写数据'
    )
  return sources
}

/** 按真实表结构生成空白模板，字段备注写入批注；隐藏元数据保留超过 31 字符的真实表名。 */
export async function createImportTemplate(
  targets: readonly DatabaseImportTarget[]
): Promise<Uint8Array<ArrayBuffer>> {
  if (!targets.length) throw new Error('当前数据库没有可生成模板的表')
  const workbook = new (await loadExcel()).Workbook()
  const instructions = workbook.addWorksheet('导入说明')
  instructions.getColumn(1).width = 105
  for (const line of [
    '每张工作表对应一张目标表；第一行为字段名，从第二行填写数据。',
    '长整数、编号和前导零请保持文本格式；不要修改字段名。',
    '空自增或有默认值的字段使用数据库默认值；其他空单元格按 NULL 导入。',
    '文本 NULL 不会变成空值；填写 \\N 可以显式表示 SQL NULL。',
    '模板没有示例数据。上传后先核对表和字段映射，确认后才追加写入。',
  ])
    instructions.addRow([line])
  const metadata = workbook.addWorksheet(metadataSheet, { state: 'veryHidden' })
  metadata.addRow(['sheet', 'schema', 'table'])
  const used = new Set([metadataSheet.toLocaleLowerCase(), '导入说明'])
  for (const target of targets) {
    const base =
      target.name
        .replace(/[\\/*?:[\]]/gu, '_')
        .replace(/^'+|'+$/gu, '')
        .slice(0, 31) || 'Table'
    let name = base,
      suffix = 1
    while (used.has(name.toLocaleLowerCase())) {
      const ending = `_${++suffix}`
      name = base.slice(0, 31 - ending.length) + ending
    }
    used.add(name.toLocaleLowerCase())
    metadata.addRow([name, target.schema, target.name])
    const sheet = workbook.addWorksheet(name)
    sheet.addRow(target.columns.map(column => column.name))
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    target.columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = 24
      sheet.getColumn(index + 1).numFmt = '@'
      sheet.getCell(1, index + 1).note =
        `类型：${column.dataType}\n${column.autoIncrement ? '自增，可留空' : !column.nullable && column.defaultValue === null ? '必填' : '可留空'}\n${column.comment || ''}`
    })
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** Excel 编码只需要表名、字段名和行数据，跨线程时不携带表详情等额外字段。 */
export type DatabaseWorkbookData = Pick<DatabaseExportData, 'name' | 'rows'> & {
  columns: readonly { name: string }[]
}

/** 创建只含表头的导出工作表；Worker 分批追加行，一次性导出也复用同一格式。 */
export async function createExportWorkbook(
  source: DatabaseWorkbookData
): Promise<{ workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet }> {
  const workbook = new (await loadExcel()).Workbook()
  const sheet = workbook.addWorksheet(
    source.name
      .replace(/[\\/*?:[\]]/gu, '_')
      .replace(/^'+|'+$/gu, '')
      .slice(0, 31) || 'Result'
  )
  sheet.addRow(source.columns.map(column => column.name))
  // 数据以文本写入，保留 BIGINT、前导零和公式样式字符串的原值。
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.columns.forEach(column => {
    column.width = 24
  })
  return { workbook, sheet }
}

/** 一次性把小型结果编码为 Excel；超出工作表行列上限时提示改用文本格式。 */
export async function exportWorkbookBytes(
  data: DatabaseWorkbookData
): Promise<Uint8Array<ArrayBuffer>> {
  if (data.rows.length >= 1_048_576 || data.columns.length > 16_384)
    throw new Error('数据超出 Excel 工作表的行列上限，请使用 CSV 或 SQL 导出')
  const { workbook, sheet } = await createExportWorkbook(data)
  for (const row of data.rows)
    sheet.addRow(data.columns.map((_, index) => row[index] ?? null))
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
