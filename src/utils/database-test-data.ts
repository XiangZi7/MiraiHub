import { i18n } from '@/i18n'
import type {
  CellValue,
  DatabaseColumn,
  DatabaseKind,
  DatabaseTableDetail,
} from '@/types/database'

// 测试数据按规则在本地生成：AI 只看表结构、只给规则，行内容不经过模型。

export const TEST_DATA_FAKERS = [
  'fullName',
  'firstName',
  'username',
  'email',
  'phone',
  'company',
  'city',
  'address',
  'url',
  'ipv4',
  'uuid',
  'word',
  'sentence',
  'paragraph',
  'json',
] as const
export type TestDataFaker = (typeof TEST_DATA_FAKERS)[number]

export const TEST_DATA_KINDS = [
  'default',
  'sequence',
  'integer',
  'decimal',
  'boolean',
  'enum',
  'datetime',
  'faker',
  'foreignKey',
] as const
export type TestDataRuleKind = (typeof TEST_DATA_KINDS)[number]

export interface TestDataRule {
  column: string
  kind: TestDataRuleKind
  nullRate: number
  start?: number
  step?: number
  min?: number
  max?: number
  scale?: number
  trueRate?: number
  values?: string[]
  weights?: number[]
  from?: string
  to?: string
  faker?: TestDataFaker
  /** 外键值池的键；同一外键的多列取同一行，保持组合外键有效。 */
  pool?: string
  poolIndex?: number
  referenceSchema?: string
  referenceTable?: string
  referenceColumn?: string
}

/** 外键值池：键对应规则的 pool，每项是一行被引用的取值。 */
export type TestDataPools = Record<string, Array<Array<string | null>>>

interface TypeInfo {
  base: string
  length: number | null
  precision: number | null
  scale: number | null
  unsigned: boolean
  enumValues: string[] | null
}

const INTEGER_RANGES: Record<string, [number, number]> = {
  tinyint: [-128, 127],
  smallint: [-32768, 32767],
  int2: [-32768, 32767],
  smallserial: [1, 32767],
  mediumint: [-8388608, 8388607],
  int: [-2147483648, 2147483647],
  integer: [-2147483648, 2147483647],
  int4: [-2147483648, 2147483647],
  serial: [1, 2147483647],
}

function typeInfo(column: DatabaseColumn): TypeInfo {
  const type = column.dataType.trim().toLowerCase()
  const base = /^[a-z_ ]*[a-z_0-9]*/u.exec(type)?.[0]?.trim() ?? type
  const size = /\((\d+)(?:\s*,\s*(\d+))?\)/u.exec(type)
  const enumValues = /^(enum|set)\s*\(/u.test(type)
    ? Array.from(column.dataType.matchAll(/'((?:[^']|'')*)'/gu), match =>
        match[1]!.replaceAll("''", "'")
      )
    : null
  const numeric = /^(decimal|numeric|dec|fixed)/u.test(base)
  return {
    base,
    length: !numeric && size ? Number(size[1]) : null,
    precision: numeric && size ? Number(size[1]) : null,
    scale: numeric && size?.[2] ? Number(size[2]) : null,
    unsigned: /\bunsigned\b/u.test(type),
    enumValues,
  }
}

const isInteger = (info: TypeInfo): boolean =>
  /^(tiny|small|medium|big)?int|^int[248]$|^integer$|serial$/u.test(info.base)
const isBoolean = (column: DatabaseColumn, info: TypeInfo): boolean =>
  /^bool/u.test(info.base) ||
  /^tinyint\(1\)/u.test(column.dataType.toLowerCase())
const isDecimal = (info: TypeInfo): boolean =>
  /^(decimal|numeric|dec|fixed|float|double|real|money)/u.test(info.base)
const isTemporal = (info: TypeInfo): boolean =>
  /^(date|time|timestamp|year)/u.test(info.base)
const isBinary = (info: TypeInfo): boolean =>
  /(binary|blob|bytea|^bit|geometry|point|polygon|linestring|vector)/u.test(
    info.base
  )

function integerRange(info: TypeInfo): [number, number] {
  const [min, max] = INTEGER_RANGES[info.base] ?? [
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  ]
  if (!info.unsigned) return [min, max]
  return [0, max === Number.MAX_SAFE_INTEGER ? max : max * 2 + 1]
}

function decimalLimit(info: TypeInfo): number {
  if (info.precision === null) return 1e9
  return 10 ** Math.min(info.precision - (info.scale ?? 0), 15)
}

/** 列必须由数据库生成，写入显式值会报错或破坏自增语义。 */
function databaseOwned(column: DatabaseColumn): boolean {
  return column.autoIncrement || Boolean(column.generatedExpression)
}

/** 没有 AI 时按列名和类型推断规则，也是 AI 结果不合法时的回退。 */
export function defaultTestDataRule(column: DatabaseColumn): TestDataRule {
  const rule = (extra: Partial<TestDataRule>): TestDataRule => ({
    column: column.name,
    kind: 'default',
    nullRate: 0,
    ...extra,
  })
  if (databaseOwned(column)) return rule({})
  const info = typeInfo(column)
  const name = column.name.toLowerCase()
  const faker = (value: TestDataFaker): TestDataRule =>
    rule({ kind: 'faker', faker: value })
  if (info.enumValues?.length)
    return rule({ kind: 'enum', values: info.enumValues })
  if (isBoolean(column, info)) return rule({ kind: 'boolean', trueRate: 0.5 })
  if (isInteger(info)) {
    const [min, max] = integerRange(info)
    if (column.primaryKey) return rule({ kind: 'sequence', start: 1, step: 1 })
    return rule({
      kind: 'integer',
      min: Math.max(min, /age/u.test(name) ? 18 : 0),
      max: Math.min(max, /age/u.test(name) ? 70 : 1000),
    })
  }
  if (isDecimal(info)) {
    const limit = decimalLimit(info)
    return rule({
      kind: 'decimal',
      min: 0,
      max: Math.min(limit - 1, 1000) || 0.99,
      scale: info.scale ?? 2,
    })
  }
  if (isTemporal(info)) {
    const now = new Date()
    const from = new Date(now)
    from.setFullYear(now.getFullYear() - 1)
    return rule({
      kind: 'datetime',
      from: from.toISOString(),
      to: now.toISOString(),
    })
  }
  if (isBinary(info))
    return column.nullable || column.defaultValue !== null
      ? rule({})
      : faker('word')
  if (/^jsonb?$/u.test(info.base)) return faker('json')
  if (/^uuid$/u.test(info.base) || /(^|_)uuid$/u.test(name))
    return faker('uuid')
  if (/e_?mail/u.test(name)) return faker('email')
  if (/(phone|mobile|tel)/u.test(name)) return faker('phone')
  if (/(user_?name|login|account|nick)/u.test(name)) return faker('username')
  if (/(company|org)/u.test(name)) return faker('company')
  if (/city/u.test(name)) return faker('city')
  if (/addr/u.test(name)) return faker('address')
  if (/(url|link|website|avatar)/u.test(name)) return faker('url')
  if (/(^|_)ip(v4)?($|_)/u.test(name)) return faker('ipv4')
  if (/name$/u.test(name)) return faker('fullName')
  if (/(desc|remark|content|comment|note|text)/u.test(name))
    return faker(info.length !== null && info.length < 64 ? 'word' : 'sentence')
  return faker('word')
}

/** 组装发给 AI 的表结构，不含任何行数据。 */
export function testDataSchemaPayload(
  table: DatabaseTableDetail,
  otherTables: string[]
): string {
  return JSON.stringify({
    table: table.name,
    columns: table.columns.map(column => ({
      name: column.name,
      type: column.dataType,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      autoIncrement: column.autoIncrement,
      generated: Boolean(column.generatedExpression),
      hasDefault: column.defaultValue !== null,
      comment: column.comment,
    })),
    uniqueIndexes: table.indexes
      .filter(index => index.unique)
      .map(index => index.columns),
    foreignKeys: table.foreignKeys.map(key => ({
      columns: key.columns,
      references: `${key.referencedTable}(${key.referencedColumns.join(', ')})`,
    })),
    otherTables: otherTables.slice(0, 300),
  })
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const asDate = (value: unknown): string | undefined =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : undefined
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** 从模型回复里取出 JSON 对象，容忍代码块和前后说明文字。 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start)
    throw new Error(i18n.global.t('AI 返回的内容不是有效的 JSON'))
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error(i18n.global.t('AI 返回的内容不是有效的 JSON'))
  }
}

/** 校验一条 AI 规则；任何不合法的部分都回退到本地推断。 */
function sanitizeRule(
  raw: Record<string, unknown>,
  column: DatabaseColumn,
  tables: ReadonlyMap<string, string>
): TestDataRule {
  const fallback = defaultTestDataRule(column)
  if (databaseOwned(column)) return fallback
  const nullRate = column.nullable
    ? clamp(asNumber(raw.nullRate) ?? 0, 0, 1)
    : 0
  const base = { column: column.name, nullRate }
  const info = typeInfo(column)
  switch (raw.kind) {
    case 'default':
      return column.nullable || column.defaultValue !== null
        ? { ...base, kind: 'default' }
        : fallback
    case 'sequence':
      if (!isInteger(info)) return fallback
      return {
        ...base,
        kind: 'sequence',
        start: Math.trunc(asNumber(raw.start) ?? 1),
        step: Math.trunc(asNumber(raw.step) ?? 1) || 1,
      }
    case 'integer': {
      if (!isInteger(info)) return fallback
      const [lower, upper] = integerRange(info)
      const min = clamp(Math.trunc(asNumber(raw.min) ?? 0), lower, upper)
      const max = clamp(Math.trunc(asNumber(raw.max) ?? 1000), lower, upper)
      return { ...base, kind: 'integer', min, max: Math.max(min, max) }
    }
    case 'decimal': {
      if (!isDecimal(info)) return fallback
      const limit = decimalLimit(info)
      const min = clamp(asNumber(raw.min) ?? 0, -limit, limit)
      const max = clamp(asNumber(raw.max) ?? 1000, -limit, limit)
      return {
        ...base,
        kind: 'decimal',
        min,
        max: Math.max(min, max),
        scale: info.scale ?? clamp(Math.trunc(asNumber(raw.scale) ?? 2), 0, 8),
      }
    }
    case 'boolean':
      if (!isBoolean(column, info)) return fallback
      return {
        ...base,
        kind: 'boolean',
        trueRate: clamp(asNumber(raw.trueRate) ?? 0.5, 0, 1),
      }
    case 'enum': {
      if (!Array.isArray(raw.values)) return fallback
      const values = raw.values
        .filter(value => ['string', 'number'].includes(typeof value))
        .slice(0, 200)
        .map(String)
      // 原生 ENUM 只接受定义内的取值
      const allowed = info.enumValues
        ? values.filter(value => info.enumValues!.includes(value))
        : values
      if (!allowed.length) return fallback
      const weights = Array.isArray(raw.weights)
        ? raw.weights.map(value => Math.max(asNumber(value) ?? 0, 0))
        : []
      return {
        ...base,
        kind: 'enum',
        values: allowed,
        ...(allowed.length === values.length &&
        weights.length === values.length &&
        weights.some(Boolean)
          ? { weights }
          : {}),
      }
    }
    case 'datetime': {
      if (!isTemporal(info)) return fallback
      const from = asDate(raw.from) ?? fallback.from
      const to = asDate(raw.to) ?? fallback.to
      if (!from || !to) return fallback
      return Date.parse(from) <= Date.parse(to)
        ? { ...base, kind: 'datetime', from, to }
        : { ...base, kind: 'datetime', from: to, to: from }
    }
    case 'faker':
      return TEST_DATA_FAKERS.includes(raw.faker as TestDataFaker) &&
        !isInteger(info) &&
        !isDecimal(info) &&
        !isTemporal(info) &&
        !isBinary(info)
        ? { ...base, kind: 'faker', faker: raw.faker as TestDataFaker }
        : fallback
    case 'reference': {
      const schema =
        typeof raw.table === 'string' ? tables.get(raw.table) : undefined
      if (schema === undefined || typeof raw.column !== 'string')
        return fallback
      return {
        ...base,
        kind: 'foreignKey',
        pool: `ref:${raw.table}.${raw.column}`,
        poolIndex: 0,
        referenceSchema: schema,
        referenceTable: raw.table as string,
        referenceColumn: raw.column,
      }
    }
    default:
      return fallback
  }
}

/** 真实外键优先于任何推断或 AI 规则；同组列共用一个值池。 */
function applyForeignKeys(
  rules: TestDataRule[],
  table: DatabaseTableDetail
): TestDataRule[] {
  return rules.map(rule => {
    for (const key of table.foreignKeys) {
      const position = key.columns.indexOf(rule.column)
      if (position < 0) continue
      return {
        column: rule.column,
        kind: 'foreignKey',
        nullRate: rule.nullRate,
        pool: `fk:${key.name}`,
        poolIndex: position,
        referenceSchema: key.referencedSchema,
        referenceTable: key.referencedTable,
        referenceColumn: key.referencedColumns[position]!,
      }
    }
    return rule
  })
}

/** 本地推断的整表规则。 */
export function defaultTestDataRules(
  table: DatabaseTableDetail
): TestDataRule[] {
  return applyForeignKeys(table.columns.map(defaultTestDataRule), table)
}

/** 解析并校验 AI 回复；未提到的列用本地推断补齐。 */
export function parseTestDataRules(
  text: string,
  table: DatabaseTableDetail,
  tables: ReadonlyMap<string, string>
): TestDataRule[] {
  const parsed = extractJsonObject(text) as { rules?: unknown }
  if (!Array.isArray(parsed.rules))
    throw new Error(i18n.global.t('AI 返回的内容不是有效的 JSON'))
  const byColumn = new Map(
    (parsed.rules as Array<Record<string, unknown>>)
      .filter(rule => rule && typeof rule.column === 'string')
      .map(rule => [rule.column as string, rule])
  )
  return applyForeignKeys(
    table.columns.map(column => {
      const raw = byColumn.get(column.name)
      return raw
        ? sanitizeRule(raw, column, tables)
        : defaultTestDataRule(column)
    }),
    table
  )
}

/** mulberry32：固定种子让预览的前 20 行与实际写入的前 20 行一致。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const ZH = {
  surnames: '王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗'.split(''),
  given: '伟芳娜敏静丽强磊军洋勇艳杰涛明超秀英华慧宇浩然欣怡'.split(''),
  cities: ['北京', '上海', '广州', '深圳', '杭州', '成都', '南京', '武汉'],
  streets: ['人民路', '中山路', '解放路', '建设路', '和平路', '长江路'],
  companies: ['星河', '云帆', '启明', '恒信', '瑞丰', '远景', '蓝海'],
  suffixes: ['科技有限公司', '网络有限公司', '贸易有限公司', '信息技术公司'],
  words: '系统 数据 用户 订单 服务 测试 产品 项目 记录 内容 平台 管理'.split(
    ' '
  ),
}
const EN = {
  first: 'Alice Bob Carol David Emma Frank Grace Henry Ivy Jack Kate Leo'.split(
    ' '
  ),
  last: 'Smith Johnson Brown Taylor Miller Davis Clark Lewis Walker Hall'.split(
    ' '
  ),
  cities: ['London', 'Berlin', 'Tokyo', 'Toronto', 'Sydney', 'Boston', 'Paris'],
  streets: ['Main St', 'Oak Ave', 'Pine Rd', 'Maple Dr', 'Cedar Ln'],
  companies: ['Northwind', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Vertex'],
  suffixes: ['Inc', 'LLC', 'Ltd', 'Group'],
  words:
    'system data user order service test product project record content platform'.split(
      ' '
    ),
}
const LATIN = 'alex sam kim max lee ray jo mia zoe tom amy ben'.split(' ')

function fakerValue(
  faker: TestDataFaker,
  chinese: boolean,
  random: () => number
): string {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!
  const digits = (count: number): string =>
    Array.from({ length: count }, () => Math.floor(random() * 10)).join('')
  const words = chinese ? ZH.words : EN.words
  const sentence = (): string => {
    const parts = Array.from({ length: 4 + Math.floor(random() * 6) }, () =>
      pick(words)
    )
    return chinese ? `${parts.join('')}。` : `${parts.join(' ')}.`
  }
  switch (faker) {
    case 'fullName':
      return chinese
        ? pick(ZH.surnames) + pick(ZH.given) + pick(ZH.given)
        : `${pick(EN.first)} ${pick(EN.last)}`
    case 'firstName':
      return chinese ? pick(ZH.given) + pick(ZH.given) : pick(EN.first)
    case 'username':
      return `${pick(LATIN)}_${digits(4)}`
    case 'email':
      return `${pick(LATIN)}.${digits(5)}@example.com`
    case 'phone':
      return chinese ? `13${digits(9)}` : `+1555${digits(7)}`
    case 'company':
      return chinese
        ? pick(ZH.companies) + pick(ZH.suffixes)
        : `${pick(EN.companies)} ${pick(EN.suffixes)}`
    case 'city':
      return pick(chinese ? ZH.cities : EN.cities)
    case 'address':
      return chinese
        ? `${pick(ZH.cities)}市${pick(ZH.streets)}${1 + Math.floor(random() * 999)}号`
        : `${1 + Math.floor(random() * 999)} ${pick(EN.streets)}, ${pick(EN.cities)}`
    case 'url':
      return `https://example.com/${pick(LATIN)}/${digits(6)}`
    case 'ipv4':
      return `10.${Math.floor(random() * 256)}.${Math.floor(random() * 256)}.${1 + Math.floor(random() * 254)}`
    case 'uuid':
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, char => {
        const value = Math.floor(random() * 16)
        return (char === 'x' ? value : (value & 3) | 8).toString(16)
      })
    case 'word':
      return pick(words)
    case 'sentence':
      return sentence()
    case 'paragraph':
      return Array.from({ length: 3 }, sentence).join(chinese ? '' : ' ')
    case 'json':
      return JSON.stringify({ id: digits(6), label: pick(words) })
  }
}

function formatTemporal(time: number, column: DatabaseColumn): string {
  const iso = new Date(time).toISOString()
  const base = typeInfo(column).base
  if (base.startsWith('year')) return iso.slice(0, 4)
  if (/^date$/u.test(base)) return iso.slice(0, 10)
  if (/^time/u.test(base) && !base.startsWith('timestamp'))
    return iso.slice(11, 19)
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
}

/** 按规则生成一格；返回 null 表示写入 NULL。 */
function cellValue(
  rule: TestDataRule,
  column: DatabaseColumn,
  index: number,
  options: {
    kind: DatabaseKind
    chinese: boolean
    random: () => number
    pools: TestDataPools
    picked: Map<string, Array<string | null>>
    uniqueColumn: boolean
  }
): string | null {
  const { random } = options
  if (rule.kind === 'foreignKey') {
    const pool = options.pools[rule.pool!] ?? []
    if (!pool.length) return null
    if (random() < rule.nullRate) return null
    let row = options.picked.get(rule.pool!)
    if (!row) {
      row = pool[Math.floor(random() * pool.length)]!
      options.picked.set(rule.pool!, row)
    }
    return row[rule.poolIndex ?? 0] ?? null
  }
  if (rule.nullRate > 0 && random() < rule.nullRate) return null
  switch (rule.kind) {
    case 'sequence':
      return String((rule.start ?? 1) + index * (rule.step ?? 1))
    case 'integer': {
      const min = rule.min ?? 0
      const max = rule.max ?? 1000
      if (!options.uniqueColumn)
        return String(min + Math.floor(random() * (max - min + 1)))
      // 唯一列不能靠随机撞运气：范围内按行号错开
      return String(min + (index % (max - min + 1)))
    }
    case 'decimal': {
      const min = rule.min ?? 0
      const max = rule.max ?? 1000
      return (min + random() * (max - min)).toFixed(rule.scale ?? 2)
    }
    case 'boolean': {
      const value = random() < (rule.trueRate ?? 0.5)
      if (options.kind === 'postgresql') return String(value)
      return value ? '1' : '0'
    }
    case 'enum': {
      const values = rule.values ?? []
      if (rule.weights) {
        const total = rule.weights.reduce((sum, weight) => sum + weight, 0)
        let cursor = random() * total
        for (const [position, weight] of rule.weights.entries()) {
          cursor -= weight
          if (cursor < 0) return values[position]!
        }
      }
      return values[Math.floor(random() * values.length)] ?? null
    }
    case 'datetime': {
      const from = Date.parse(rule.from ?? '')
      const to = Date.parse(rule.to ?? '')
      return formatTemporal(from + random() * (to - from), column)
    }
    case 'faker': {
      const value = fakerValue(rule.faker ?? 'word', options.chinese, random)
      const limit = typeInfo(column).length
      if (!options.uniqueColumn)
        return limit === null ? value : value.slice(0, limit)
      if (rule.faker === 'uuid') return value
      // 唯一文本带上行号，超长时保留行号、截掉内容
      const suffix = `_${index + 1}`
      const at = value.indexOf('@')
      if (rule.faker === 'email' && at > 0) {
        const unique = `${value.slice(0, at)}${suffix}${value.slice(at)}`
        return limit === null ? unique : unique.slice(-limit)
      }
      return limit === null
        ? value + suffix
        : value.slice(0, Math.max(limit - suffix.length, 0)) + suffix
    }
    default:
      return null
  }
}

/** 规则还不能生成时返回原因：非空外键无值可引用、非空列被跳过等。 */
export function testDataBlocker(
  table: DatabaseTableDetail,
  rules: TestDataRule[],
  pools: TestDataPools
): string | null {
  for (const rule of rules) {
    const column = table.columns.find(item => item.name === rule.column)
    if (!column) continue
    if (
      rule.kind === 'foreignKey' &&
      !column.nullable &&
      !pools[rule.pool!]?.length
    )
      return i18n.global.t('字段 {column} 引用的表 {table} 没有可用数据', {
        column: rule.column,
        table: rule.referenceTable ?? '',
      })
    if (rule.kind === 'enum' && !rule.values?.length)
      return i18n.global.t('字段 {column} 的枚举值为空', {
        column: rule.column,
      })
    if (
      rule.kind === 'default' &&
      !column.nullable &&
      column.defaultValue === null &&
      !databaseOwned(column)
    )
      return i18n.global.t('字段 {column} 不可为空且没有默认值，必须生成', {
        column: rule.column,
      })
  }
  return null
}

const RETRIES = 50
const YIELD_EVERY = 5000

/** 批量生成行，定期让出主线程；唯一索引按整行重试去重，重试耗尽则报错。 */
export async function generateTestRows(options: {
  table: DatabaseTableDetail
  rules: TestDataRule[]
  count: number
  seed: number
  kind: DatabaseKind
  chinese: boolean
  pools: TestDataPools
  signal?: AbortSignal
}): Promise<CellValue[][]> {
  const { table, rules, count, pools } = options
  const active = rules.filter(rule => rule.kind !== 'default')
  const columns = new Map(table.columns.map(column => [column.name, column]))
  const names = new Set(active.map(rule => rule.column))
  const uniqueIndexes = table.indexes
    .filter(index => index.unique || index.primary)
    .map(index => index.columns)
    .filter(list => list.length > 0 && list.every(name => names.has(name)))
  const uniqueColumns = new Set(
    uniqueIndexes.filter(list => list.length === 1).map(list => list[0]!)
  )
  const seen = uniqueIndexes.map(() => new Set<string>())
  const random = seededRandom(options.seed)
  const rows: CellValue[][] = []
  for (let index = 0; index < count; index++) {
    if (index % YIELD_EVERY === 0 && index > 0) {
      await new Promise(resolve => setTimeout(resolve))
      options.signal?.throwIfAborted()
    }
    let row: CellValue[] | null = null
    for (let attempt = 0; attempt < RETRIES && !row; attempt++) {
      const picked = new Map<string, Array<string | null>>()
      const candidate = active.map(rule => ({
        column: rule.column,
        value: cellValue(rule, columns.get(rule.column)!, index, {
          kind: options.kind,
          chinese: options.chinese,
          random,
          pools,
          picked,
          uniqueColumn: uniqueColumns.has(rule.column),
        }),
      }))
      const values = new Map(candidate.map(cell => [cell.column, cell.value]))
      const keys = uniqueIndexes.map(list =>
        // 含 NULL 的键不参与唯一约束
        list.some(name => values.get(name) === null)
          ? null
          : JSON.stringify(list.map(name => values.get(name)))
      )
      if (keys.some((key, position) => key && seen[position]!.has(key)))
        continue
      keys.forEach((key, position) => {
        if (key) seen[position]!.add(key)
      })
      row = candidate
    }
    if (!row)
      throw new Error(
        i18n.global.t(
          '第 {index} 行无法满足唯一约束，请放宽规则的取值范围或减少行数',
          { index: index + 1 }
        )
      )
    rows.push(row)
  }
  return rows
}
