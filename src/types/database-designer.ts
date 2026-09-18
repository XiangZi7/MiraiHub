import type { DatabaseKind } from './database'

export type TableIndexKind = 'index' | 'unique' | 'fulltext'
export type ReferentialAction =
  | 'NO ACTION'
  | 'RESTRICT'
  | 'CASCADE'
  | 'SET NULL'
  | 'SET DEFAULT'

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
}

export interface TableDesignerIndex {
  id: string
  name: string
  kind: TableIndexKind
  method: 'btree' | 'hash'
  columns: string[]
}

export interface TableDesignerForeignKey {
  id: string
  name: string
  column: string
  referencedSchema: string
  referencedTable: string
  referencedColumn: string
  onDelete: ReferentialAction
  onUpdate: ReferentialAction
}

export interface TableDesignerDraft {
  schema: string
  name: string
  comment: string
  engine: string
  charset: string
  /** MySQL 表选项的自增计数器；null 表示不修改（新建表时也没有）。 */
  autoIncrement: number | null
  columns: TableDesignerColumn[]
  indexes: TableDesignerIndex[]
  foreignKeys: TableDesignerForeignKey[]
}

export interface TableDesignerValidation {
  valid: boolean
  errors: string[]
}

export interface TableDesignerOptions {
  kind: DatabaseKind
  draft: TableDesignerDraft
  /** 编辑模式下当前表已有的非标准类型（如 ENUM），跳过类型与长度校验。 */
  extraTypes?: readonly string[]
}
