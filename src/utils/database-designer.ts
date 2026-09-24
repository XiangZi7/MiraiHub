import type { TableDesignerDraft } from '@/types/database-designer'

/** 比较用户可编辑的数据，忽略编辑器为行分配的临时 ID。 */
export function tableDesignerSnapshot(draft: TableDesignerDraft): string {
  return JSON.stringify({
    ...draft,
    columns: draft.columns.map(({ id: _id, ...column }) => column),
    indexes: draft.indexes.map(({ id: _id, ...index }) => index),
    foreignKeys: draft.foreignKeys.map(({ id: _id, ...key }) => key),
  })
}
