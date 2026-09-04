import type { DatabaseKind } from "./database";

export type TableIndexKind = "index" | "unique" | "fulltext";
export type ReferentialAction = "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL";

export interface TableDesignerColumn {
  id: string;
  name: string;
  dataType: string;
  length: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  unsigned: boolean;
  autoIncrement: boolean;
  defaultValue: string;
  comment: string;
}

export interface TableDesignerIndex {
  id: string;
  name: string;
  kind: TableIndexKind;
  method: "btree" | "hash";
  columns: string[];
}

export interface TableDesignerForeignKey {
  id: string;
  name: string;
  column: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: ReferentialAction;
  onUpdate: ReferentialAction;
}

export interface TableDesignerDraft {
  schema: string;
  name: string;
  comment: string;
  engine: string;
  charset: string;
  columns: TableDesignerColumn[];
  indexes: TableDesignerIndex[];
  foreignKeys: TableDesignerForeignKey[];
}

export interface TableDesignerValidation {
  valid: boolean;
  errors: string[];
}

export interface TableDesignerOptions {
  kind: DatabaseKind;
  draft: TableDesignerDraft;
}
