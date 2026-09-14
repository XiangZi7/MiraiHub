import { i18n } from '@/i18n'
import type {
  TableDesignerColumn,
  TableDesignerOptions,
  TableDesignerValidation,
} from '@/types/database-designer'
import type { DatabaseKind } from '@/types/database'

export const MYSQL_COLUMN_TYPES = [
  'BIGINT',
  'INT',
  'SMALLINT',
  'TINYINT',
  'DECIMAL',
  'DOUBLE',
  'FLOAT',
  'VARCHAR',
  'CHAR',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
  'JSON',
  'BINARY',
  'VARBINARY',
  'BLOB',
  'MEDIUMBLOB',
  'LONGBLOB',
] as const

export const POSTGRESQL_COLUMN_TYPES = [
  'BIGINT',
  'INTEGER',
  'SMALLINT',
  'NUMERIC',
  'DOUBLE PRECISION',
  'REAL',
  'VARCHAR',
  'CHAR',
  'TEXT',
  'BOOLEAN',
  'DATE',
  'TIMESTAMP',
  'TIMESTAMP WITH TIME ZONE',
  'TIME',
  'JSON',
  'JSONB',
  'UUID',
  'BYTEA',
] as const

const INTEGER_TYPES = new Set([
  'BIGINT',
  'INT',
  'INTEGER',
  'SMALLINT',
  'TINYINT',
])

export function columnTypes(kind: DatabaseKind): readonly string[] {
  return kind === 'mysql' ? MYSQL_COLUMN_TYPES : POSTGRESQL_COLUMN_TYPES
}

export function validateTableDraft({
  kind,
  draft,
}: TableDesignerOptions): TableDesignerValidation {
  const errors: string[] = []
  if (!draft.schema.trim())
    errors.push(i18n.global.t('数据库或 Schema 不能为空'))
  if (!draft.name.trim()) errors.push(i18n.global.t('表名不能为空'))
  if (!draft.columns.length) errors.push(i18n.global.t('至少需要一个字段'))

  const names = new Set<string>()
  let autoIncrementCount = 0
  for (const [index, column] of draft.columns.entries()) {
    const label =
      column.name.trim() ||
      i18n.global.t('第 {value0} 个字段', { value0: index + 1 })
    const normalized = column.name.trim().toLocaleLowerCase()
    if (!column.name.trim())
      errors.push(
        i18n.global.t('第 {value0} 个字段缺少名称', { value0: index + 1 })
      )
    else if (names.has(normalized))
      errors.push(i18n.global.t('字段“{value0}”重复', { value0: column.name }))
    else names.add(normalized)

    if (!columnTypes(kind).includes(column.dataType as never))
      errors.push(
        i18n.global.t('字段“{value0}”的数据类型不受支持', { value0: label })
      )
    if (column.length && !/^\d+(?:\s*,\s*\d+)?$/u.test(column.length))
      errors.push(
        i18n.global.t('字段“{value0}”的长度或精度格式不正确', { value0: label })
      )
    if (column.defaultValue && /;|--|\/\*|\*\//u.test(column.defaultValue))
      errors.push(
        i18n.global.t('字段“{value0}”的默认值不能包含语句分隔符或注释', {
          value0: label,
        })
      )
    if (column.autoIncrement) {
      autoIncrementCount += 1
      if (!INTEGER_TYPES.has(column.dataType))
        errors.push(
          i18n.global.t('字段“{value0}”只有整数类型才能自动递增', {
            value0: label,
          })
        )
    }
  }
  if (kind === 'mysql' && autoIncrementCount > 1)
    errors.push(i18n.global.t('MySQL 每张表只能有一个自动递增字段'))

  const columnNames = new Set(draft.columns.map(column => column.name))
  const indexNames = new Set<string>()
  for (const [index, item] of draft.indexes.entries()) {
    const label =
      item.name.trim() ||
      i18n.global.t('第 {value0} 个索引', { value0: index + 1 })
    const normalized = item.name.trim().toLocaleLowerCase()
    if (!item.name.trim())
      errors.push(
        i18n.global.t('第 {value0} 个索引缺少名称', { value0: index + 1 })
      )
    else if (indexNames.has(normalized))
      errors.push(i18n.global.t('索引“{value0}”重复', { value0: item.name }))
    else indexNames.add(normalized)
    if (!item.columns.length)
      errors.push(
        i18n.global.t('索引“{value0}”至少需要一个字段', { value0: label })
      )
    if (item.columns.some(column => !columnNames.has(column)))
      errors.push(
        i18n.global.t('索引“{value0}”包含不存在的字段', { value0: label })
      )
    if (item.kind === 'fulltext' && kind !== 'mysql')
      errors.push(i18n.global.t('全文索引当前只支持 MySQL'))
  }

  const foreignKeyNames = new Set<string>()
  for (const [index, foreignKey] of draft.foreignKeys.entries()) {
    const label =
      foreignKey.name.trim() ||
      i18n.global.t('第 {value0} 个外键', { value0: index + 1 })
    const normalized = foreignKey.name.trim().toLocaleLowerCase()
    if (!foreignKey.name.trim())
      errors.push(
        i18n.global.t('第 {value0} 个外键缺少名称', { value0: index + 1 })
      )
    else if (foreignKeyNames.has(normalized))
      errors.push(
        i18n.global.t('外键“{value0}”重复', { value0: foreignKey.name })
      )
    else foreignKeyNames.add(normalized)
    if (!foreignKey.column || !columnNames.has(foreignKey.column))
      errors.push(
        i18n.global.t('外键“{value0}”缺少有效的本地字段', { value0: label })
      )
    if (
      !foreignKey.referencedSchema.trim() ||
      !foreignKey.referencedTable.trim() ||
      !foreignKey.referencedColumn.trim()
    )
      errors.push(
        i18n.global.t('外键“{value0}”的引用目标不完整', { value0: label })
      )
    if (
      foreignKey.onDelete === 'SET NULL' &&
      !draft.columns.find(column => column.name === foreignKey.column)?.nullable
    )
      errors.push(
        i18n.global.t('外键“{value0}”使用 SET NULL 时本地字段必须允许 NULL', {
          value0: label,
        })
      )
  }

  return { valid: errors.length === 0, errors }
}

export function buildCreateTableSql({
  kind,
  draft,
}: TableDesignerOptions): string {
  const validation = validateTableDraft({ kind, draft })
  if (!validation.valid) throw new Error(validation.errors[0])

  const table = qualifiedName(draft.schema, draft.name, kind)
  const definitions = draft.columns.map(column => renderColumn(column, kind))
  const primaryColumns = draft.columns
    .filter(column => column.primaryKey)
    .map(column => quoteIdentifier(column.name, kind))
  if (primaryColumns.length)
    definitions.push(`  PRIMARY KEY (${primaryColumns.join(', ')})`)

  if (kind === 'mysql') {
    for (const index of draft.indexes) {
      const prefix =
        index.kind === 'unique'
          ? 'UNIQUE KEY'
          : index.kind === 'fulltext'
            ? 'FULLTEXT KEY'
            : 'KEY'
      const method =
        index.kind === 'fulltext' ? '' : ` USING ${index.method.toUpperCase()}`
      definitions.push(
        `  ${prefix} ${quoteIdentifier(index.name, kind)} (${index.columns.map(column => quoteIdentifier(column, kind)).join(', ')})${method}`
      )
    }
  }

  for (const foreignKey of draft.foreignKeys) {
    definitions.push(
      `  CONSTRAINT ${quoteIdentifier(foreignKey.name, kind)} FOREIGN KEY (${quoteIdentifier(foreignKey.column, kind)}) REFERENCES ${qualifiedName(foreignKey.referencedSchema, foreignKey.referencedTable, kind)} (${quoteIdentifier(foreignKey.referencedColumn, kind)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
    )
  }

  const suffix =
    kind === 'mysql'
      ? ` ENGINE=${safeOption(draft.engine || 'InnoDB')} DEFAULT CHARSET=${safeOption(draft.charset || 'utf8mb4')}${draft.comment ? ` COMMENT=${quoteLiteral(draft.comment, kind)}` : ''}`
      : ''
  const statements = [
    `CREATE TABLE ${table} (\n${definitions.join(',\n')}\n)${suffix};`,
  ]

  if (kind === 'postgresql') {
    for (const index of draft.indexes) {
      const unique = index.kind === 'unique' ? 'UNIQUE ' : ''
      statements.push(
        `CREATE ${unique}INDEX ${quoteIdentifier(index.name, kind)} ON ${table} USING ${index.method} (${index.columns.map(column => quoteIdentifier(column, kind)).join(', ')});`
      )
    }
    if (draft.comment)
      statements.push(
        `COMMENT ON TABLE ${table} IS ${quoteLiteral(draft.comment, kind)};`
      )
    for (const column of draft.columns) {
      if (column.comment)
        statements.push(
          `COMMENT ON COLUMN ${table}.${quoteIdentifier(column.name, kind)} IS ${quoteLiteral(column.comment, kind)};`
        )
    }
  }

  return statements.join('\n\n')
}

function renderColumn(column: TableDesignerColumn, kind: DatabaseKind): string {
  const length = column.length ? `(${column.length.replace(/\s+/gu, '')})` : ''
  const unsigned = kind === 'mysql' && column.unsigned ? ' UNSIGNED' : ''
  const identity = column.autoIncrement
    ? kind === 'mysql'
      ? ' AUTO_INCREMENT'
      : ' GENERATED BY DEFAULT AS IDENTITY'
    : ''
  const nullable = column.primaryKey || !column.nullable ? ' NOT NULL' : ' NULL'
  const defaultValue =
    column.defaultValue && !column.autoIncrement
      ? ` DEFAULT ${column.defaultValue}`
      : ''
  const unique = column.unique && !column.primaryKey ? ' UNIQUE' : ''
  const comment =
    kind === 'mysql' && column.comment
      ? ` COMMENT ${quoteLiteral(column.comment, kind)}`
      : ''
  return `  ${quoteIdentifier(column.name, kind)} ${column.dataType}${length}${unsigned}${identity}${nullable}${defaultValue}${unique}${comment}`
}

function quoteIdentifier(identifier: string, kind: DatabaseKind): string {
  return kind === 'mysql'
    ? `\`${identifier.replaceAll('`', '``')}\``
    : `"${identifier.replaceAll('"', '""')}"`
}

function qualifiedName(
  schema: string,
  name: string,
  kind: DatabaseKind
): string {
  return `${quoteIdentifier(schema, kind)}.${quoteIdentifier(name, kind)}`
}

function quoteLiteral(value: string, kind: DatabaseKind): string {
  const escaped = value.replaceAll("'", "''")
  return kind === 'mysql'
    ? `'${escaped.replaceAll('\\', '\\\\')}'`
    : `'${escaped}'`
}

function safeOption(value: string): string {
  if (!/^[A-Za-z0-9_]+$/u.test(value))
    throw new Error(i18n.global.t('存储引擎或字符集不合法'))
  return value
}
