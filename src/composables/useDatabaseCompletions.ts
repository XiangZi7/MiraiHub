import { shallowRef, watch, type Ref } from 'vue'
import * as database from '@/api/database'

interface CompletionMetadata {
  columns: string[]
  tableColumns: Record<string, string[]>
}

/** 最多缓存的“连接 + 库”元数据份数；切回最近用过的库不必再查一次 information_schema。 */
const CACHE_LIMIT = 12
// Map 保持插入顺序：命中时删除后重新插入即移到末尾，淘汰时删最前面的。
const cache = new Map<string, Promise<CompletionMetadata>>()

const cacheKey = (sessionId: string, schema: string) =>
  `${sessionId}\u0000${schema}`

/** 使补全元数据缓存失效。DDL 执行后或手动刷新表结构时调用；不传库名则清空整个会话。 */
export function invalidateCompletionCache(
  sessionId: string,
  schema?: string
): void {
  if (schema !== undefined) {
    cache.delete(cacheKey(sessionId, schema))
    return
  }
  for (const key of [...cache.keys()])
    if (key.startsWith(`${sessionId}\u0000`)) cache.delete(key)
}

async function loadMetadata(
  sessionId: string,
  schema: string
): Promise<CompletionMetadata> {
  const [columns, pairs] = await Promise.all([
    // 元数据权限不足时仍允许编辑和运行 SQL，已有的对象字段仍参与补全。
    database.completionColumns(sessionId, schema).catch(() => [] as string[]),
    // 映射只是增强体验，失败时退回扁平补全。
    database
      .completionTableColumns(sessionId, schema)
      .catch(() => [] as [string, string][]),
  ])
  const tableColumns: Record<string, string[]> = {}
  for (const [table, column] of pairs) (tableColumns[table] ??= []).push(column)
  return { columns, tableColumns }
}

function cachedMetadata(
  sessionId: string,
  schema: string
): Promise<CompletionMetadata> {
  const key = cacheKey(sessionId, schema)
  let entry = cache.get(key)
  if (entry) cache.delete(key)
  else {
    entry = loadMetadata(sessionId, schema)
    // 两次请求都失败时不缓存空结果，下次再试。
    entry.then(
      value => {
        if (!value.columns.length && !Object.keys(value.tableColumns).length)
          cache.delete(key)
      },
      () => cache.delete(key)
    )
  }
  cache.set(key, entry)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return entry
}

/** 切库/重连/刷新表结构时重读；迟到的响应不能污染新连接的提示。
 *  同时返回扁平字段列表和“表名 → 字段”映射（别名补全、FROM 推断用）。
 *  结果按连接/库做 LRU 缓存，DDL 后由 invalidateCompletionCache 失效。 */
export function useDatabaseCompletions(
  sessionId: Ref<string>,
  schema: Ref<string>,
  catalog: Ref<unknown>
) {
  const columns = shallowRef<string[]>([])
  const tableColumns = shallowRef<Record<string, string[]>>({})
  watch(
    [sessionId, schema, catalog],
    async ([id, databaseName], previous, onCleanup) => {
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })
      // 只是对象列表刷新（同一会话同一库）时保留旧提示，避免补全短暂变空。
      const sameScope =
        previous && previous[0] === id && previous[1] === databaseName
      if (!sameScope) {
        columns.value = []
        tableColumns.value = {}
      }
      if (!id) return
      try {
        const metadata = await cachedMetadata(id, databaseName)
        if (cancelled) return
        columns.value = metadata.columns
        tableColumns.value = metadata.tableColumns
      } catch {
        // loadMetadata 已吞掉单项错误，这里只防御意外异常。
      }
    },
    { immediate: true }
  )
  return { columns, tableColumns }
}
