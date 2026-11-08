import { i18n } from '@/i18n'
import type {
  TableDesignerChange,
  TableDesignerCheck,
  TableDesignerColumn,
  TableDesignerDraft,
  TableDesignerTrigger,
  TableDesignerForeignKey,
  TableDesignerIndex,
  TableIndexMethod,
  TableDesignerOptions,
  TableDesignerPartitionChange,
  TableDesignerPartitionItem,
  TableDesignerValidation,
  TablePartitionAction,
} from '@/types/database-designer'
import type {
  DatabaseColumn,
  DatabaseCheckConstraint,
  DatabaseForeignKey,
  DatabaseIndex,
  DatabaseKind,
  DatabasePartitionInfo,
  DatabaseTableDetail,
  DatabaseTableOptions,
  DatabaseTrigger,
} from '@/types/database'

interface ColumnTypeGroup {
  /** i18n 键，由界面翻译。 */
  label: string
  types: readonly string[]
}

export const MYSQL_COLUMN_TYPE_GROUPS: readonly ColumnTypeGroup[] = [
  {
    label: '整数',
    types: ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'],
  },
  { label: '小数', types: ['DECIMAL', 'FLOAT', 'DOUBLE'] },
  {
    label: '字符串',
    types: [
      'CHAR',
      'VARCHAR',
      'TINYTEXT',
      'TEXT',
      'MEDIUMTEXT',
      'LONGTEXT',
      'ENUM',
      'SET',
    ],
  },
  {
    label: '日期时间',
    types: ['DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR'],
  },
  {
    label: '二进制',
    types: [
      'BINARY',
      'VARBINARY',
      'TINYBLOB',
      'BLOB',
      'MEDIUMBLOB',
      'LONGBLOB',
      'BIT',
    ],
  },
  { label: '其他', types: ['BOOLEAN', 'JSON'] },
  {
    label: '空间',
    types: [
      'GEOMETRY',
      'POINT',
      'LINESTRING',
      'POLYGON',
      'MULTIPOINT',
      'MULTILINESTRING',
      'MULTIPOLYGON',
      'GEOMETRYCOLLECTION',
    ],
  },
]

export const POSTGRESQL_COLUMN_TYPE_GROUPS: readonly ColumnTypeGroup[] = [
  { label: '整数', types: ['SMALLINT', 'INTEGER', 'BIGINT'] },
  { label: '小数', types: ['NUMERIC', 'REAL', 'DOUBLE PRECISION', 'MONEY'] },
  { label: '字符串', types: ['VARCHAR', 'CHAR', 'TEXT'] },
  {
    label: '日期时间',
    types: [
      'DATE',
      'TIME',
      'TIMETZ',
      'TIMESTAMP',
      'TIMESTAMPTZ',
      'TIMESTAMP WITH TIME ZONE',
      'INTERVAL',
    ],
  },
  { label: '二进制', types: ['BYTEA', 'BIT'] },
  { label: '其他', types: ['BOOLEAN', 'UUID', 'JSON', 'JSONB', 'XML'] },
  { label: '网络', types: ['INET', 'CIDR', 'MACADDR'] },
]

export const MYSQL_COLUMN_TYPES = MYSQL_COLUMN_TYPE_GROUPS.flatMap(
  group => group.types
)
export const POSTGRESQL_COLUMN_TYPES = POSTGRESQL_COLUMN_TYPE_GROUPS.flatMap(
  group => group.types
)

const INTEGER_TYPES = new Set([
  'BIGINT',
  'INT',
  'INTEGER',
  'MEDIUMINT',
  'SMALLINT',
  'TINYINT',
])
const FRACTIONAL_TYPES = new Set(['DECIMAL', 'NUMERIC'])
const FLOAT_TYPES = new Set(['FLOAT', 'DOUBLE', 'DOUBLE PRECISION', 'REAL'])
const SIZED_TYPES = new Set(['VARCHAR', 'CHAR', 'BINARY', 'VARBINARY', 'BIT'])
const TEMPORAL_PRECISION_TYPES = new Set([
  'DATETIME',
  'TIME',
  'TIMETZ',
  'TIMESTAMP',
  'TIMESTAMPTZ',
  'TIMESTAMP WITH TIME ZONE',
])
const TEXT_TYPES = new Set([
  'CHAR',
  'VARCHAR',
  'TINYTEXT',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'ENUM',
  'SET',
])
const SPATIAL_TYPES = new Set(
  MYSQL_COLUMN_TYPE_GROUPS.find(group => group.label === '空间')?.types
)

export function columnTypes(kind: DatabaseKind): readonly string[] {
  return kind === 'mysql' ? MYSQL_COLUMN_TYPES : POSTGRESQL_COLUMN_TYPES
}

export function columnTypeGroups(
  kind: DatabaseKind
): readonly ColumnTypeGroup[] {
  return kind === 'mysql'
    ? MYSQL_COLUMN_TYPE_GROUPS
    : POSTGRESQL_COLUMN_TYPE_GROUPS
}

export function indexMethods(kind: DatabaseKind): readonly TableIndexMethod[] {
  return kind === 'mysql'
    ? ['btree', 'hash']
    : ['btree', 'hash', 'gist', 'gin', 'brin', 'spgist']
}

/** 某个类型在当前方言下可以配置哪些属性，界面和校验共用。 */
export function columnTypeTraits(dataType: string, kind: DatabaseKind) {
  const type = dataType.trim().toUpperCase()
  const mysql = kind === 'mysql'
  const integer = INTEGER_TYPES.has(type)
  const fractional = FRACTIONAL_TYPES.has(type)
  const float = FLOAT_TYPES.has(type)
  const numeric = integer || fractional || float
  const text = TEXT_TYPES.has(type)
  return {
    integer,
    enumerated: mysql && (type === 'ENUM' || type === 'SET'),
    spatial: mysql && SPATIAL_TYPES.has(type),
    length:
      fractional ||
      SIZED_TYPES.has(type) ||
      TEMPORAL_PRECISION_TYPES.has(type) ||
      (mysql && (integer || float)),
    scale: fractional || (mysql && float),
    unsigned: mysql && numeric,
    zerofill: mysql && numeric,
    charset: mysql && text,
    collation: text,
    onUpdate: mysql && (type === 'TIMESTAMP' || type === 'DATETIME'),
    /** MySQL 只有字符串和二进制类型能做前缀索引。 */
    prefix:
      mysql && (text || /BINARY|BLOB/u.test(type)) && !/ENUM|SET/u.test(type),
    /** 前缀是必填的类型。 */
    prefixRequired: mysql && /TEXT|BLOB/u.test(type),
  }
}

/** 切换类型时给的常用长度，避免 VARCHAR 这类必填长度的类型一换就报错。 */
export function defaultColumnLength(dataType: string): string {
  const type = dataType.trim().toUpperCase()
  if (FRACTIONAL_TYPES.has(type)) return '10,2'
  if (type === 'VARCHAR' || type === 'VARBINARY') return '255'
  return ''
}

/** 文本默认值转成 SQL 字面量。 */
export function quoteDefaultText(value: string, kind: DatabaseKind): string {
  return quoteLiteral(value, kind)
}

/** SQL 字面量还原成文本；不是单个字面量时返回 null。 */
export function unquoteDefaultText(
  value: string,
  kind: DatabaseKind
): string | null {
  if (!SQL_STRING_LITERAL.test(value.trim())) return null
  const inner = value.trim().slice(1, -1).replaceAll("''", "'")
  return kind === 'mysql'
    ? inner.replace(/\\(.)/gsu, '$1')
    : inner
}

/** 按主键顺序排列；没有顺序号的字段跟在后面并保持字段顺序。 */
export function primaryKeyColumns(
  columns: readonly TableDesignerColumn[]
): TableDesignerColumn[] {
  return columns
    .filter(column => column.primaryKey)
    .map((column, index) => ({ column, index }))
    .sort(
      (left, right) =>
        (left.column.primaryKeyOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.column.primaryKeyOrder ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index
    )
    .map(({ column }) => column)
}

// 单引号字面量里的分号不是语句分隔符，不需要拦。
const SQL_STRING_LITERAL = /^'(?:[^'\\]|''|\\.)*'$/su
const UNSAFE_SQL_TOKEN = /;|--|\/\*|\*\//u
const COLLATION_NAME = /^[\w.@-]+$/u

export function validateTableDraft({
  kind,
  draft,
  extraTypes,
}: TableDesignerOptions): TableDesignerValidation {
  const errors: string[] = []
  const columnErrors: Record<string, string[]> = {}
  const indexErrors: Record<string, string[]> = {}
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
    const fail = (message: string): void => {
      errors.push(message)
      ;(columnErrors[column.id] ??= []).push(message)
    }
    const label =
      column.name.trim() ||
      i18n.global.t('第 {value0} 个字段', { value0: index + 1 })
    const normalized = column.name.trim().toLocaleLowerCase()
    const knownType = knownTypes.has(column.dataType.trim().toLowerCase())
    const traits = columnTypeTraits(column.dataType, kind)
    if (!column.name.trim())
      fail(i18n.global.t('第 {value0} 个字段缺少名称', { value0: index + 1 }))
    else if (names.has(normalized))
      fail(i18n.global.t('字段“{value0}”重复', { value0: column.name }))
    else names.add(normalized)

    if (!columnTypes(kind).includes(column.dataType) && !knownType)
      fail(i18n.global.t('字段“{value0}”的数据类型不受支持', { value0: label }))
    if (traits.enumerated) {
      if (!/^'.*'$/su.test(column.length.trim()))
        fail(
          i18n.global.t('字段“{value0}”需要填写枚举值', {
            value0: label,
          })
        )
    } else if (
      column.length &&
      !knownType &&
      !/^\d+(?:\s*,\s*\d+)?$/u.test(column.length)
    )
      fail(
        i18n.global.t('字段“{value0}”的长度或精度格式不正确', { value0: label })
      )
    if (
      kind === 'mysql' &&
      !column.length.trim() &&
      /^(?:VARCHAR|VARBINARY)$/u.test(column.dataType)
    )
      fail(i18n.global.t('字段“{value0}”必须指定长度', { value0: label }))
    // 精度 / 小数位的取值关系：长度不能为 0，小数位不能超过精度。
    const lengthMatch = !traits.enumerated
      ? /^(\d+)(?:\s*,\s*(\d+))?$/u.exec(column.length.trim())
      : null
    if (lengthMatch && Number(lengthMatch[1]) === 0 && traits.length)
      fail(i18n.global.t('字段“{value0}”的长度必须大于 0', { value0: label }))
    if (lengthMatch?.[2] && Number(lengthMatch[2]) > Number(lengthMatch[1]))
      fail(
        i18n.global.t('字段“{value0}”的小数位不能大于精度', { value0: label })
      )
    if (
      /^current_timestamp(?:\(\d*\))?$/iu.test(column.defaultValue.trim()) &&
      !/DATE|TIME/u.test(column.dataType.toUpperCase())
    )
      fail(
        i18n.global.t('字段“{value0}”只有日期时间类型才能默认当前时间', {
          value0: label,
        })
      )
    if (
      column.defaultValue &&
      !SQL_STRING_LITERAL.test(column.defaultValue.trim()) &&
      UNSAFE_SQL_TOKEN.test(column.defaultValue)
    )
      fail(
        i18n.global.t('字段“{value0}”的默认值不能包含语句分隔符或注释', {
          value0: label,
        })
      )
    if (
      !column.nullable &&
      /^null$/iu.test(column.defaultValue.trim()) &&
      !column.autoIncrement
    )
      fail(
        i18n.global.t('字段“{value0}”不允许为空，默认值不能是 NULL', {
          value0: label,
        })
      )
    if (column.collation && !COLLATION_NAME.test(column.collation))
      fail(i18n.global.t('字段“{value0}”的排序规则不合法', { value0: label }))
    if (column.charset && !/^\w+$/u.test(column.charset))
      fail(i18n.global.t('字段“{value0}”的字符集不合法', { value0: label }))
    if (
      column.charset &&
      column.collation &&
      !column.collation.startsWith(`${column.charset}_`)
    )
      fail(i18n.global.t('排序规则必须属于所选字符集'))
    if (column.generatedExpression?.trim()) {
      if (UNSAFE_SQL_TOKEN.test(column.generatedExpression))
        fail(
          i18n.global.t('字段“{value0}”的生成表达式不能包含语句分隔符或注释', {
            value0: label,
          })
        )
      if (column.autoIncrement || column.defaultValue)
        fail(
          i18n.global.t('生成列“{value0}”不能同时设置默认值或自动递增', {
            value0: label,
          })
        )
    }
    if (column.autoIncrement) {
      autoIncrementCount += 1
      if (!INTEGER_TYPES.has(column.dataType))
        fail(
          i18n.global.t('字段“{value0}”只有整数类型才能自动递增', {
            value0: label,
          })
        )
      if (
        kind === 'mysql' &&
        !column.primaryKey &&
        !column.unique &&
        !draft.indexes.some(item => item.columns[0] === column.name)
      )
        fail(
          i18n.global.t('自动递增字段“{value0}”必须是主键或索引的第一列', {
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
    const fail = (message: string): void => {
      errors.push(message)
      ;(indexErrors[item.id] ??= []).push(message)
    }
    const label =
      item.name.trim() ||
      i18n.global.t('第 {value0} 个索引', { value0: index + 1 })
    const normalized = item.name.trim().toLocaleLowerCase()
    if (!item.name.trim())
      fail(i18n.global.t('第 {value0} 个索引缺少名称', { value0: index + 1 }))
    else if (indexNames.has(normalized))
      fail(i18n.global.t('索引“{value0}”重复', { value0: item.name }))
    else indexNames.add(normalized)
    if (!item.columns.length)
      fail(i18n.global.t('索引“{value0}”至少需要一个字段', { value0: label }))
    if (kind === 'mysql' && normalized === 'primary')
      fail(i18n.global.t('索引名不能使用保留名 PRIMARY'))
    if (
      new Set(item.columns.map(column => column.trim().toLowerCase())).size !==
      item.columns.length
    )
      fail(i18n.global.t('索引“{value0}”包含重复的字段', { value0: label }))
    const plainColumns = item.columns.filter(
      column => !item.columnOptions?.[column]?.expression
    )
    if (plainColumns.some(column => !columnNames.has(column)))
      fail(i18n.global.t('索引“{value0}”包含不存在的字段', { value0: label }))
    if (item.kind === 'fulltext' && kind !== 'mysql')
      fail(i18n.global.t('全文索引当前只支持 MySQL'))
    if (item.kind === 'spatial' && kind !== 'mysql')
      fail(i18n.global.t('空间索引当前只支持 MySQL'))
    if (item.kind === 'unique' && item.method === 'hash' && kind !== 'mysql')
      fail(i18n.global.t('PostgreSQL 的 HASH 索引不支持唯一约束'))
    if (item.kind === 'spatial' && item.columns.length !== 1)
      fail(i18n.global.t('空间索引“{value0}”只能包含一个字段', { value0: label }))
    if (item.predicate && UNSAFE_SQL_TOKEN.test(item.predicate))
      fail(
        i18n.global.t('索引“{value0}”的条件不能包含语句分隔符或注释', {
          value0: label,
        })
      )
    for (const column of item.columns) {
      const options = item.columnOptions?.[column]
      if (options?.expression && UNSAFE_SQL_TOKEN.test(column))
        fail(
          i18n.global.t('索引“{value0}”的表达式不能包含语句分隔符或注释', {
            value0: label,
          })
        )
      if (options?.prefix && !/^[1-9]\d*$/u.test(options.prefix))
        fail(
          i18n.global.t('索引“{value0}”的前缀长度必须是正整数', {
            value0: label,
          })
        )
      const stored = draft.columns.find(item => item.name === column)
      if (!stored || !kind.startsWith('mysql') || options?.expression) continue
      const traits = columnTypeTraits(stored.dataType, kind)
      if (item.kind === 'fulltext' && !traits.charset)
        fail(
          i18n.global.t('全文索引“{value0}”只能使用字符串字段', {
            value0: label,
          })
        )
      if (item.kind === 'spatial' && !traits.spatial)
        fail(
          i18n.global.t('空间索引“{value0}”只能使用空间类型字段', {
            value0: label,
          })
        )
      if (
        (item.kind === 'index' || item.kind === 'unique') &&
        traits.prefixRequired &&
        !options?.prefix
      )
        fail(
          i18n.global.t('索引“{value0}”的字段“{value1}”需要前缀长度', {
            value0: label,
            value1: column,
          })
        )
      if (
        options?.prefix &&
        /^\d+$/u.test(stored.length.trim()) &&
        Number(options.prefix) > Number(stored.length.trim())
      )
        fail(
          i18n.global.t('索引“{value0}”的前缀长度超过字段“{value1}”的长度', {
            value0: label,
            value1: column,
          })
        )
    }
  }

  const foreignKeyErrors: Record<string, string[]> = {}
  const foreignKeyNames = new Set<string>()
  for (const [index, foreignKey] of draft.foreignKeys.entries()) {
    const fail = (message: string): void => {
      errors.push(message)
      ;(foreignKeyErrors[foreignKey.id] ??= []).push(message)
    }
    const label =
      foreignKey.name.trim() ||
      i18n.global.t('第 {value0} 个外键', { value0: index + 1 })
    const normalized = foreignKey.name.trim().toLocaleLowerCase()
    if (!foreignKey.name.trim())
      fail(i18n.global.t('第 {value0} 个外键缺少名称', { value0: index + 1 }))
    else if (foreignKeyNames.has(normalized))
      fail(i18n.global.t('外键“{value0}”重复', { value0: foreignKey.name }))
    else foreignKeyNames.add(normalized)
    if (
      !foreignKey.columns.length ||
      foreignKey.columns.some(column => !column || !columnNames.has(column))
    )
      fail(i18n.global.t('外键“{value0}”缺少有效的本地字段', { value0: label }))
    if (
      !foreignKey.referencedSchema.trim() ||
      !foreignKey.referencedTable.trim() ||
      !foreignKey.referencedColumns.length ||
      foreignKey.referencedColumns.some(column => !column.trim())
    )
      fail(i18n.global.t('外键“{value0}”的引用目标不完整', { value0: label }))
    else if (foreignKey.referencedColumns.length !== foreignKey.columns.length)
      fail(
        i18n.global.t('外键“{value0}”的本地字段与引用字段数量不一致', {
          value0: label,
        })
      )
    if (new Set(foreignKey.columns).size !== foreignKey.columns.length)
      fail(i18n.global.t('外键“{value0}”包含重复的字段', { value0: label }))
    if (
      foreignKey.onDelete === 'SET NULL' &&
      foreignKey.columns.some(
        name => !draft.columns.find(column => column.name === name)?.nullable
      )
    )
      fail(
        i18n.global.t('外键“{value0}”使用 SET NULL 时本地字段必须允许 NULL', {
          value0: label,
        })
      )
  }

  const checkErrors: Record<string, string[]> = {}
  const checkNames = new Set<string>()
  for (const [index, check] of (draft.checks ?? []).entries()) {
    const fail = (message: string): void => {
      errors.push(message)
      ;(checkErrors[check.id] ??= []).push(message)
    }
    const label =
      check.name.trim() ||
      i18n.global.t('第 {value0} 个检查约束', { value0: index + 1 })
    const normalized = check.name.trim().toLocaleLowerCase()
    if (!check.name.trim())
      fail(
        i18n.global.t('第 {value0} 个检查约束缺少名称', { value0: index + 1 })
      )
    else if (checkNames.has(normalized) || foreignKeyNames.has(normalized))
      fail(i18n.global.t('约束名“{value0}”重复', { value0: check.name }))
    else checkNames.add(normalized)
    if (!check.expression.trim())
      fail(i18n.global.t('检查约束“{value0}”缺少表达式', { value0: label }))
    else if (UNSAFE_SQL_TOKEN.test(check.expression))
      fail(
        i18n.global.t('检查约束“{value0}”不能包含语句分隔符或注释', {
          value0: label,
        })
      )
  }

  const triggerErrors: Record<string, string[]> = {}
  const triggerNames = new Set<string>()
  for (const [index, trigger] of (draft.triggers ?? []).entries()) {
    const fail = (message: string): void => {
      errors.push(message)
      ;(triggerErrors[trigger.id] ??= []).push(message)
    }
    const label =
      trigger.name.trim() ||
      i18n.global.t('第 {value0} 个触发器', { value0: index + 1 })
    const normalized = trigger.name.trim().toLocaleLowerCase()
    if (!trigger.name.trim())
      fail(i18n.global.t('第 {value0} 个触发器缺少名称', { value0: index + 1 }))
    else if (triggerNames.has(normalized))
      fail(i18n.global.t('触发器“{value0}”重复', { value0: trigger.name }))
    else triggerNames.add(normalized)
    if (!trigger.events.length)
      fail(i18n.global.t('触发器“{value0}”至少需要一个事件', { value0: label }))
    if (kind !== 'postgresql' && trigger.events.length > 1)
      fail(
        i18n.global.t('触发器“{value0}”在当前数据库只能选择一个事件', {
          value0: label,
        })
      )
    if (
      trigger.events.includes('TRUNCATE') &&
      (kind !== 'postgresql' || trigger.level !== 'STATEMENT')
    )
      fail(
        i18n.global.t('触发器“{value0}”的 TRUNCATE 事件只支持 PostgreSQL 语句级触发器', {
          value0: label,
        })
      )
    if (!trigger.body.trim())
      fail(i18n.global.t('触发器“{value0}”缺少语句体', { value0: label }))
    if (kind === 'postgresql' && trigger.body.includes(TRIGGER_BODY_TAG))
      fail(
        i18n.global.t('触发器“{value0}”的函数体不能包含 {value1}', {
          value0: label,
          value1: TRIGGER_BODY_TAG,
        })
      )
    if (
      trigger.functionName?.trim() &&
      !/^[\w."$]+$/u.test(trigger.functionName.trim())
    )
      fail(
        i18n.global.t('触发器“{value0}”的函数名不合法', { value0: label })
      )
  }

  const partition = draft.partition
  if (partition?.method) {
    if (kind !== 'mysql') errors.push(i18n.global.t('表分区当前只支持 MySQL'))
    if (!partition.expression.trim())
      errors.push(i18n.global.t('分区表达式不能为空'))
    else if (UNSAFE_SQL_TOKEN.test(partition.expression))
      errors.push(i18n.global.t('分区表达式不能包含语句分隔符或注释'))
    if (partition.method === 'HASH' || partition.method === 'KEY') {
      if (!/^[1-9]\d*$/u.test(partition.count.trim()))
        errors.push(i18n.global.t('分区数必须是正整数'))
    } else {
      if (!partition.items.length)
        errors.push(i18n.global.t('RANGE / LIST 分区至少需要一个分区'))
      const partitionNames = new Set<string>()
      for (const item of partition.items) {
        const name = item.name.trim().toLowerCase()
        if (!name || !/^\w+$/u.test(name) || partitionNames.has(name))
          errors.push(
            i18n.global.t('分区名“{value0}”为空、不合法或重复', {
              value0: item.name,
            })
          )
        partitionNames.add(name)
        if (!item.value.trim() || UNSAFE_SQL_TOKEN.test(item.value))
          errors.push(
            i18n.global.t('分区“{value0}”的取值不合法', { value0: item.name })
          )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    columnErrors,
    indexErrors,
    foreignKeyErrors,
    checkErrors,
    triggerErrors,
  }
}

/** PostgreSQL 触发函数体的美元引号标记。 */
const TRIGGER_BODY_TAG = '$mh_trigger$'

/** 外键约束子句：多列外键按位置一一对应；SQLite 的 REFERENCES 不能带库名。 */
function renderForeignKey(
  foreignKey: TableDesignerForeignKey,
  kind: DatabaseKind
): string {
  const local = foreignKey.columns
    .map(column => quoteIdentifier(column, kind))
    .join(', ')
  const referenced = foreignKey.referencedColumns
    .map(column => quoteIdentifier(column, kind))
    .join(', ')
  const table =
    kind === 'sqlite'
      ? quoteIdentifier(foreignKey.referencedTable, kind)
      : qualifiedName(
          foreignKey.referencedSchema,
          foreignKey.referencedTable,
          kind
        )
  return `CONSTRAINT ${quoteIdentifier(foreignKey.name, kind)} FOREIGN KEY (${local}) REFERENCES ${table} (${referenced}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
}

/** 检查约束子句，建表内联与 ALTER ADD 共用。 */
function renderCheck(check: TableDesignerCheck, kind: DatabaseKind): string {
  return `CONSTRAINT ${quoteIdentifier(check.name, kind)} CHECK (${check.expression.trim()})`
}

/** PostgreSQL 触发器默认的函数名：表名_触发器名_fn，放在表所在 schema。 */
function triggerFunctionName(
  trigger: TableDesignerTrigger,
  schema: string,
  table: string
): string {
  return (
    trigger.functionName?.trim() ||
    qualifiedName(schema, `${table}_${trigger.name}_fn`, 'postgresql')
  )
}

/**
 * 生成创建触发器的语句（每项一条，语句体里的分号不再切分）。
 * MySQL 多条语句自动包 BEGIN…END；PostgreSQL 先建触发函数再挂触发器。
 */
function triggerCreateStatements(
  trigger: TableDesignerTrigger,
  kind: DatabaseKind,
  schema: string,
  table: string
): string[] {
  const target = qualifiedName(schema, table, kind)
  const name = quoteIdentifier(trigger.name, kind)
  const body = trigger.body.trim().replace(/;\s*$/u, '')
  if (kind === 'mysql') {
    const wrapped =
      /^begin\b/iu.test(body) || !body.includes(';')
        ? body
        : `BEGIN\n  ${body};\nEND`
    return [
      `CREATE TRIGGER ${name} ${trigger.timing} ${trigger.events[0]} ON ${target} FOR EACH ROW ${wrapped}`,
    ]
  }
  if (kind === 'sqlite') {
    return [
      `CREATE TRIGGER ${name} ${trigger.timing} ${trigger.events[0]} ON ${quoteIdentifier(table, kind)} FOR EACH ROW BEGIN\n  ${body};\nEND`,
    ]
  }
  const fn = triggerFunctionName(trigger, schema, table)
  return [
    `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS ${TRIGGER_BODY_TAG}\n${trigger.body.trim()}\n${TRIGGER_BODY_TAG}`,
    `CREATE TRIGGER ${name} ${trigger.timing} ${trigger.events.join(' OR ')} ON ${target} FOR EACH ${trigger.level} EXECUTE FUNCTION ${fn}()`,
  ]
}

/** 删除触发器语句；PostgreSQL 的触发函数另由 droppableTriggerFunctions 决定是否一并删除。 */
function triggerDropStatement(
  name: string,
  kind: DatabaseKind,
  schema: string,
  table: string
): string {
  if (kind === 'postgresql')
    return `DROP TRIGGER ${quoteIdentifier(name, kind)} ON ${qualifiedName(schema, table, kind)}`
  if (kind === 'sqlite') return `DROP TRIGGER ${quoteIdentifier(name, kind)}`
  return `DROP TRIGGER ${qualifiedName(schema, name, kind)}`
}

/** MySQL 建表的 PARTITION BY 子句；未配置分区时返回空串。 */
function renderPartition(draft: TableDesignerDraft): string {
  const partition = draft.partition
  if (!partition?.method) return ''
  const expression = partition.expression.trim()
  if (partition.method === 'HASH' || partition.method === 'KEY')
    return `\nPARTITION BY ${partition.method} (${expression}) PARTITIONS ${partition.count.trim()}`
  const items = partition.items.map(
    item => `  ${renderPartitionItem(partition.method === 'LIST' ? 'LIST' : 'RANGE', false, item)}`
  )
  return `\nPARTITION BY ${partition.method} (${expression}) (\n${items.join(',\n')}\n)`
}

/**
 * 单个 RANGE / LIST 分区定义，建表与已有表 ADD / REORGANIZE PARTITION 共用。
 * RANGE COLUMNS 的 MAXVALUE 必须写在括号里，普通 RANGE 写裸 MAXVALUE。
 */
function renderPartitionItem(
  family: 'RANGE' | 'LIST',
  columns: boolean,
  item: Pick<TableDesignerPartitionItem, 'name' | 'value'>
): string {
  const value = item.value.trim()
  const name = quoteIdentifier(item.name.trim(), 'mysql')
  if (family === 'LIST') return `PARTITION ${name} VALUES IN (${value})`
  if (/^maxvalue$/iu.test(value))
    return columns
      ? `PARTITION ${name} VALUES LESS THAN (MAXVALUE)`
      : `PARTITION ${name} VALUES LESS THAN MAXVALUE`
  return `PARTITION ${name} VALUES LESS THAN (${value})`
}

/** 已有分区表能在设计器里做哪些分区维护；actions 为空表示只读，reason 说明原因或限制。 */
export interface PartitionEditSupport {
  family: 'RANGE' | 'LIST' | 'HASH' | ''
  /** RANGE COLUMNS / LIST COLUMNS。 */
  columns: boolean
  actions: TablePartitionAction[]
  reason: string
}

/** 判断已有表的分区能否在设计器里维护：RANGE / LIST 支持全部操作，HASH / KEY 只能清空，子分区只读。 */
export function partitionEditSupport(
  kind: DatabaseKind,
  partition: DatabasePartitionInfo | null | undefined
): PartitionEditSupport {
  const readonly = (reason: string): PartitionEditSupport => ({
    family: '',
    columns: false,
    actions: [],
    reason,
  })
  if (kind !== 'mysql')
    return readonly(i18n.global.t('当前数据库暂不支持在设计器中维护分区'))
  if (!partition?.method || !partition.partitions.length)
    return readonly(
      i18n.global.t('当前表未分区；为已有表设置分区方式请在查询中执行 ALTER TABLE … PARTITION BY。')
    )
  // information_schema 每个子分区一行，分区名重复说明带子分区。
  const names = partition.partitions.map(item => item.name.toLowerCase())
  if (new Set(names).size !== names.length)
    return readonly(
      i18n.global.t('当前表包含子分区，暂不支持在此维护，请在查询中执行 ALTER TABLE … PARTITION。')
    )
  const method = partition.method.trim().toUpperCase()
  const columns = /\bCOLUMNS$/u.test(method)
  if (method === 'RANGE' || method === 'RANGE COLUMNS')
    return {
      family: 'RANGE',
      columns,
      actions: ['add', 'drop', 'truncate', 'reorganize'],
      reason: '',
    }
  if (method === 'LIST' || method === 'LIST COLUMNS')
    return {
      family: 'LIST',
      columns,
      actions: ['add', 'drop', 'truncate', 'reorganize'],
      reason: '',
    }
  if (/^(LINEAR )?(HASH|KEY)$/u.test(method))
    return {
      family: 'HASH',
      columns: false,
      actions: ['truncate'],
      reason: i18n.global.t(
        'HASH / KEY 分区在此只能清空分区；增减分区数请在查询中执行 ADD PARTITION PARTITIONS / COALESCE PARTITION。'
      ),
    }
  return readonly(
    i18n.global.t('分区方式 {value0} 暂不支持在此维护', { value0: partition.method })
  )
}

/** 分区维护操作对应的 SQL 关键字，用于错误提示与变更摘要。 */
function partitionActionKeyword(action: TablePartitionAction): string {
  return `${action.toUpperCase()} PARTITION`
}

/** RANGE 分区的边界是否为 MAXVALUE（RANGE COLUMNS 看第一列）。 */
function isMaxValueBound(description: string): boolean {
  return /^\(?\s*maxvalue\b/iu.test(description.trim())
}

/**
 * 把已有 MySQL 分区表的维护操作生成为独立语句（分区操作不能与其它 ALTER 子句合并）。
 * 顺序固定为 TRUNCATE → DROP → REORGANIZE → ADD；校验失败直接抛出说明。
 */
function partitionChangeStatements(
  kind: DatabaseKind,
  current: DatabaseTableDetail,
  changes: readonly TableDesignerPartitionChange[]
): string[] {
  if (!changes.length) return []
  const support = partitionEditSupport(kind, current.partition)
  const existing = current.partition?.partitions ?? []
  const positions = new Map(
    existing.map((item, index) => [item.name.toLowerCase(), index])
  )
  const target = qualifiedName(current.schema, current.name, kind)
  const quoted = (names: readonly string[]) =>
    names.map(name => quoteIdentifier(name, 'mysql')).join(', ')

  // 每个现有分区最多被一个操作引用，先收集所有引用再校验新分区名。
  const referenced = new Set<string>()
  const removed = new Set<string>()
  for (const change of changes) {
    const keyword = partitionActionKeyword(change.action)
    if (!support.actions.includes(change.action))
      throw new Error(
        support.reason ||
          i18n.global.t('当前分区方式不支持 {value0}', { value0: keyword })
      )
    if (change.action === 'add') continue
    if (!change.partitions.length)
      throw new Error(
        i18n.global.t('{value0} 需要选择至少一个分区', { value0: keyword })
      )
    for (const name of change.partitions) {
      const key = name.toLowerCase()
      if (!positions.has(key))
        throw new Error(i18n.global.t('分区“{value0}”不存在', { value0: name }))
      if (referenced.has(key))
        throw new Error(
          i18n.global.t('分区“{value0}”被多个分区操作引用', { value0: name })
        )
      referenced.add(key)
      if (change.action !== 'truncate') removed.add(key)
    }
    if (change.action === 'reorganize' && support.family === 'RANGE') {
      const sorted = change.partitions
        .map(name => positions.get(name.toLowerCase())!)
        .sort((left, right) => left - right)
      if (sorted.some((value, index) => index > 0 && value !== sorted[index - 1] + 1))
        throw new Error(i18n.global.t('RANGE 分区只能重组相邻的分区'))
    }
  }

  const dropped = changes
    .filter(change => change.action === 'drop')
    .flatMap(change => change.partitions)
  if (dropped.length && dropped.length >= existing.length)
    throw new Error(
      i18n.global.t('不能删除全部分区；取消分区请在查询中执行 ALTER TABLE … REMOVE PARTITIONING。')
    )

  // 新分区名不能与保留下来的分区或彼此重复；重组可以沿用被重组分区的名字。
  const names = new Set(
    existing
      .map(item => item.name.toLowerCase())
      .filter(name => !removed.has(name))
  )
  for (const change of changes) {
    if (change.action !== 'add' && change.action !== 'reorganize') continue
    if (!change.items.length)
      throw new Error(
        i18n.global.t('{value0} 至少需要一个新分区', {
          value0: partitionActionKeyword(change.action),
        })
      )
    for (const item of change.items) {
      const name = item.name.trim().toLowerCase()
      if (!name || !/^\w+$/u.test(name) || names.has(name))
        throw new Error(
          i18n.global.t('分区名“{value0}”为空、不合法或重复', {
            value0: item.name,
          })
        )
      names.add(name)
      if (!item.value.trim() || UNSAFE_SQL_TOKEN.test(item.value))
        throw new Error(
          i18n.global.t('分区“{value0}”的取值不合法', { value0: item.name })
        )
    }
  }

  // RANGE 只能在末尾追加；末尾是 MAXVALUE 且未被删除或重组时只能改用重组。
  const last = existing.at(-1)
  if (
    support.family === 'RANGE' &&
    changes.some(change => change.action === 'add') &&
    last &&
    !removed.has(last.name.toLowerCase()) &&
    isMaxValueBound(last.description)
  )
    throw new Error(
      i18n.global.t('最后一个分区是 MAXVALUE，无法追加 RANGE 分区；请改用重组分区拆分“{value0}”。', {
        value0: last.name,
      })
    )

  const family = support.family === 'LIST' ? 'LIST' : 'RANGE'
  const definitions = (items: readonly TableDesignerPartitionItem[]) =>
    items
      .map(item => `  ${renderPartitionItem(family, support.columns, item)}`)
      .join(',\n')
  const order: TablePartitionAction[] = ['truncate', 'drop', 'reorganize', 'add']
  return order.flatMap(action =>
    changes
      .filter(change => change.action === action)
      .map(change => {
        if (action === 'truncate')
          return `ALTER TABLE ${target} TRUNCATE PARTITION ${quoted(change.partitions)}`
        if (action === 'drop')
          return `ALTER TABLE ${target} DROP PARTITION ${quoted(change.partitions)}`
        if (action === 'reorganize')
          return `ALTER TABLE ${target} REORGANIZE PARTITION ${quoted(change.partitions)} INTO (\n${definitions(change.items)}\n)`
        return `ALTER TABLE ${target} ADD PARTITION (\n${definitions(change.items)}\n)`
      })
  )
}

export function buildCreateTableSql(options: TableDesignerOptions): string {
  return buildCreateTableStatements(options)
    .map(statement => `${statement};`)
    .join('\n\n')
}

/** 建表语句逐条返回（不带结尾分号），设计器按条执行，触发器体不会被误切。 */
export function buildCreateTableStatements({
  kind,
  draft,
  extraTypes,
}: TableDesignerOptions): string[] {
  const validation = validateTableDraft({ kind, draft, extraTypes })
  if (!validation.valid) throw new Error(validation.errors[0])

  const table = qualifiedName(draft.schema, draft.name, kind)
  const definitions = draft.columns.map(column => renderColumn(column, kind))
  const primaryColumns = primaryKeyColumns(draft.columns).map(column =>
    quoteIdentifier(column.name, kind)
  )
  if (primaryColumns.length)
    definitions.push(`  PRIMARY KEY (${primaryColumns.join(', ')})`)

  if (kind === 'mysql') {
    for (const index of draft.indexes)
      definitions.push(`  ${mysqlIndexDefinition(index, 'KEY')}`)
  }

  for (const foreignKey of draft.foreignKeys)
    definitions.push(`  ${renderForeignKey(foreignKey, kind)}`)
  for (const check of draft.checks ?? [])
    definitions.push(`  ${renderCheck(check, kind)}`)

  const suffix =
    kind === 'mysql'
      ? ` ENGINE=${safeOption(draft.engine || 'InnoDB')} DEFAULT CHARSET=${safeOption(draft.charset || 'utf8mb4')}${draft.collation ? ` COLLATE=${safeOption(draft.collation)}` : ''}${draft.rowFormat ? ` ROW_FORMAT=${safeOption(draft.rowFormat)}` : ''}${draft.autoIncrement != null ? ` AUTO_INCREMENT=${draft.autoIncrement}` : ''}${draft.comment ? ` COMMENT=${quoteLiteral(draft.comment, kind)}` : ''}${renderPartition(draft)}`
      : ''
  const statements = [
    `CREATE TABLE ${table} (\n${definitions.join(',\n')}\n)${suffix}`,
  ]

  if (kind === 'postgresql') {
    if (draft.autoIncrement != null) {
      const column = draft.columns.find(column => column.autoIncrement)!
      statements.push(
        `ALTER TABLE ${table} ALTER COLUMN ${quoteIdentifier(column.name, kind)} RESTART WITH ${draft.autoIncrement}`
      )
    }
    for (const index of draft.indexes)
      statements.push(
        ...postgresqlIndexStatements(index, table, draft.schema)
      )
    if (draft.comment)
      statements.push(
        `COMMENT ON TABLE ${table} IS ${quoteLiteral(draft.comment, kind)}`
      )
    for (const column of draft.columns) {
      if (column.comment)
        statements.push(
          `COMMENT ON COLUMN ${table}.${quoteIdentifier(column.name, kind)} IS ${quoteLiteral(column.comment, kind)}`
        )
    }
  }
  for (const trigger of draft.triggers ?? [])
    statements.push(
      ...triggerCreateStatements(trigger, kind, draft.schema, draft.name)
    )

  return statements
}

function lengthSuffix(column: TableDesignerColumn, kind: DatabaseKind): string {
  const length = column.length.trim()
  if (!length) return ''
  // 枚举值里的空格是数据的一部分，不能像 "10, 2" 那样压掉。
  return columnTypeTraits(column.dataType, kind).enumerated
    ? `(${length})`
    : `(${length.replace(/\s+/gu, '')})`
}

function renderDataType(column: TableDesignerColumn, kind: DatabaseKind): string {
  const length = lengthSuffix(column, kind)
  const type = column.dataType
  // 这个写法的精度要放在 TIMESTAMP 后面：TIMESTAMP(3) WITH TIME ZONE。
  return type.endsWith(' WITH TIME ZONE')
    ? type.replace(' WITH TIME ZONE', `${length} WITH TIME ZONE`)
    : `${type}${length}`
}

function renderCollation(
  column: TableDesignerColumn,
  kind: DatabaseKind
): string {
  const collation = column.collation?.trim()
  if (kind === 'mysql') {
    const charset = column.charset?.trim()
    return `${charset ? ` CHARACTER SET ${safeOption(charset)}` : ''}${collation ? ` COLLATE ${safeOption(collation)}` : ''}`
  }
  return collation ? ` COLLATE ${quoteIdentifier(collation, kind)}` : ''
}

function renderColumn(
  column: TableDesignerColumn,
  kind: DatabaseKind,
  { inlineUnique = true }: { inlineUnique?: boolean } = {}
): string {
  const mysql = kind === 'mysql'
  const expression = column.generatedExpression?.trim()
  const generated = expression
    ? ` GENERATED ALWAYS AS (${expression}) ${!mysql || column.generatedStored ? 'STORED' : 'VIRTUAL'}`
    : ''
  const unsigned = mysql && column.unsigned ? ' UNSIGNED' : ''
  const zerofill = mysql && column.zerofill ? ' ZEROFILL' : ''
  const identity =
    column.autoIncrement && !expression
      ? mysql
        ? ' AUTO_INCREMENT'
        : ' GENERATED BY DEFAULT AS IDENTITY'
      : ''
  const nullable = column.primaryKey || !column.nullable ? ' NOT NULL' : ' NULL'
  const defaultValue =
    column.defaultValue && !column.autoIncrement && !expression
      ? ` DEFAULT ${column.defaultValue}`
      : ''
  const onUpdate =
    mysql && column.onUpdateCurrentTimestamp && !expression
      ? ` ON UPDATE CURRENT_TIMESTAMP${lengthSuffix(column, kind)}`
      : ''
  const unique =
    inlineUnique && column.unique && !column.primaryKey ? ' UNIQUE' : ''
  const comment =
    mysql && column.comment
      ? ` COMMENT ${quoteLiteral(column.comment, kind)}`
      : ''
  return `  ${quoteIdentifier(column.name, kind)} ${renderDataType(column, kind)}${unsigned}${zerofill}${renderCollation(column, kind)}${generated}${identity}${nullable}${defaultValue}${onUpdate}${unique}${comment}`
}

/** 索引项列表：字段名带前缀 / 方向，表达式加括号。 */
function renderIndexColumns(
  index: TableDesignerIndex,
  kind: DatabaseKind
): string {
  const ordered = index.kind === 'index' || index.kind === 'unique'
  return index.columns
    .map(column => {
      const options = index.columnOptions?.[column]
      const target = options?.expression
        ? `(${column})`
        : quoteIdentifier(column, kind)
      const prefix =
        kind === 'mysql' && ordered && options?.prefix && !options.expression
          ? `(${options.prefix})`
          : ''
      return `${target}${prefix}${ordered && options?.descending ? ' DESC' : ''}`
    })
    .join(', ')
}

function mysqlIndexDefinition(
  index: TableDesignerIndex,
  keyword: 'KEY' | 'INDEX'
): string {
  const prefix =
    index.kind === 'unique'
      ? `UNIQUE ${keyword}`
      : index.kind === 'fulltext'
        ? `FULLTEXT ${keyword}`
        : index.kind === 'spatial'
          ? `SPATIAL ${keyword}`
          : keyword
  const method =
    index.kind === 'index' || index.kind === 'unique'
      ? ` USING ${index.method.toUpperCase()}`
      : ''
  const comment = index.comment
    ? ` COMMENT ${quoteLiteral(index.comment, 'mysql')}`
    : ''
  return `${prefix} ${quoteIdentifier(index.name, 'mysql')} (${renderIndexColumns(index, 'mysql')})${method}${comment}`
}

function postgresqlIndexStatements(
  index: TableDesignerIndex,
  table: string,
  schema: string
): string[] {
  const unique = index.kind === 'unique' ? 'UNIQUE ' : ''
  const predicate = index.predicate?.trim()
  const statements = [
    `CREATE ${unique}INDEX ${quoteIdentifier(index.name, 'postgresql')} ON ${table} USING ${index.method} (${renderIndexColumns(index, 'postgresql')})${predicate ? ` WHERE ${predicate}` : ''}`,
  ]
  if (index.comment)
    statements.push(postgresqlIndexComment(index, schema))
  return statements
}

function postgresqlIndexComment(
  index: TableDesignerIndex,
  schema: string
): string {
  return `COMMENT ON INDEX ${qualifiedName(schema, index.name, 'postgresql')} IS ${index.comment ? quoteLiteral(index.comment, 'postgresql') : 'NULL'}`
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
    // 枚举值里可以出现括号，所以取到最后一个右括号。
    const match = /^([^()]+?)(?:\s*\((.*)\))?$/su.exec(core)
    return {
      base: (match?.[1] ?? core).trim().toLowerCase(),
      length: (match?.[2] ?? '').trim(),
      unsigned,
    }
  }
  // PostgreSQL: "character varying(255)" / "timestamp with time zone" / "integer"
  const trimmed = fullType.trim()
  // 精度可能夹在中间："timestamp(3) with time zone"。
  const match = /^([^()]+?)(?:\s*\(([^()]*)\))?(\s+[^()]+)?$/u.exec(trimmed)
  const raw = `${match?.[1] ?? trimmed}${match?.[3] ?? ''}`.trim().toLowerCase()
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

function draftTypeParsed(
  column: TableDesignerColumn,
  kind: DatabaseKind
): ParsedType {
  const base = column.dataType.trim().toLowerCase()
  const enumerated = columnTypeTraits(column.dataType, kind).enumerated
  return {
    base: kind === 'mysql' ? base : (PG_TYPE_ALIASES[base] ?? base),
    length: enumerated
      ? column.length.trim()
      : column.length.replace(/\s+/gu, ''),
    unsigned: column.unsigned,
  }
}

/** information_schema 返回的默认值 → 设计器里的 SQL 表达式。 */
function storedDefault(column: DatabaseColumn, kind: DatabaseKind): string {
  const value = column.defaultValue
  if (value == null) return ''
  if (kind !== 'mysql') return value
  // MariaDB 把 NULL 和字面量的引号都带回来；MySQL 的字符串默认值不带引号。
  if (/^null$/iu.test(value)) return ''
  if (/^(?:current_timestamp|now|localtime)/iu.test(value))
    return value.toUpperCase()
  if (SQL_STRING_LITERAL.test(value) || /^b'[01]*'$/iu.test(value)) return value
  if (column.defaultIsExpression) return `(${value})`
  const traits = columnTypeTraits(parseStoredType(column.dataType, kind).base, kind)
  const numeric = traits.unsigned || /^(?:bit|year)$/iu.test(column.dataType)
  return numeric ? value : quoteLiteral(value, kind)
}

/** MySQL 的 GENERATION_EXPRESSION 把引号转义过，原样写回会语法错误。 */
function storedGeneratedExpression(
  column: DatabaseColumn,
  kind: DatabaseKind
): string {
  const expression = column.generatedExpression?.trim() ?? ''
  return kind === 'mysql' ? expression.replaceAll("\\'", "'") : expression
}

/** 与表默认一致的排序规则留空，这样改表字符集时字段不会被钉死。 */
function storedCollation(
  column: DatabaseColumn,
  options: DatabaseTableOptions | null | undefined
): { charset: string; collation: string } {
  const collation = column.collation ?? ''
  if (!collation || collation === options?.collation)
    return { charset: '', collation: '' }
  return { charset: column.charset ?? '', collation }
}

export function designerColumnFromStored(
  column: DatabaseColumn,
  kind: DatabaseKind,
  detail: Pick<DatabaseTableDetail, 'options' | 'primaryKey'>,
  id: string
): TableDesignerColumn {
  const parsed = parseStoredType(column.dataType, kind)
  const primaryKeyOrder = detail.primaryKey.findIndex(
    name => name.toLowerCase() === column.name.toLowerCase()
  )
  return {
    id,
    originalName: column.name,
    name: column.name,
    dataType: normalizeDataTypeLabel(column.dataType, kind),
    length: parsed.length,
    nullable: column.nullable,
    primaryKey: column.primaryKey,
    primaryKeyOrder: primaryKeyOrder < 0 ? undefined : primaryKeyOrder,
    // 编辑时已有唯一约束统一走索引管理，避免 MySQL MODIFY 无法移除内联唯一索引。
    unique: false,
    unsigned: parsed.unsigned,
    zerofill: /\bzerofill\b/iu.test(column.dataType),
    autoIncrement: column.autoIncrement,
    defaultValue: storedDefault(column, kind),
    comment: column.comment ?? '',
    ...storedCollation(column, detail.options),
    onUpdateCurrentTimestamp: Boolean(column.onUpdateCurrentTimestamp),
    generatedExpression: storedGeneratedExpression(column, kind),
    generatedStored: Boolean(column.generatedStored),
  }
}

function storedIndexParts(index: DatabaseIndex) {
  return (
    index.parts ??
    index.columns.map(column => ({
      column,
      subPart: index.subPart,
      descending: false,
      expression: false,
      included: false,
    }))
  )
}

function storedIndexKind(index: DatabaseIndex): TableDesignerIndex['kind'] {
  const type = index.indexType?.toUpperCase()
  if (type === 'FULLTEXT') return 'fulltext'
  if (type === 'SPATIAL') return 'spatial'
  return index.unique ? 'unique' : 'index'
}

function storedIndexMethod(index: DatabaseIndex): string {
  return /^(?:FULLTEXT|SPATIAL)$/iu.test(index.indexType ?? '')
    ? 'btree'
    : (index.indexType ?? 'btree').toLowerCase()
}

/**
 * 编辑器能否完整表示这个索引。不能表示的（MySQL 函数索引、INCLUDE 列、
 * 第三方索引方法）不进草稿，差异生成也不碰，保持原样。
 */
function representableIndex(
  index: DatabaseIndex,
  columns: readonly DatabaseColumn[],
  kind: DatabaseKind
): boolean {
  if (!index.parts && index.subPart != null) return false
  const names = new Set(columns.map(column => column.name.toLowerCase()))
  const methods: readonly string[] = indexMethods(kind)
  return (
    methods.includes(storedIndexMethod(index)) &&
    storedIndexParts(index).every(
      part =>
        !part.included &&
        (part.expression || names.has(part.column.toLowerCase()))
    )
  )
}

export function designerIndexFromStored(
  index: DatabaseIndex,
  columns: readonly DatabaseColumn[],
  kind: DatabaseKind,
  id: string
): TableDesignerIndex | null {
  if (index.primary || !representableIndex(index, columns, kind)) return null
  const parts = storedIndexParts(index)
  return {
    id,
    name: index.name,
    kind: storedIndexKind(index),
    method: storedIndexMethod(index) as TableIndexMethod,
    columns: parts.map(part => part.column),
    columnOptions: Object.fromEntries(
      parts.map(part => [
        part.column,
        {
          prefix: part.subPart == null ? '' : String(part.subPart),
          descending: part.descending,
          expression: part.expression,
        },
      ])
    ),
    comment: index.comment ?? '',
    predicate: index.predicate ?? '',
  }
}

function normalizeDefault(value: string | null): string {
  if (value == null) return ''
  const trimmed = value.trim()
  // 字面量的大小写是数据；数字默认值带不带引号在库里没有区别。
  if (SQL_STRING_LITERAL.test(trimmed)) return trimmed.slice(1, -1)
  let normalized = trimmed.toLowerCase()
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

/** 除注释外，索引定义是否变化；旧字段名先按改名表映射成新字段名。 */
function indexDefinitionChanged(
  current: DatabaseIndex,
  draft: TableDesignerIndex,
  renames: ReadonlyMap<string, string>
): boolean {
  const parts = storedIndexParts(current)
  if (
    storedIndexKind(current) !== draft.kind ||
    parts.length !== draft.columns.length ||
    (current.predicate ?? '').trim() !== (draft.predicate ?? '').trim()
  )
    return true
  if (
    current.indexType &&
    draft.kind !== 'fulltext' &&
    draft.kind !== 'spatial' &&
    storedIndexMethod(current) !== draft.method
  )
    return true
  return parts.some((part, position) => {
    const name = part.expression
      ? part.column
      : (renames.get(part.column.toLowerCase()) ?? part.column)
    const column = draft.columns[position]
    const options = draft.columnOptions?.[column]
    return (
      name.toLowerCase() !== column.toLowerCase() ||
      Boolean(part.descending) !== Boolean(options?.descending) ||
      (part.subPart == null ? '' : String(part.subPart)) !==
        (options?.prefix ?? '')
    )
  })
}

/** 按原位置求最长递增子序列：这些字段不用动，其余字段才需要 FIRST / AFTER。 */
function stableColumnIndexes(positions: readonly number[]): Set<number> {
  const lengths = positions.map(() => 1)
  const previous = positions.map(() => -1)
  let best = -1
  for (const [index, position] of positions.entries()) {
    for (let before = 0; before < index; before += 1) {
      if (
        positions[before] < position &&
        lengths[before] + 1 > lengths[index]
      ) {
        lengths[index] = lengths[before] + 1
        previous[index] = before
      }
    }
    if (best < 0 || lengths[index] > lengths[best]) best = index
  }
  const stable = new Set<number>()
  for (let cursor = best; cursor >= 0; cursor = previous[cursor])
    stable.add(cursor)
  return stable
}

/** 外键定义是否变化（含多列顺序）；本地字段先按改名表映射成新名再比。 */
function foreignKeyChanged(
  current: DatabaseForeignKey,
  draft: TableDesignerForeignKey,
  renames: ReadonlyMap<string, string> = new Map()
): boolean {
  const localColumns = current.columns.map(
    column => renames.get(column.toLowerCase()) ?? column
  )
  const sameList = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length &&
    left.every(
      (value, index) =>
        value.trim().toLowerCase() === (right[index] ?? '').trim().toLowerCase()
    )
  return (
    !sameList(localColumns, draft.columns) ||
    current.referencedSchema.trim().toLowerCase() !==
      draft.referencedSchema.trim().toLowerCase() ||
    current.referencedTable.trim().toLowerCase() !==
      draft.referencedTable.trim().toLowerCase() ||
    !sameList(current.referencedColumns, draft.referencedColumns) ||
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
export function buildAlterTableSql(spec: TableAlterSpec): string {
  return buildAlterTableStatements(spec).join('\n\n')
}

/** 同 buildAlterTableSql，但逐条返回语句，供设计器在事务里按条执行。 */
export function buildAlterTableStatements({
  kind,
  current,
  draft,
  extraTypes,
}: TableAlterSpec): string[] {
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
  // 优先按 originalName 匹配：这样改名不会变成删列再加列而丢数据。
  const matchedColumns = new Map<string, TableDesignerColumn>()
  for (const column of draft.columns) {
    if (column.originalName)
      matchedColumns.set(column.originalName.toLowerCase(), column)
  }
  for (const column of draft.columns) {
    const key = column.name.toLowerCase()
    if (
      !column.originalName &&
      currentColumns.has(key) &&
      !matchedColumns.has(key)
    )
      matchedColumns.set(key, column)
  }
  const storedColumns = new Map(
    [...matchedColumns].flatMap(([key, column]) => {
      const stored = currentColumns.get(key)
      return stored ? [[column, stored] as const] : []
    })
  )
  const renames = new Map(
    [...storedColumns]
      .filter(([column, stored]) => column.name !== stored.name)
      .map(([column, stored]) => [stored.name.toLowerCase(), column.name])
  )

  // 外键：先 DROP（改列前必须先解除引用），再 ADD。
  // 因变化被 DROP 的外键要在下面重建，所以记录下来避免 ADD 循环跳过。
  const droppedForeignKeyNames = new Set<string>()
  for (const foreignKey of current.foreignKeys) {
    const draftForeignKey = draft.foreignKeys.find(
      item => item.name.toLowerCase() === foreignKey.name.toLowerCase()
    )
    if (draftForeignKey) {
      if (!foreignKeyChanged(foreignKey, draftForeignKey, renames)) continue
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

  // 索引：主键单独处理；无法表示的索引保持原样不删。
  const droppedIndexNames = new Set<string>()
  const indexComments: string[] = []
  for (const index of current.indexes) {
    if (index.primary || !representableIndex(index, current.columns, kind))
      continue
    const draftIndex = draft.indexes.find(
      item => item.name.toLowerCase() === index.name.toLowerCase()
    )
    if (draftIndex && !indexDefinitionChanged(index, draftIndex, renames)) {
      if ((index.comment ?? '') === (draftIndex.comment ?? '')) continue
      // PostgreSQL 的索引注释可以单独改，不用重建。
      if (kind === 'postgresql') {
        indexComments.push(postgresqlIndexComment(draftIndex, current.schema))
        continue
      }
    }
    droppedIndexNames.add(index.name.toLowerCase())
    if (kind === 'mysql')
      mainClauses.push(`DROP INDEX ${quoteIdentifier(index.name, kind)}`)
    else if (index.constraintBacked)
      pgStatements.push(
        `ALTER TABLE ${target} DROP CONSTRAINT ${quoteIdentifier(index.name, kind)}`
      )
    else
      pgStatements.push(
        `DROP INDEX ${qualifiedName(current.schema, index.name, kind)}`
      )
  }

  // 主键差异。草稿带主键顺序时顺序也算差异，否则只比集合。
  const currentPrimaryKey = current.primaryKey.map(
    column => renames.get(column.toLowerCase()) ?? column
  )
  const draftPrimaryColumns = primaryKeyColumns(draft.columns)
  const draftPrimaryKey = draftPrimaryColumns.map(column => column.name)
  const ordered = draftPrimaryColumns.some(
    column => column.primaryKeyOrder != null
  )
  const lowerCased = (names: string[]): string[] =>
    names.map(name => name.toLowerCase())
  const primaryKeyChanged = ordered
    ? lowerCased(currentPrimaryKey).join('\0') !==
      lowerCased(draftPrimaryKey).join('\0')
    : !sameColumns(lowerCased(currentPrimaryKey), lowerCased(draftPrimaryKey))
  const primaryKeySql = draftPrimaryKey
    .map(column => quoteIdentifier(column, kind))
    .join(', ')
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
    if (draftPrimaryKey.length && kind === 'mysql')
      mainClauses.push(`ADD PRIMARY KEY (${primaryKeySql})`)
  }

  // 字段差异。
  for (const [key, currentColumn] of currentColumns) {
    if (matchedColumns.has(key)) continue
    if (kind === 'mysql')
      mainClauses.push(
        `DROP COLUMN ${quoteIdentifier(currentColumn.name, kind)}`
      )
    else
      pgStatements.push(
        `ALTER TABLE ${target} DROP COLUMN ${quoteIdentifier(currentColumn.name, kind)}`
      )
  }

  // MySQL 的 AFTER 在同一条 ALTER 里按子句顺序解析，所以按最终字段顺序输出。
  const keptColumns = draft.columns.filter(column => storedColumns.has(column))
  const stableIndexes = stableColumnIndexes(
    keptColumns.map(column => storedColumns.get(column)!.ordinal)
  )
  const stableColumns = new Set(
    keptColumns.filter((_, index) => stableIndexes.has(index))
  )
  const lastKeptIndex = draft.columns.reduce(
    (last, column, index) => (storedColumns.has(column) ? index : last),
    -1
  )
  const newUniqueColumns: TableDesignerColumn[] = []
  for (const [position, draftColumn] of draft.columns.entries()) {
    const placement =
      position === 0
        ? ' FIRST'
        : ` AFTER ${quoteIdentifier(draft.columns[position - 1].name, kind)}`
    const currentColumn = storedColumns.get(draftColumn)
    if (!currentColumn) {
      const definition = renderColumn(draftColumn, kind).trim()
      if (kind === 'mysql')
        mainClauses.push(
          `ADD COLUMN ${definition}${position < lastKeptIndex ? placement : ''}`
        )
      else pgStatements.push(`ALTER TABLE ${target} ADD COLUMN ${definition}`)
      continue
    }
    if (draftColumn.unique && !draftColumn.primaryKey)
      newUniqueColumns.push(draftColumn)
    const renamed = currentColumn.name !== draftColumn.name
    const moved = kind === 'mysql' && !stableColumns.has(draftColumn)
    const changed = columnChanged(currentColumn, draftColumn, kind, current)
    if (kind === 'mysql') {
      if (!renamed && !moved && !changed) continue
      const definition = renderColumn(draftColumn, kind, {
        inlineUnique: false,
      }).trim()
      mainClauses.push(
        `${renamed ? `CHANGE COLUMN ${quoteIdentifier(currentColumn.name, kind)}` : 'MODIFY COLUMN'} ${definition}${moved ? placement : ''}`
      )
    } else {
      if (renamed)
        pgStatements.push(
          `ALTER TABLE ${target} RENAME COLUMN ${quoteIdentifier(currentColumn.name, kind)} TO ${quoteIdentifier(draftColumn.name, kind)}`
        )
      if (changed)
        pgStatements.push(
          ...postgresqlColumnAlter(target, currentColumn, draftColumn, current)
        )
    }
  }
  if (primaryKeyChanged && draftPrimaryKey.length && kind !== 'mysql')
    pgStatements.push(`ALTER TABLE ${target} ADD PRIMARY KEY (${primaryKeySql})`)

  // 已有字段新勾选唯一：字段定义里写 UNIQUE 不可重入，走显式索引。
  for (const column of newUniqueColumns) {
    const name = quoteIdentifier(`uq_${draft.name}_${column.name}`, kind)
    const quoted = quoteIdentifier(column.name, kind)
    if (kind === 'mysql') mainClauses.push(`ADD UNIQUE INDEX ${name} (${quoted})`)
    else pgStatements.push(`CREATE UNIQUE INDEX ${name} ON ${target} (${quoted})`)
  }

  // 新增索引。定义变化被 DROP 的索引也在这里重建。
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
    if (kind === 'mysql')
      mainClauses.push(`ADD ${mysqlIndexDefinition(index, 'INDEX')}`)
    else
      pgStatements.push(
        ...postgresqlIndexStatements(index, target, current.schema)
      )
  }
  pgStatements.push(...indexComments)

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
    const constraint = renderForeignKey(foreignKey, kind)
    if (kind === 'mysql') mainClauses.push(`ADD ${constraint}`)
    else pgStatements.push(`ALTER TABLE ${target} ADD ${constraint}`)
  }

  // 检查约束与触发器：删除放在主 ALTER 之前（解除对字段的引用），新增放在之后。
  // 草稿没带 checks / triggers（旧调用方）时不碰库里已有的对象。
  const preStatements: string[] = []
  const postStatements: string[] = []
  let sqliteChecksChanged = false
  if (draft.checks && current.checks) {
    const draftChecks = new Map(
      draft.checks.map(check => [check.name.trim().toLowerCase(), check])
    )
    const storedChecks = new Map(
      current.checks.map(check => [check.name.toLowerCase(), check])
    )
    const sameExpression = sameCheckExpression
    for (const [key, stored] of storedChecks) {
      const next = draftChecks.get(key)
      if (next && sameExpression(next.expression, stored.expression)) continue
      // SQLite 改检查约束只能重建表，统一在最后生成重建语句。
      if (kind === 'sqlite') {
        sqliteChecksChanged = true
        continue
      }
      preStatements.push(
        `ALTER TABLE ${target} ${kind === 'mysql' ? 'DROP CHECK' : 'DROP CONSTRAINT'} ${quoteIdentifier(stored.name, kind)}`
      )
    }
    for (const [key, check] of draftChecks) {
      const stored = storedChecks.get(key)
      if (stored && sameExpression(check.expression, stored.expression))
        continue
      if (kind === 'sqlite') {
        sqliteChecksChanged = true
        continue
      }
      postStatements.push(`ALTER TABLE ${target} ADD ${renderCheck(check, kind)}`)
    }
  }
  if (draft.triggers && current.triggers) {
    const storedTriggers = new Map(
      current.triggers.map(trigger => [trigger.name.toLowerCase(), trigger])
    )
    for (const [key, stored] of storedTriggers) {
      const next = draft.triggers.find(
        trigger => trigger.name.trim().toLowerCase() === key
      )
      if (next && !triggerChanged(stored, next)) continue
      preStatements.push(
        triggerDropStatement(stored.name, kind, current.schema, current.name)
      )
    }
    // 专属触发函数默认随触发器删除，用户在设计器里取消勾选的保留。
    const keep = new Set(draft.keepTriggerFunctions ?? [])
    for (const item of droppableTriggerFunctions(kind, current, draft))
      if (!keep.has(item.function))
        preStatements.push(`DROP FUNCTION IF EXISTS ${item.function}()`)
    for (const trigger of draft.triggers) {
      const stored = storedTriggers.get(trigger.name.trim().toLowerCase())
      if (stored && !triggerChanged(stored, trigger)) continue
      postStatements.push(
        ...triggerCreateStatements(trigger, kind, current.schema, current.name)
      )
    }
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
  statements.unshift(...preStatements)
  statements.push(...postStatements)
  // 分区维护不能与其它子句合并，逐条放在结构修改之后、改名之前。
  statements.push(
    ...partitionChangeStatements(kind, current, draft.partitionChanges ?? [])
  )
  // SQLite 重建表会原样重建索引与触发器，不能和其它结构修改混在同一次保存里。
  if (sqliteChecksChanged) {
    if (statements.length)
      throw new Error(
        i18n.global.t('SQLite 需要重建表才能修改检查约束，请先单独保存字段、索引、外键或触发器的修改')
      )
    statements.push(
      ...sqliteCheckRebuildStatements(current, draft.checks ?? [])
    )
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

  return statements
}

/**
 * 找出本次删除的 PostgreSQL 触发器中，触发函数只被它使用、且草稿里没有别的触发器再引用的那些。
 * 设计器据此展示“同时删除触发器函数”勾选项，ALTER 生成据此追加 DROP FUNCTION。
 */
export function droppableTriggerFunctions(
  kind: DatabaseKind,
  current: Pick<DatabaseTableDetail, 'triggers'> | null,
  draft: Pick<TableDesignerDraft, 'triggers'>
): { trigger: string; function: string }[] {
  if (kind !== 'postgresql' || !current?.triggers || !draft.triggers) return []
  const draftNames = new Set(
    draft.triggers.map(trigger => trigger.name.trim().toLowerCase())
  )
  const referenced = new Set(
    draft.triggers.map(trigger => (trigger.functionName ?? '').trim())
  )
  return current.triggers
    .filter(
      stored =>
        stored.functionExclusive &&
        stored.function &&
        !draftNames.has(stored.name.toLowerCase()) &&
        !referenced.has(stored.function)
    )
    .map(stored => ({ trigger: stored.name, function: stored.function }))
}

/** 判断库中触发器与草稿是否不同（时机、事件、级别、语句体、函数名），不同则需删除重建。 */
function triggerChanged(
  stored: DatabaseTrigger,
  draft: TableDesignerTrigger
): boolean {
  const squash = (value: string) => value.replace(/\s+/gu, ' ').trim()
  const events = (list: readonly string[]) =>
    [...list].map(item => item.toUpperCase()).sort().join(',')
  return (
    stored.timing.toUpperCase() !== draft.timing ||
    events(stored.events) !== events(draft.events) ||
    (stored.level ?? 'ROW').toUpperCase() !== draft.level ||
    squash(stored.body).replace(/;$/u, '') !==
      squash(draft.body).replace(/;$/u, '') ||
    ((draft.functionName ?? '').trim() !== '' &&
      (draft.functionName ?? '').trim() !== (stored.function ?? ''))
  )
}

/** 忽略空白差异比较两个检查约束表达式。 */
function sameCheckExpression(left: string, right: string): boolean {
  return left.replace(/\s+/gu, ' ').trim() === right.replace(/\s+/gu, ' ').trim()
}

/** SQLite CREATE TABLE 文本拆出的结构：括号前的表头、顶层字段 / 约束项、括号后的表选项。 */
interface SqliteCreateTableParts {
  head: string
  items: string[]
  suffix: string
}

/**
 * 按顶层逗号拆分 SQLite 保存的 CREATE TABLE 文本，引号与注释里的括号、逗号不参与拆分。
 * CREATE TABLE … AS SELECT 或无法识别的文本返回 null。
 */
function splitSqliteCreateTable(sql: string): SqliteCreateTableParts | null {
  if (!/^\s*CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\b/iu.test(sql)) return null
  let depth = 0
  let open = -1
  let itemStart = 0
  const items: string[] = []
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      // 成对的转义引号会被当成两段相邻字符串，结果一样。
      const close = sql.indexOf(char === '[' ? ']' : char, index + 1)
      if (close < 0) return null
      index = close
    } else if (char === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index)
      index = newline < 0 ? sql.length : newline
    } else if (char === '/' && sql[index + 1] === '*') {
      const close = sql.indexOf('*/', index + 2)
      index = close < 0 ? sql.length : close + 1
    } else if (char === '(') {
      depth++
      if (depth === 1 && open < 0) {
        open = index
        itemStart = index + 1
        if (/\bAS\s*$/iu.test(sql.slice(0, open))) return null
      }
    } else if (char === ')') {
      depth--
      if (depth === 0 && open >= 0) {
        items.push(sql.slice(itemStart, index))
        return {
          head: sql.slice(0, open),
          items: items.map(item => item.trim()),
          suffix: sql.slice(index + 1).trimEnd(),
        }
      }
    } else if (char === ',' && depth === 1) {
      items.push(sql.slice(itemStart, index))
      itemStart = index + 1
    }
  }
  return null
}

/** 去掉 SQLite 标识符外层的引号并还原转义。 */
function unquoteSqliteIdentifier(identifier: string): string {
  const first = identifier[0]
  if (first === '[') return identifier.slice(1, -1)
  if (first === '"' || first === '`' || first === "'")
    return identifier.slice(1, -1).replaceAll(`${first}${first}`, first)
  return identifier
}

/** 识别表级 CHECK 约束项，返回约束名（未命名为空串）与括号内的表达式；不是 CHECK 时返回 null。 */
function sqliteCheckItem(
  item: string
): { name: string; expression: string } | null {
  const text = item
    .replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
    .trimEnd()
  const match =
    /^(?:CONSTRAINT\s+("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|'(?:[^']|'')*'|[^\s(]+)\s+)?CHECK\s*\(/iu.exec(
      text
    )
  if (!match || !text.endsWith(')')) return null
  return {
    name: unquoteSqliteIdentifier(match[1] ?? ''),
    expression: text.slice(match[0].length, -1).trim(),
  }
}

/**
 * 解析 SQLite 表详情里的 DDL：第一条是建表语句，其余为索引与触发器（重建时原样执行）。
 * 未命名的检查约束按顺序给出 check_N 名称，以便在设计器里编辑和对比。
 */
function parseSqliteTableDdl(ddl: string): {
  create: SqliteCreateTableParts
  createSql: string
  checks: (DatabaseCheckConstraint & { item: number })[]
  others: string[]
} | null {
  const statements = ddl
    .trim()
    .split(/;\s*\n\n(?=CREATE\s)/iu)
    .map(statement => statement.trim().replace(/;$/u, ''))
    .filter(Boolean)
  const createSql = statements[0] ?? ''
  const create = splitSqliteCreateTable(createSql)
  if (!create) return null
  const found = create.items.flatMap((item, index) => {
    const check = sqliteCheckItem(item)
    return check ? [{ ...check, item: index }] : []
  })
  const named = new Set(
    found.filter(check => check.name).map(check => check.name.toLowerCase())
  )
  let counter = 1
  const checks = found.map(check => {
    if (check.name) return check
    while (named.has(`check_${counter}`)) counter++
    const name = `check_${counter++}`
    return { ...check, name }
  })
  return { create, createSql, checks, others: statements.slice(1) }
}

/** 从 SQLite 表 DDL 中读出表级检查约束；DDL 无法解析时返回 undefined（设计器保持只读）。 */
export function sqliteTableChecks(
  ddl: string
): DatabaseCheckConstraint[] | undefined {
  const parsed = parseSqliteTableDdl(ddl)
  return parsed?.checks.map(({ name, expression }) => ({ name, expression }))
}

/**
 * SQLite 不能直接改检查约束：在同一事务里按原建表文本创建临时表、复制数据、删除旧表、改名，
 * 再原样重建索引与触发器。未变化的约束与字段定义保持原文，新约束追加在末尾。
 * DROP TABLE 会触发外键动作，所以自引用直接拒绝，被其他表引用时由守卫语句中止并回滚。
 */
function sqliteCheckRebuildStatements(
  current: DatabaseTableDetail,
  draftChecks: readonly TableDesignerCheck[]
): string[] {
  const t = i18n.global.t
  const parsed = parseSqliteTableDdl(current.ddl)
  if (!parsed)
    throw new Error(t('无法解析 SQLite 建表语句，不能通过重建表修改检查约束'))
  if (
    current.foreignKeys.some(
      foreignKey =>
        foreignKey.referencedTable.toLowerCase() === current.name.toLowerCase()
    )
  )
    throw new Error(
      t('表“{value0}”有指向自身的外键，重建会触发外键动作，请在查询中手动修改检查约束', {
        value0: current.name,
      })
    )

  const kind: DatabaseKind = 'sqlite'
  const schema = current.schema || 'main'
  const target = qualifiedName(schema, current.name, kind)
  const temporaryName = `_mh_rebuild_${current.name}`
  const temporary = qualifiedName(schema, temporaryName, kind)
  const master = `${quoteIdentifier(schema, kind)}.sqlite_master`
  const sequence = `${quoteIdentifier(schema, kind)}.sqlite_sequence`
  const guard = 'temp."_mh_rebuild_guard"'

  // 未变化的约束保留原文（包括未命名约束），变化或新增的按草稿重新生成。
  const draftByName = new Map(
    draftChecks.map(check => [check.name.trim().toLowerCase(), check])
  )
  const storedByItem = new Map(parsed.checks.map(check => [check.item, check]))
  const kept = new Set<string>()
  const items = parsed.create.items.flatMap((item, index) => {
    const stored = storedByItem.get(index)
    if (!stored) return [item]
    const next = draftByName.get(stored.name.toLowerCase())
    if (!next || !sameCheckExpression(next.expression, stored.expression))
      return []
    kept.add(stored.name.toLowerCase())
    return [item]
  })
  for (const check of draftChecks)
    if (!kept.has(check.name.trim().toLowerCase()))
      items.push(renderCheck(check, kind))

  const columns = current.columns
    .map(column => quoteIdentifier(column.name, kind))
    .join(', ')
  const comment = (text: string) => `-- ${text}\n`
  const statements = [
    `${comment(t('SQLite 无法直接修改检查约束，以下语句将在同一事务中重建表，任一步失败都会整体回滚。'))}${comment(t('1. 确认没有其他表的外键引用此表（删除旧表会触发外键动作）'))}CREATE TEMP TABLE ${guard} ("referencing_foreign_keys" INTEGER CONSTRAINT "table_is_referenced_by_foreign_keys" CHECK ("referencing_foreign_keys" = 0))`,
    `INSERT INTO ${guard} SELECT COUNT(*) FROM ${master} AS m, pragma_foreign_key_list(m.name, ${quoteLiteral(schema, kind)}) AS f WHERE m.type = 'table' AND f."table" = ${quoteLiteral(current.name, kind)} COLLATE NOCASE`,
    `DROP TABLE ${guard}`,
    `${comment(t('2. 按新的检查约束创建临时表并复制数据'))}CREATE TABLE ${temporary} (\n  ${items.join(',\n  ')}\n)${parsed.create.suffix}`,
    `INSERT INTO ${temporary} (${columns}) SELECT ${columns} FROM ${target}`,
  ]
  // AUTOINCREMENT 的计数器随旧表删除，先转给临时表，改名时会一起改过去。
  if (/\bAUTOINCREMENT\b/iu.test(parsed.createSql))
    statements.push(
      `DELETE FROM ${sequence} WHERE name = ${quoteLiteral(temporaryName, kind)}`,
      `INSERT INTO ${sequence} (name, seq) SELECT ${quoteLiteral(temporaryName, kind)}, seq FROM ${sequence} WHERE name = ${quoteLiteral(current.name, kind)}`
    )
  statements.push(
    `${comment(t('3. 删除旧表，并把临时表改回原名'))}DROP TABLE ${target}`,
    `ALTER TABLE ${temporary} RENAME TO ${quoteIdentifier(current.name, kind)}`
  )
  parsed.others.forEach((statement, index) =>
    statements.push(
      index === 0
        ? `${comment(t('4. 原样重建索引与触发器'))}${statement}`
        : statement
    )
  )
  return statements
}

/** 生成保存前的变更摘要：列出新增 / 修改 / 删除 / 重命名的字段、索引、外键、检查约束、触发器、分区维护与表选项。 */
export function summarizeTableChanges(
  kind: DatabaseKind,
  current: DatabaseTableDetail | null,
  draft: TableDesignerDraft
): TableDesignerChange[] {
  const changes: TableDesignerChange[] = []
  const lower = (value: string) => value.trim().toLowerCase()
  if (!current) {
    changes.push({ action: 'add', target: '表', name: draft.name.trim() })
    for (const column of draft.columns)
      changes.push({ action: 'add', target: '字段', name: column.name })
    for (const index of draft.indexes)
      changes.push({ action: 'add', target: '索引', name: index.name })
    for (const foreignKey of draft.foreignKeys)
      changes.push({ action: 'add', target: '外键', name: foreignKey.name })
    for (const check of draft.checks ?? [])
      changes.push({ action: 'add', target: '检查约束', name: check.name })
    for (const trigger of draft.triggers ?? [])
      changes.push({ action: 'add', target: '触发器', name: trigger.name })
    return changes
  }

  // 字段：按 originalName 关联，识别改名与定义变化。
  const matched = new Set<string>()
  for (const column of draft.columns) {
    const origin = column.originalName
      ? current.columns.find(item => item.name === column.originalName)
      : undefined
    if (!origin) {
      changes.push({ action: 'add', target: '字段', name: column.name })
      continue
    }
    matched.add(origin.name)
    if (origin.name !== column.name.trim())
      changes.push({
        action: 'rename',
        target: '字段',
        name: column.name,
        detail: origin.name,
      })
    if (columnChanged(origin, column, kind, current))
      changes.push({ action: 'modify', target: '字段', name: column.name })
  }
  for (const column of current.columns)
    if (!matched.has(column.name))
      changes.push({ action: 'remove', target: '字段', name: column.name })

  // 索引 / 外键 / 检查约束 / 触发器：按名称对比。
  const diffNamed = <T extends { name: string }, S extends { name: string }>(
    target: string,
    drafts: readonly T[],
    stored: readonly S[],
    changed: (stored: S, draft: T) => boolean
  ) => {
    const storedMap = new Map(stored.map(item => [lower(item.name), item]))
    const draftKeys = new Set(drafts.map(item => lower(item.name)))
    for (const item of drafts) {
      const origin = storedMap.get(lower(item.name))
      if (!origin) changes.push({ action: 'add', target, name: item.name })
      else if (changed(origin, item))
        changes.push({ action: 'modify', target, name: item.name })
    }
    for (const item of stored)
      if (!draftKeys.has(lower(item.name)))
        changes.push({ action: 'remove', target, name: item.name })
  }
  const storedIndexes = current.indexes.filter(
    index =>
      !index.primary && representableIndex(index, current.columns, kind)
  )
  diffNamed('索引', draft.indexes, storedIndexes, (stored, item) => {
    const origin = designerIndexFromStored(stored, current.columns, kind, '')
    return (
      JSON.stringify({ ...origin, id: '' }) !==
      JSON.stringify({ ...item, id: '' })
    )
  })
  diffNamed(
    '外键',
    draft.foreignKeys,
    current.foreignKeys,
    (stored, item) => foreignKeyChanged(stored, item)
  )
  if (draft.checks && current.checks)
    diffNamed(
      '检查约束',
      draft.checks,
      current.checks,
      (stored, item) =>
        stored.expression.replace(/\s+/gu, ' ').trim() !==
        item.expression.replace(/\s+/gu, ' ').trim()
    )
  if (draft.triggers && current.triggers)
    diffNamed('触发器', draft.triggers, current.triggers, triggerChanged)
  const keepFunctions = new Set(draft.keepTriggerFunctions ?? [])
  for (const item of droppableTriggerFunctions(kind, current, draft))
    if (!keepFunctions.has(item.function))
      changes.push({ action: 'remove', target: '触发器函数', name: item.function })

  // 分区维护：新增 / 删除按分区列出，清空与重组记为修改。
  for (const change of draft.partitionChanges ?? []) {
    const newNames = change.items.map(item => item.name.trim()).join(', ')
    if (change.action === 'add')
      for (const item of change.items)
        changes.push({ action: 'add', target: '分区', name: item.name.trim() })
    else if (change.action === 'drop')
      for (const name of change.partitions)
        changes.push({ action: 'remove', target: '分区', name })
    else
      changes.push({
        action: 'modify',
        target: '分区',
        name: change.partitions.join(', '),
        detail:
          change.action === 'truncate'
            ? 'TRUNCATE'
            : `REORGANIZE → ${newNames}`,
      })
  }
  // 表级：改名与选项。
  if (
    draft.name.trim() !== current.name ||
    draft.schema.trim() !== current.schema
  )
    changes.push({
      action: 'rename',
      target: '表',
      name: draft.name.trim(),
      detail: current.name,
    })
  const options = current.options
  const optionDiffs: string[] = []
  if ((draft.comment ?? '') !== (options?.comment ?? '')) optionDiffs.push('COMMENT')
  if (kind === 'mysql') {
    if (draft.engine && draft.engine !== options?.engine) optionDiffs.push('ENGINE')
    if (draft.charset && draft.charset !== options?.charset)
      optionDiffs.push('CHARSET')
    if (draft.collation && draft.collation !== options?.collation)
      optionDiffs.push('COLLATE')
    if (
      draft.rowFormat &&
      draft.rowFormat.toUpperCase() !== options?.rowFormat?.toUpperCase()
    )
      optionDiffs.push('ROW_FORMAT')
  }
  if (
    draft.autoIncrement != null &&
    String(draft.autoIncrement) !== String(options?.autoIncrement)
  )
    optionDiffs.push('AUTO_INCREMENT')
  if (optionDiffs.length)
    changes.push({
      action: 'modify',
      target: '表',
      name: draft.name.trim(),
      detail: optionDiffs.join(', '),
    })
  return changes
}

/** 比较的都是「设计器看到的形态」，未修改的字段才不会被误判。 */
function columnChanged(
  current: DatabaseColumn,
  draft: TableDesignerColumn,
  kind: DatabaseKind,
  detail: DatabaseTableDetail
): boolean {
  const stored = storedCollation(current, detail.options)
  return (
    typeChanged(
      parseStoredType(current.dataType, kind),
      draftTypeParsed(draft, kind)
    ) ||
    /\bzerofill\b/iu.test(current.dataType) !== Boolean(draft.zerofill) ||
    current.nullable !== draft.nullable ||
    current.autoIncrement !== draft.autoIncrement ||
    (current.comment ?? '') !== draft.comment ||
    normalizeDefault(storedDefault(current, kind)) !==
      normalizeDefault(draft.defaultValue || null) ||
    stored.charset !== (draft.charset ?? '') ||
    stored.collation !== (draft.collation ?? '') ||
    Boolean(current.onUpdateCurrentTimestamp) !==
      Boolean(draft.onUpdateCurrentTimestamp) ||
    generatedChanged(current, draft, kind)
  )
}

function generatedChanged(
  current: DatabaseColumn,
  draft: TableDesignerColumn,
  kind: DatabaseKind
): boolean {
  const expression = draft.generatedExpression?.trim() ?? ''
  return (
    storedGeneratedExpression(current, kind) !== expression ||
    (Boolean(expression) &&
      Boolean(current.generatedStored) !== Boolean(draft.generatedStored))
  )
}

function postgresqlColumnAlter(
  target: string,
  current: DatabaseColumn,
  draft: TableDesignerColumn,
  detail: DatabaseTableDetail
): string[] {
  const statements: string[] = []
  const kind = 'postgresql'
  const column = quoteIdentifier(draft.name, kind)

  // 生成表达式没有通用的修改语法；值是算出来的，删列重建不丢数据。
  if (generatedChanged(current, { ...draft, generatedStored: true }, kind)) {
    statements.push(
      `ALTER TABLE ${target} DROP COLUMN ${column}`,
      `ALTER TABLE ${target} ADD COLUMN ${renderColumn(draft, kind, { inlineUnique: false }).trim()}`
    )
    return statements
  }

  const currentType = parseStoredType(current.dataType, kind)
  const draftType = draftTypeParsed(draft, kind)
  const collationChanged =
    storedCollation(current, detail.options).collation !==
    (draft.collation ?? '')
  if (typeChanged(currentType, draftType) || collationChanged) {
    statements.push(
      `ALTER TABLE ${target} ALTER COLUMN ${column} TYPE ${renderDataType(draft, kind)}${renderCollation(draft, kind)}`
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
      `COMMENT ON COLUMN ${target}.${column} IS ${quoteLiteral(draft.comment, kind)}`
    )
  }
  return statements
}
