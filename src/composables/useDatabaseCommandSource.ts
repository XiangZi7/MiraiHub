import { onBeforeUnmount, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import type { DatabaseObject } from '@/types/database'
import type { SavedDatabaseQuery } from '@/types/database-query'

/** 命令面板里的一条数据库动作 */
export interface DatabasePaletteAction {
  id: string
  label: string
  icon: string
  /** 返回 false 表示当前不可用，面板里置灰 */
  enabled?: () => boolean
  /**
   * 选中后的行为：普通动作直接执行；
   * 'pick-object' / 'pick-design' 让面板切到 "#" 模式继续挑表。
   */
  run: (() => void) | 'pick-object' | 'pick-design'
}

/** 当前激活的数据库视图向命令面板暴露的数据源 */
export interface DatabaseCommandSource {
  connectionId: string
  connectionName: string
  objects: Ref<readonly DatabaseObject[]>
  savedQueries: Ref<readonly SavedDatabaseQuery[]>
  actions: DatabasePaletteAction[]
  openObject: (object: DatabaseObject) => void
  designObject: (object: DatabaseObject) => void
  openSavedQuery: (query: SavedDatabaseQuery) => void
}

// 同一时刻只有一个数据库视图处于激活状态，模块级单例即可。
const activeSource = shallowRef<DatabaseCommandSource | null>(null)

/** 命令面板读取当前激活的数据库数据源 */
export function useDatabaseCommandSource(): Ref<DatabaseCommandSource | null> {
  return activeSource
}

/**
 * 数据库视图在激活且已连接时登记自己，失活或卸载时撤销。
 * 只撤销自己登记的那一份，避免把别的视图刚登记的数据源清掉。
 */
export function registerDatabaseCommandSource(
  enabled: () => boolean,
  build: () => DatabaseCommandSource
): void {
  let mine: DatabaseCommandSource | null = null
  const release = (): void => {
    if (mine && activeSource.value === mine) activeSource.value = null
    mine = null
  }
  watch(
    enabled,
    on => {
      if (on) {
        mine = build()
        activeSource.value = mine
      } else release()
    },
    { immediate: true }
  )
  onBeforeUnmount(release)
}
