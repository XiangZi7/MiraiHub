import type { CellValue } from '@/types/database'
import type {
  DatabaseImportSource,
  DatabaseImportTarget,
  DatabaseImportRowsTable,
} from '@/types/database-import'

const metadataSheet = '__miraihub_template'

/** 表名用库名隔离，同一数据库内大小写不同的字段只在唯一匹配时自动映射。 */
export function importTargetKey(
  target: Pick<DatabaseImportTarget, 'schema' | 'name'>
): string {
  return `${target.schema}\u0000${target.name}`
}

/** 优先按字段原名匹配，其次使用唯一的大小写匹配或完整字段备注，不做猜测式模糊匹配。 */
export function matchImportColumns(
  source: DatabaseImportSource,
  target: DatabaseImportTarget
): string[] {
  return source.columns.map(name => {
    const exact = target.columns.find(column => column.name === name)
    if (exact) return exact.name
    const normalized = name.trim().toLocaleLowerCase()
    const candidates = target.columns.filter(
      column =>
        column.name.toLocaleLowerCase() === normalized ||
        column.comment?.trim().toLocaleLowerCase() === normalized
    )
    return candidates.length === 1 ? candidates[0]!.name : ''
  })
}

/** 校验映射覆盖了必要字段且没有重复目标列；模糊或不完整映射必须由用户修正。 */
export function importMappingError(
  source: DatabaseImportSource,
  target: DatabaseImportTarget | undefined,
  columns: readonly string[]
): string {
  if (!target) return '请选择目标表'
  const mapped = columns.filter(Boolean)
  if (!source.columns.length) {
    return source.columnCount === target.columns.length
      ? ''
      : '无字段名的 SQL 必须与目标表字段数量及顺序一致'
  }
  if (!mapped.length) return '至少需要映射一个字段'
  if (new Set(mapped).size !== mapped.length)
    return '多个源字段不能映射到同一目标字段'
  if (mapped.some(name => !target.columns.some(column => column.name === name)))
    return '映射包含不存在的目标字段'
  const required = target.columns.filter(
    column =>
      !column.nullable && column.defaultValue === null && !column.autoIncrement
  )
  const missing = required
    .filter(column => !mapped.includes(column.name))
    .map(column => column.name)
  return missing.length ? `缺少必填字段：${missing.join('、')}` : ''
}

/** 同名表优先；无同名表时，仅当字段完整兼容的候选唯一才自动选中，重名时要求手动选择。 */
export function matchImportTarget(
  source: DatabaseImportSource,
  targets: readonly DatabaseImportTarget[]
): DatabaseImportTarget | undefined {
  const exact = targets.filter(
    target =>
      target.name === source.name &&
      (!source.schema || target.schema === source.schema)
  )
  if (exact.length === 1) return exact[0]
  const named = targets.filter(
    target =>
      target.name.toLocaleLowerCase() === source.name.toLocaleLowerCase()
  )
  if (named.length === 1) return named[0]
  if (exact.length > 1 || named.length > 1 || !source.columns.length)
    return undefined
  const compatible = targets.filter(target => {
    const columns = matchImportColumns(source, target)
    return (
      columns.every(Boolean) && !importMappingError(source, target, columns)
    )
  })
  return compatible.length === 1 ? compatible[0] : undefined
}

/** 解析 Excel 的实际单元格值；不执行公式，无缓存结果的公式和失去精度的整数直接报告位置。 */
export async function parseImportWorkbook(
  bytes: Uint8Array
): Promise<DatabaseImportSource[]> {
  const { default: ExcelJS } = await import('exceljs')
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error('Excel 文件超过 16 MB，请拆分后导入')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
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

/** 将已确认的字段映射转成绑定参数请求；空自增或默认值字段省略，其余空单元格保留为 SQL NULL。 */
export function prepareImportRows(
  source: DatabaseImportSource,
  target: DatabaseImportTarget,
  columns: readonly string[]
): DatabaseImportRowsTable {
  const error = importMappingError(source, target, columns)
  if (error) throw new Error(error)
  const rows = source.rows.map((row, index) => {
    const values: CellValue[] = []
    columns.forEach((name, columnIndex) => {
      if (!name) return
      const definition = target.columns.find(column => column.name === name)!
      const value = row[columnIndex] ?? null
      if (
        value === '' &&
        (definition.autoIncrement || definition.defaultValue !== null)
      )
        return
      const normalized = value === '' ? null : value
      if (normalized === null && !definition.nullable)
        throw new Error(`${source.name} 第 ${index + 2} 行：${name} 不能为空`)
      values.push({ column: name, value: normalized })
    })
    if (!values.length)
      throw new Error(`${source.name} 第 ${index + 2} 行没有可写入的字段`)
    return values
  })
  return { schema: target.schema, table: target.name, rows }
}

/** 按真实表结构生成空白模板，字段备注写入批注；隐藏元数据保留超过 31 字符的真实表名。 */
export async function createImportTemplate(
  targets: readonly DatabaseImportTarget[]
): Promise<Uint8Array> {
  if (!targets.length) throw new Error('当前数据库没有可生成模板的表')
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
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
