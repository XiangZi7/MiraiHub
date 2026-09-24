import { shallowRef, watch, type Ref } from 'vue'
import * as database from '@/api/database'

/** 切库/重连/刷新表结构时重读；迟到的响应不能污染新连接的提示。 */
export function useDatabaseCompletions(
  sessionId: Ref<string>,
  schema: Ref<string>,
  catalog: Ref<unknown>
) {
  const columns = shallowRef<string[]>([])
  watch(
    [sessionId, schema, catalog],
    async ([id, databaseName], _previous, onCleanup) => {
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })
      columns.value = []
      if (!id) return
      try {
        const values = await database.completionColumns(id, databaseName)
        if (!cancelled) columns.value = values
      } catch {
        // 元数据权限不足时仍允许编辑和运行 SQL，已有的对象字段仍参与补全。
      }
    },
    { immediate: true }
  )
  return columns
}
