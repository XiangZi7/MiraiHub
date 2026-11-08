import type { DatabaseKind } from './database'

export type TableIndexKind = 'index' | 'unique' | 'fulltext' | 'spatial'
export type TableIndexMethod =
  'btree' | 'hash' | 'gist' | 'gin' | 'brin' | 'spgist'
export type ReferentialAction =
  'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT'

export interface TableDesignerColumn {
  id: string
  name: string
  dataType: string
  length: string
  nullable: boolean
  primaryKey: boolean
  unique: boolean
  unsigned: boolean
  autoIncrement: boolean
  defaultValue: string
  comment: string
  /** 现有表里的原字段名：有它才能生成改名语句而不是删列重建。 */
  originalName?: string
  /** 主键内的顺序，只在复合主键顺序不同于字段顺序时有意义。 */
  primaryKeyOrder?: number
  zerofill?: boolean
  charset?: string
  collation?: string
  onUpdateCurrentTimestamp?: boolean
  /** 非空表示生成列。 */
  generatedExpression?: string
  generatedStored?: boolean
}

export interface TableDesignerIndexColumnOptions {
  /** MySQL 前缀长度。 */
  prefix?: string
  descending?: boolean
  /** columns 里的这一项是表达式而不是字段名（PostgreSQL）。 */
  expression?: boolean
}

export interface TableDesignerIndex {
  id: string
  name: string
  kind: TableIndexKind
  method: TableIndexMethod
  /** 按顺序的索引项：字段名，或 columnOptions 标记的表达式。 */
  columns: string[]
  columnOptions?: Record<string, TableDesignerIndexColumnOptions>
  comment?: string
  /** PostgreSQL 部分索引的 WHERE 条件。 */
  predicate?: string
}

export interface TableDesignerForeignKey {
  id: string
  name: string
  /** 本地字段，与 referencedColumns 按位置一一对应（多列外键）。 */
  columns: string[]
  referencedSchema: string
  referencedTable: string
  referencedColumns: string[]
  onDelete: ReferentialAction
  onUpdate: ReferentialAction
}

export interface TableDesignerCheck {
  id: string
  name: string
  /** 不带外层 CHECK ( ) 的布尔表达式。 */
  expression: string
}

export type TriggerTiming = 'BEFORE' | 'AFTER'
export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'

export interface TableDesignerTrigger {
  id: string
  name: string
  timing: TriggerTiming
  /** MySQL 只能一个事件；PostgreSQL 可组合。 */
  events: TriggerEvent[]
  level: 'ROW' | 'STATEMENT'
  /** MySQL：触发语句（多条时自动包 BEGIN…END）；PostgreSQL：plpgsql 函数体。 */
  body: string
  /** PostgreSQL 现有触发函数的限定名；为空时按表名和触发器名生成。 */
  functionName?: string
}

export type TablePartitionMethod = '' | 'RANGE' | 'LIST' | 'HASH' | 'KEY'

export interface TableDesignerPartitionItem {
  id: string
  name: string
  /** RANGE 的 LESS THAN 值 / LIST 的 IN 值列表，不含括号。 */
  value: string
}

/** 已有 MySQL 分区表支持的分区维护操作。 */
export type TablePartitionAction = 'add' | 'drop' | 'truncate' | 'reorganize'

/** 已有分区表的一项分区维护操作，每项生成一条独立的 ALTER TABLE … PARTITION 语句。 */
export interface TableDesignerPartitionChange {
  id: string
  action: TablePartitionAction
  /** drop / truncate / reorganize 作用的现有分区名。 */
  partitions: string[]
  /** add / reorganize 生成的新分区定义。 */
  items: TableDesignerPartitionItem[]
}

/** MySQL 建表时的分区定义；已有表的分区改由 partitionChanges 维护。 */
export interface TableDesignerPartition {
  method: TablePartitionMethod
  /** 分区表达式或列（KEY 为逗号分隔的列名）。 */
  expression: string
  /** HASH / KEY 的分区数。 */
  count: string
  items: TableDesignerPartitionItem[]
}

export interface TableDesignerDraft {
  schema: string
  name: string
  comment: string
  engine: string
  charset: string
  collation: string
  rowFormat: string
  /** 十进制文本保留 BIGINT 精度；null 表示不指定计数器。 */
  autoIncrement: string | null
  columns: TableDesignerColumn[]
  indexes: TableDesignerIndex[]
  foreignKeys: TableDesignerForeignKey[]
  checks?: TableDesignerCheck[]
  triggers?: TableDesignerTrigger[]
  /** 删除 PostgreSQL 触发器时保留不删的专属触发函数（限定名）；未列出的随触发器一起删除。 */
  keepTriggerFunctions?: string[]
  partition?: TableDesignerPartition | null
  /** 编辑已有 MySQL 分区表时的分区维护操作（ADD / DROP / TRUNCATE / REORGANIZE）。 */
  partitionChanges?: TableDesignerPartitionChange[]
}

export interface TableDesignerValidation {
  valid: boolean
  errors: string[]
  /** 按字段 / 索引的编辑器 ID 归类，用于行内提示。 */
  columnErrors: Record<string, string[]>
  indexErrors: Record<string, string[]>
  foreignKeyErrors: Record<string, string[]>
  checkErrors: Record<string, string[]>
  triggerErrors: Record<string, string[]>
}

/** 保存前展示的变更摘要条目。 */
export interface TableDesignerChange {
  action: 'add' | 'modify' | 'remove' | 'rename'
  /** i18n 键：字段 / 索引 / 外键 / 检查约束 / 触发器 / 表 */
  target: string
  name: string
  detail?: string
}

export interface TableDesignerOptions {
  kind: DatabaseKind
  draft: TableDesignerDraft
  /** 编辑模式下当前表已有的非标准类型（如 ENUM），跳过类型与长度校验。 */
  extraTypes?: readonly string[]
}
