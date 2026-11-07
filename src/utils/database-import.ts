import type { CellValue } from '@/types/database'
import type {
  DatabaseImportSource,
  DatabaseImportTarget,
  DatabaseImportRowsTable,
} from '@/types/database-import'
import { runDatabaseWorkbook } from './database-xlsx-worker'

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

/** 在 Worker 内解析 Excel；字节缓冲区转移给 Worker，调用后 bytes 不再可用。 */
export async function parseImportWorkbook(
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<DatabaseImportSource[]> {
  const reply = await runDatabaseWorkbook(
    { action: 'parse', bytes },
    [bytes.buffer as ArrayBuffer],
    signal
  )
  return reply.sources!
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

/** 在 Worker 内按真实表结构生成空白模板，结果字节直接转移回主线程。 */
export async function createImportTemplate(
  targets: readonly DatabaseImportTarget[],
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!targets.length) throw new Error('当前数据库没有可生成模板的表')
  // 复制为纯 JSON，响应式代理无法被结构化克隆。
  const reply = await runDatabaseWorkbook(
    { action: 'template', targets: JSON.parse(JSON.stringify(targets)) },
    [],
    signal
  )
  return reply.bytes!
}
