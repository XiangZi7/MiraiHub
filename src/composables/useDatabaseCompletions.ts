import { shallowRef, watch, type Ref } from 'vue'
import * as database from '@/api/database'

/** 切库/重连/刷新表结构时重读；迟到的响应不能污染新连接的提示。
 *  同时返回扁平字段列表和“表名 → 字段”映射（别名补全用）。 */
export function useDatabaseCompletions(
  sessionId: Ref<string>,
  schema: Ref<string>,
  catalog: Ref<unknown>
) {
  const columns = shallowRef<string[]>([])
  const tableColumns = shallowRef<Record<string, string[]>>({})
  watch(
    [sessionId, schema, catalog],
    async ([id, databaseName], _previous, onCleanup) => {
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })
      columns.value = []
      tableColumns.value = {}
      if (!id) return
      try {
        const values = await database.completionColumns(id, databaseName)
        if (!cancelled) columns.value = values
      } catch {
        // 元数据权限不足时仍允许编辑和运行 SQL，已有的对象字段仍参与补全。
      }
      try {
        const pairs = await database.completionTableColumns(id, databaseName)
        if (cancelled) return
        const map: Record<string, string[]> = {}
        for (const [table, column] of pairs) (map[table] ??= []).push(column)
        tableColumns.value = map
      } catch {
        // 映射只是增强体验，失败时退回扁平补全。
      }
    },
    { immediate: true }
  )
  return { columns, tableColumns }
}
