import { useStorage } from '@vueuse/core'
import type { SqlSnippet } from '@/utils/sql-snippets'

/** 用户自定义片段，全局共享并持久化到本地存储；多个编辑器读到同一份。 */
const customSnippets = useStorage<SqlSnippet[]>(
  'miraihub.database.sql-snippets',
  []
)

/** 自定义 SQL 片段的读取与增删改，供编辑器补全和片段管理面板使用。 */
export function useSqlSnippets() {
  /** 保存片段：id 已存在时更新，否则追加到列表末尾。 */
  function saveSnippet(snippet: SqlSnippet): void {
    const exists = customSnippets.value.some(item => item.id === snippet.id)
    customSnippets.value = exists
      ? customSnippets.value.map(item =>
          item.id === snippet.id ? snippet : item
        )
      : [...customSnippets.value, snippet]
  }

  /** 按 id 删除一条自定义片段。 */
  function removeSnippet(id: string): void {
    customSnippets.value = customSnippets.value.filter(item => item.id !== id)
  }

  return { customSnippets, saveSnippet, removeSnippet }
}
