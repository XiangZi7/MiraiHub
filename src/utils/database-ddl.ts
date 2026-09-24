import { i18n } from '@/i18n'
import type {
  TableDesignerColumn,
  TableDesignerDraft,
  TableDesignerForeignKey,
  TableDesignerOptions,
  TableDesignerValidation,
} from '@/types/database-designer'
import type {
  DatabaseColumn,
  DatabaseForeignKey,
  DatabaseKind,
  DatabaseTableDetail,
} from '@/types/database'

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
  extraTypes,
}: TableDesignerOptions): TableDesignerValidation {
  const errors: string[] = []
  if (!draft.schema.trim())
    errors.push(i18n.global.t('数据库或 Schema 不能为空'))
  if (!draft.name.trim()) errors.push(i18n.global.t('表名不能为空'))
  if (!draft.columns.length) errors.push(i18n.global.t('至少需要一个字段'))
  if (
    draft.autoIncrement != null &&
    (!/^[1-9]\d*$/u.test(String(draft.autoIncrement)) ||
      BigInt(draft.autoIncrement) >
        (kind === 'mysql' ? 18446744073709551615n : 9223372036854775807n))
  )
    errors.push(i18n.global.t('自增值必须是有效范围内的正整数'))
  if (kind === 'mysql') {
    for (const value of [
      draft.engine,
      draft.charset,
      draft.collation,
      draft.rowFormat,
    ]) {
      if (value && !/^[a-zA-Z0-9_]+$/u.test(value))
        errors.push(i18n.global.t('表选项只能包含字母、数字和下划线'))
    }
    if (
      draft.collation &&
      draft.charset &&
      !draft.collation.startsWith(`${draft.charset}_`)
    )
      errors.push(i18n.global.t('排序规则必须属于所选字符集'))
  }

  const knownTypes = new Set(
    (extraTypes ?? []).map(value => value.trim().toLowerCase())
  )
  const names = new Set<string>()
  let autoIncrementCount = 0
  for (const [index, column] of draft.columns.entries()) {
    const label =
      column.name.trim() ||
      i18n.global.t('第 {value0} 个字段', { value0: index + 1 })
    const normalized = column.name.trim().toLocaleLowerCase()
    const knownType = knownTypes.has(column.dataType.trim().toLowerCase())
    if (!column.name.trim())
      errors.push(
        i18n.global.t('第 {value0} 个字段缺少名称', { value0: index + 1 })
      )
    else if (names.has(normalized))
      errors.push(i18n.global.t('字段“{value0}”重复', { value0: column.name }))
    else names.add(normalized)

    if (!columnTypes(kind).includes(column.dataType as never) && !knownType)
      errors.push(
        i18n.global.t('字段“{value0}”的数据类型不受支持', { value0: label })
      )
    if (
      column.length &&
      !knownType &&
      !/^\d+(?:\s*,\s*\d+)?$/u.test(column.length)
    )
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
  if (draft.autoIncrement != null && autoIncrementCount !== 1)
    errors.push(i18n.global.t('设置自增值需要且只能有一个自增字段'))

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
      ? ` ENGINE=${safeOption(draft.engine || 'InnoDB')} DEFAULT CHARSET=${safeOption(draft.charset || 'utf8mb4')}${draft.collation ? ` COLLATE=${safeOption(draft.collation)}` : ''}${draft.rowFormat ? ` ROW_FORMAT=${safeOption(draft.rowFormat)}` : ''}${draft.autoIncrement != null ? ` AUTO_INCREMENT=${draft.autoIncrement}` : ''}${draft.comment ? ` COMMENT=${quoteLiteral(draft.comment, kind)}` : ''}`
      : ''
  const statements = [
    `CREATE TABLE ${table} (\n${definitions.join(',\n')}\n)${suffix};`,
  ]

  if (kind === 'postgresql') {
    if (draft.autoIncrement != null) {
      const column = draft.columns.find(column => column.autoIncrement)!
      statements.push(
        `ALTER TABLE ${table} ALTER COLUMN ${quoteIdentifier(column.name, kind)} RESTART WITH ${draft.autoIncrement};`
      )
    }
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

// ---------------------------------------------------------------------------
// 编辑表：结构差异 → ALTER TABLE
// ---------------------------------------------------------------------------

export interface TableAlterSpec {
  kind: DatabaseKind
  /** 当前表结构（db_table_detail 返回）。 */
  current: DatabaseTableDetail
  /** 编辑后的草稿。 */
  draft: TableDesignerDraft
  /** 当前表已有的非标准类型，与 validateTableDraft 的 extraTypes 一致。 */
  extraTypes?: readonly string[]
}

interface ParsedType {
  base: string
  length: string
  unsigned: boolean
}

const PG_TYPE_ALIASES: Record<string, string> = {
  'character varying': 'varchar',
  character: 'char',
  bpchar: 'char',
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'time with time zone': 'timetz',
  'time without time zone': 'time',
  int2: 'smallint',
  int4: 'integer',
  int8: 'bigint',
  int: 'integer',
  bool: 'boolean',
  decimal: 'numeric',
  float4: 'real',
  float8: 'double precision',
}

/** 解析 information_schema / pg_catalog 的完整列类型。 */
export function parseStoredType(
  fullType: string,
  kind: DatabaseKind
): ParsedType {
  if (kind === 'mysql') {
    // "bigint(20) unsigned zerofill" / "varchar(255)" / "decimal(10,2)" / "int"
    const withoutZerofill = fullType.replace(/\s*zerofill/giu, '').trim()
    const unsigned = /\s+unsigned$/iu.test(withoutZerofill)
    const core = withoutZerofill.replace(/\s+unsigned$/iu, '').trim()
    const match = /^([^()]+?)(?:\s*\(([^()]*)\))?$/u.exec(core)
    return {
      base: (match?.[1] ?? core).trim().toLowerCase(),
      length: (match?.[2] ?? '').trim(),
      unsigned,
    }
  }
  // PostgreSQL: "character varying(255)" / "timestamp with time zone" / "integer"
  const trimmed = fullType.trim()
  const match = /^([^()]+?)(?:\s*\(([^()]*)\))?$/u.exec(trimmed)
  const raw = (match?.[1] ?? trimmed).trim().toLowerCase()
  return {
    base: PG_TYPE_ALIASES[raw] ?? raw,
    length: (match?.[2] ?? '').trim(),
    unsigned: false,
  }
}

/** 把存储类型解析成设计器里显示的类型标签（大写、别名归一）。 */
export function normalizeDataTypeLabel(
  fullType: string,
  kind: DatabaseKind
): string {
  return parseStoredType(fullType, kind).base.toUpperCase()
}

function draftTypeParsed(column: TableDesignerColumn): ParsedType {
  return {
    base: column.dataType.trim().toLowerCase(),
    length: column.length.trim(),
    unsigned: column.unsigned,
  }
}

function normalizeDefault(value: string | null): string {
  if (value == null) return ''
  let normalized = value.trim().toLowerCase()
  if (/^null$/u.test(normalized)) return ''
  normalized = normalized.replaceAll('`', '').replaceAll('"', '')
  if (normalized.endsWith('()')) normalized = normalized.slice(0, -2)
  return normalized
}

/** 两边都有值的长度直接比；草稿为空视为未改，避免 MySQL int(11) 显示宽度噪声。 */
function typeChanged(current: ParsedType, draft: ParsedType): boolean {
  if (current.base !== draft.base) return true
  if (current.unsigned !== draft.unsigned) return true
  return Boolean(draft.length) && draft.length !== current.length
}

function sameColumns(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

function foreignKeyChanged(
  current: DatabaseForeignKey,
  draft: TableDesignerForeignKey
): boolean {
  return (
    current.columns.length !== 1 ||
    (current.columns[0] ?? '').toLowerCase() !==
      draft.column.trim().toLowerCase() ||
    current.referencedSchema.trim().toLowerCase() !==
      draft.referencedSchema.trim().toLowerCase() ||
    current.referencedTable.trim().toLowerCase() !==
      draft.referencedTable.trim().toLowerCase() ||
    (current.referencedColumns[0] ?? '').trim().toLowerCase() !==
      draft.referencedColumn.trim().toLowerCase() ||
    (current.deleteRule || 'NO ACTION') !== draft.onDelete ||
    (current.updateRule || 'NO ACTION') !== draft.onUpdate
  )
}

/**
 * 生成把表结构从 current 改成 draft 的 SQL。
 *
 * 所有结构改动都作用于旧限定名，改名/换 schema 的语句放在最后；
 * 没有任何差异时返回空字符串，由调用方决定提示。
 */
export function buildAlterTableSql({
  kind,
  current,
  draft,
  extraTypes,
}: TableAlterSpec): string {
  const validation = validateTableDraft({ kind, draft, extraTypes })
  if (!validation.valid) throw new Error(validation.errors[0])

  const target = qualifiedName(current.schema, current.name, kind)
  const statements: string[] = []
  const mainClauses: string[] = []
  const pgStatements: string[] = []

  const realColumnNames = new Set(
    current.columns.map(column => column.name.toLowerCase())
  )
  const currentColumns = new Map(
    current.columns.map(column => [column.name.toLowerCase(), column])
  )
  const draftColumns = new Map(
    draft.columns.map(column => [column.name.toLowerCase(), column])
  )

  // 外键：先 DROP（改列前必须先解除引用），再 ADD。
  // 因变化被 DROP 的外键要在下面重建，所以记录下来避免 ADD 循环跳过。
  const droppedForeignKeyNames = new Set<string>()
  for (const foreignKey of current.foreignKeys) {
    const draftForeignKey = draft.foreignKeys.find(
      item => item.name.toLowerCase() === foreignKey.name.toLowerCase()
    )
    if (draftForeignKey) {
      if (!foreignKeyChanged(foreignKey, draftForeignKey)) continue
    } else if (foreignKey.columns.length > 1) {
      // 复合外键在编辑器里无法表示，保持原样不删。
      continue
    } else if (
      !foreignKey.columns.every(column =>
        realColumnNames.has(column.toLowerCase())
      )
    ) {
      continue
    }
    droppedForeignKeyNames.add(foreignKey.name.toLowerCase())
    if (kind === 'mysql')
      mainClauses.push(
        `DROP FOREIGN KEY ${quoteIdentifier(foreignKey.name, kind)}`
      )
    else
      pgStatements.push(
        `ALTER TABLE ${target} DROP CONSTRAINT ${quoteIdentifier(foreignKey.name, kind)}`
      )
  }

  // 索引：主键单独处理；无法表示的索引（表达式、前缀）保持原样不删。
  const draftIndexNames = new Set(
    draft.indexes.map(item => item.name.toLowerCase())
  )
  const droppedIndexNames = new Set<string>()
  for (const index of current.indexes) {
    if (index.primary) continue
    if (draftIndexNames.has(index.name.toLowerCase())) continue
    if (
      !index.columns.every(column => realColumnNames.has(column.toLowerCase()))
    )
      continue
    if (index.subPart != null) continue
    droppedIndexNames.add(index.name.toLowerCase())
    if (kind === 'mysql')
      mainClauses.push(`DROP INDEX ${quoteIdentifier(index.name, kind)}`)
    else
      pgStatements.push(
        `DROP INDEX ${qualifiedName(current.schema, index.name, kind)}`
      )
  }

  // 主键差异（集合比较，列顺序不影响判定）。
  const currentPrimaryKey = current.primaryKey.map(column =>
    column.toLowerCase()
  )
  const draftPrimaryKey = draft.columns
    .filter(column => column.primaryKey)
    .map(column => column.name.toLowerCase())
  const primaryKeyChanged =
    currentPrimaryKey.length > 0 || draftPrimaryKey.length > 0
      ? !sameColumns(currentPrimaryKey, draftPrimaryKey)
      : false
  if (primaryKeyChanged) {
    if (currentPrimaryKey.length) {
      if (kind === 'mysql') {
        mainClauses.push('DROP PRIMARY KEY')
      } else {
        const primaryIndex = current.indexes.find(index => index.primary)
        if (primaryIndex)
          pgStatements.push(
            `ALTER TABLE ${target} DROP CONSTRAINT ${quoteIdentifier(primaryIndex.name, kind)}`
          )
      }
    }
    if (draftPrimaryKey.length) {
      const columns = draftPrimaryKey
        .map(column => quoteIdentifier(column, kind))
        .join(', ')
      if (kind === 'mysql') mainClauses.push(`ADD PRIMARY KEY (${columns})`)
      else
        pgStatements.push(`ALTER TABLE ${target} ADD PRIMARY KEY (${columns})`)
    }
  }

  // 字段差异。
  for (const [key, currentColumn] of currentColumns) {
    const draftColumn = draftColumns.get(key)
    if (!draftColumn) {
      if (kind === 'mysql')
        mainClauses.push(
          `DROP COLUMN ${quoteIdentifier(currentColumn.name, kind)}`
        )
      else
        pgStatements.push(
          `ALTER TABLE ${target} DROP COLUMN ${quoteIdentifier(currentColumn.name, kind)}`
        )
      continue
    }
    const currentType = parseStoredType(currentColumn.dataType, kind)
    const draftType = draftTypeParsed(draftColumn)
    if (
      typeChanged(currentType, draftType) ||
      currentColumn.nullable !== draftColumn.nullable ||
      currentColumn.autoIncrement !== draftColumn.autoIncrement ||
      (currentColumn.comment ?? '') !== draftColumn.comment ||
      normalizeDefault(currentColumn.defaultValue) !==
        normalizeDefault(draftColumn.defaultValue || null)
    ) {
      if (kind === 'mysql') {
        mainClauses.push(
          `MODIFY COLUMN ${renderColumn(draftColumn, kind).trim()}`
        )
      } else {
        pgStatements.push(
          ...postgresqlColumnAlter(target, currentColumn, draftColumn)
        )
      }
    }
  }
  for (const [key, draftColumn] of draftColumns) {
    if (currentColumns.has(key)) continue
    const definition = renderColumn(draftColumn, kind).trim()
    if (kind === 'mysql') mainClauses.push(`ADD COLUMN ${definition}`)
    else pgStatements.push(`ALTER TABLE ${target} ADD COLUMN ${definition}`)
  }

  // 新增索引。因变化被 DROP 的索引已在上面重建，这里只补真正新增的。
  for (const index of draft.indexes) {
    if (
      current.indexes.some(
        item =>
          item.name.toLowerCase() === index.name.toLowerCase() &&
          !item.primary &&
          !droppedIndexNames.has(index.name.toLowerCase())
      )
    )
      continue
    const columns = index.columns
      .map(column => quoteIdentifier(column, kind))
      .join(', ')
    if (kind === 'mysql') {
      const prefix =
        index.kind === 'unique'
          ? 'UNIQUE INDEX'
          : index.kind === 'fulltext'
            ? 'FULLTEXT INDEX'
            : 'INDEX'
      const method =
        index.kind === 'fulltext' ? '' : ` USING ${index.method.toUpperCase()}`
      mainClauses.push(
        `ADD ${prefix} ${quoteIdentifier(index.name, kind)} (${columns})${method}`
      )
    } else {
      const unique = index.kind === 'unique' ? 'UNIQUE ' : ''
      pgStatements.push(
        `CREATE ${unique}INDEX ${quoteIdentifier(index.name, kind)} ON ${target} USING ${index.method} (${columns})`
      )
    }
  }

  // 新增外键。因变化被 DROP 的外键已在上面重建，这里只补真正新增的。
  for (const foreignKey of draft.foreignKeys) {
    if (
      current.foreignKeys.some(
        item =>
          item.name.toLowerCase() === foreignKey.name.toLowerCase() &&
          !droppedForeignKeyNames.has(foreignKey.name.toLowerCase())
      )
    )
      continue
    const constraint = `CONSTRAINT ${quoteIdentifier(foreignKey.name, kind)} FOREIGN KEY (${quoteIdentifier(foreignKey.column, kind)}) REFERENCES ${qualifiedName(foreignKey.referencedSchema, foreignKey.referencedTable, kind)} (${quoteIdentifier(foreignKey.referencedColumn, kind)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
    if (kind === 'mysql') mainClauses.push(`ADD ${constraint}`)
    else pgStatements.push(`ALTER TABLE ${target} ADD ${constraint}`)
  }

  // 表选项（MySQL 合并进主 ALTER；PostgreSQL 走 COMMENT ON）。
  if (kind === 'mysql') {
    if (draft.engine && draft.engine !== current.options?.engine)
      mainClauses.push(`ENGINE=${safeOption(draft.engine)}`)
    if (
      draft.charset &&
      (draft.charset !== current.options?.charset ||
        (draft.collation === '' && current.options?.collation))
    )
      mainClauses.push(`DEFAULT CHARSET=${safeOption(draft.charset)}`)
    if (
      draft.collation &&
      (draft.collation !== current.options?.collation ||
        draft.charset !== current.options?.charset)
    )
      mainClauses.push(`COLLATE=${safeOption(draft.collation)}`)
    if (
      draft.rowFormat &&
      draft.rowFormat.toUpperCase() !==
        current.options?.rowFormat?.toUpperCase()
    )
      mainClauses.push(`ROW_FORMAT=${safeOption(draft.rowFormat)}`)
    if ((draft.comment ?? '') !== (current.options?.comment ?? ''))
      mainClauses.push(`COMMENT=${quoteLiteral(draft.comment ?? '', kind)}`)
    if (
      draft.autoIncrement != null &&
      String(draft.autoIncrement) !== String(current.options?.autoIncrement)
    )
      mainClauses.push(`AUTO_INCREMENT=${draft.autoIncrement}`)
  } else if (kind === 'postgresql') {
    if ((draft.comment ?? '') !== (current.options?.comment ?? ''))
      pgStatements.push(
        `COMMENT ON TABLE ${target} IS ${quoteLiteral(draft.comment ?? '', kind)}`
      )
    if (
      draft.autoIncrement != null &&
      String(draft.autoIncrement) !== String(current.options?.autoIncrement)
    ) {
      const column = draft.columns.find(column => column.autoIncrement)!
      const storedColumn = current.columns.find(
        item => item.name === column.name
      )
      if (
        storedColumn?.autoIncrement &&
        /\bnextval\s*\(/iu.test(storedColumn.defaultValue ?? '')
      )
        throw new Error(
          i18n.global.t('serial 序列请在查询中使用 ALTER SEQUENCE 修改')
        )
      pgStatements.push(
        `ALTER TABLE ${target} ALTER COLUMN ${quoteIdentifier(column.name, kind)} RESTART WITH ${draft.autoIncrement}`
      )
    }
  }

  if (kind === 'mysql') {
    if (mainClauses.length)
      statements.push(`ALTER TABLE ${target} ${mainClauses.join(', ')}`)
  } else {
    statements.push(...pgStatements)
  }

  // 改名 / 换 schema 放在最后。
  const schemaChanged = draft.schema.trim() !== current.schema
  const nameChanged = draft.name.trim() !== current.name
  if (kind === 'mysql') {
    if (schemaChanged || nameChanged)
      statements.push(
        `RENAME TABLE ${target} TO ${qualifiedName(draft.schema, draft.name, kind)}`
      )
  } else {
    let renamedFrom = target
    if (schemaChanged) {
      statements.push(
        `ALTER TABLE ${target} SET SCHEMA ${quoteIdentifier(draft.schema, kind)}`
      )
      renamedFrom = qualifiedName(draft.schema, current.name, kind)
    }
    if (nameChanged)
      statements.push(
        `ALTER TABLE ${renamedFrom} RENAME TO ${quoteIdentifier(draft.name, kind)}`
      )
  }

  return statements.join('\n\n')
}

function postgresqlColumnAlter(
  target: string,
  current: DatabaseColumn,
  draft: TableDesignerColumn
): string[] {
  const statements: string[] = []
  const column = quoteIdentifier(draft.name, 'postgresql')
  const currentType = parseStoredType(current.dataType, 'postgresql')
  const draftType = draftTypeParsed(draft)

  if (typeChanged(currentType, draftType)) {
    const length = draft.length ? `(${draft.length.replace(/\s+/gu, '')})` : ''
    statements.push(
      `ALTER TABLE ${target} ALTER COLUMN ${column} TYPE ${draft.dataType}${length}`
    )
  }
  if (current.nullable !== draft.nullable) {
    statements.push(
      `ALTER TABLE ${target} ALTER COLUMN ${column} ${draft.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`
    )
  }
  if (
    normalizeDefault(current.defaultValue) !==
    normalizeDefault(draft.defaultValue || null)
  ) {
    statements.push(
      draft.defaultValue && !draft.autoIncrement
        ? `ALTER TABLE ${target} ALTER COLUMN ${column} SET DEFAULT ${draft.defaultValue}`
        : `ALTER TABLE ${target} ALTER COLUMN ${column} DROP DEFAULT`
    )
  }
  if (current.autoIncrement !== draft.autoIncrement) {
    statements.push(
      `ALTER TABLE ${target} ALTER COLUMN ${column} ${draft.autoIncrement ? 'ADD GENERATED BY DEFAULT AS IDENTITY' : 'DROP IDENTITY'}`
    )
  }
  if ((current.comment ?? '') !== draft.comment) {
    statements.push(
      `COMMENT ON COLUMN ${target}.${column} IS ${quoteLiteral(draft.comment, 'postgresql')}`
    )
  }
  return statements
}
