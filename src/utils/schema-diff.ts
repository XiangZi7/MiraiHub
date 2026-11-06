import * as database from '@/api/database'
import type {
  DatabaseColumn,
  DatabaseKind,
  DatabaseTableDetail,
} from '@/types/database'

/** ER 图与结构对比一次最多读取的表数量，避免大库卡住界面。 */
export const SCHEMA_TABLE_LIMIT = 120

/**
 * 读取会话当前库下所有表的详情（字段 / 索引 / 外键）。
 * 以 6 路并发拉取；单表失败时跳过，不让一张无权限的表拖垮整体。
 */
export async function loadSchemaTables(
  sessionId: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ tables: DatabaseTableDetail[]; truncated: boolean }> {
  const objects = (await database.listObjects(sessionId)).filter(
    object => object.kind === 'table'
  )
  const targets = objects.slice(0, SCHEMA_TABLE_LIMIT)
  const tables: DatabaseTableDetail[] = []
  let cursor = 0
  let done = 0
  const worker = async () => {
    while (cursor < targets.length) {
      const object = targets[cursor++]!
      try {
        tables.push(
          await database.tableDetail(sessionId, object.schema, object.name, 'table')
        )
      } catch {
        // 跳过读取失败的表
      }
      onProgress?.(++done, targets.length)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  tables.sort((a, b) => a.name.localeCompare(b.name))
  return { tables, truncated: objects.length > targets.length }
}

export type SchemaDiffKind = 'add-table' | 'drop-table' | 'add-column' | 'drop-column' | 'modify-column' | 'add-index' | 'drop-index'

export interface SchemaDiffItem {
  kind: SchemaDiffKind
  table: string
  name: string
  /** 人类可读的差异说明，如 `varchar(32) → varchar(64)` */
  detail: string
  /** 让目标库对齐源库的 SQL */
  sql: string
}

/** 按方言给标识符加引号。 */
function quote(kind: DatabaseKind, name: string): string {
  return kind === 'mysql'
    ? `\`${name.replaceAll('`', '``')}\``
    : `"${name.replaceAll('"', '""')}"`
}

/** 生成字段定义片段：类型、可空、默认值。 */
function columnDefinition(kind: DatabaseKind, column: DatabaseColumn): string {
  const parts = [quote(kind, column.name), column.dataType]
  if (!column.nullable) parts.push('NOT NULL')
  if (column.defaultValue !== null && column.defaultValue !== '')
    parts.push(`DEFAULT ${column.defaultValue}`)
  return parts.join(' ')
}

/** 字段签名，用于判定是否发生变化。 */
function columnSignature(column: DatabaseColumn): string {
  return [column.dataType.toLowerCase(), column.nullable, column.defaultValue ?? ''].join('|')
}

/**
 * 对比源库与目标库的表结构，返回让“目标”与“源”一致所需的差异与 SQL。
 * 只覆盖表、字段、普通 / 唯一索引；外键、触发器等不在范围内。
 */
export function diffSchemas(
  kind: DatabaseKind,
  source: readonly DatabaseTableDetail[],
  target: readonly DatabaseTableDetail[],
  targetSchema: string
): SchemaDiffItem[] {
  const items: SchemaDiffItem[] = []
  const qualified = (table: string) =>
    kind === 'postgresql' && targetSchema
      ? `${quote(kind, targetSchema)}.${quote(kind, table)}`
      : quote(kind, table)
  const targetByName = new Map(target.map(table => [table.name.toLowerCase(), table]))
  const sourceNames = new Set(source.map(table => table.name.toLowerCase()))

  for (const table of source) {
    const other = targetByName.get(table.name.toLowerCase())
    if (!other) {
      const columns = table.columns.map(column => `  ${columnDefinition(kind, column)}`)
      if (table.primaryKey.length)
        columns.push(`  PRIMARY KEY (${table.primaryKey.map(name => quote(kind, name)).join(', ')})`)
      items.push({
        kind: 'add-table',
        table: table.name,
        name: table.name,
        detail: `${table.columns.length} columns`,
        sql: `CREATE TABLE ${qualified(table.name)} (\n${columns.join(',\n')}\n);`,
      })
      continue
    }
    const otherColumns = new Map(other.columns.map(column => [column.name.toLowerCase(), column]))
    const ownColumns = new Set(table.columns.map(column => column.name.toLowerCase()))
    for (const column of table.columns) {
      const existing = otherColumns.get(column.name.toLowerCase())
      if (!existing) {
        items.push({
          kind: 'add-column',
          table: table.name,
          name: column.name,
          detail: column.dataType,
          sql: `ALTER TABLE ${qualified(table.name)} ADD COLUMN ${columnDefinition(kind, column)};`,
        })
      } else if (columnSignature(existing) !== columnSignature(column)) {
        const sql =
          kind === 'mysql'
            ? `ALTER TABLE ${qualified(table.name)} MODIFY COLUMN ${columnDefinition(kind, column)};`
            : [
                `ALTER TABLE ${qualified(table.name)} ALTER COLUMN ${quote(kind, column.name)} TYPE ${column.dataType};`,
                `ALTER TABLE ${qualified(table.name)} ALTER COLUMN ${quote(kind, column.name)} ${column.nullable ? 'DROP' : 'SET'} NOT NULL;`,
              ].join('\n')
        items.push({
          kind: 'modify-column',
          table: table.name,
          name: column.name,
          detail: `${existing.dataType}${existing.nullable ? '' : ' NOT NULL'} → ${column.dataType}${column.nullable ? '' : ' NOT NULL'}`,
          sql,
        })
      }
    }
    for (const column of other.columns)
      if (!ownColumns.has(column.name.toLowerCase()))
        items.push({
          kind: 'drop-column',
          table: table.name,
          name: column.name,
          detail: column.dataType,
          sql: `ALTER TABLE ${qualified(table.name)} DROP COLUMN ${quote(kind, column.name)};`,
        })

    const indexKey = (columns: string[], unique: boolean) =>
      `${unique ? 'u' : 'i'}:${columns.join(',').toLowerCase()}`
    const otherIndexes = new Map(
      other.indexes.filter(index => !index.primary).map(index => [indexKey(index.columns, index.unique), index])
    )
    const ownIndexes = new Set(
      table.indexes.filter(index => !index.primary).map(index => indexKey(index.columns, index.unique))
    )
    for (const index of table.indexes) {
      if (index.primary || otherIndexes.has(indexKey(index.columns, index.unique))) continue
      const columns = index.columns.map(name => quote(kind, name)).join(', ')
      items.push({
        kind: 'add-index',
        table: table.name,
        name: index.name,
        detail: `(${index.columns.join(', ')})${index.unique ? ' UNIQUE' : ''}`,
        sql: `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(kind, index.name)} ON ${qualified(table.name)} (${columns});`,
      })
    }
    for (const index of other.indexes) {
      if (index.primary || ownIndexes.has(indexKey(index.columns, index.unique))) continue
      items.push({
        kind: 'drop-index',
        table: table.name,
        name: index.name,
        detail: `(${index.columns.join(', ')})`,
        sql:
          kind === 'mysql'
            ? `DROP INDEX ${quote(kind, index.name)} ON ${qualified(table.name)};`
            : `DROP INDEX ${targetSchema ? `${quote(kind, targetSchema)}.` : ''}${quote(kind, index.name)};`,
      })
    }
  }

  for (const table of target)
    if (!sourceNames.has(table.name.toLowerCase()))
      items.push({
        kind: 'drop-table',
        table: table.name,
        name: table.name,
        detail: `${table.columns.length} columns`,
        sql: `DROP TABLE ${qualified(table.name)};`,
      })
  return items
}
