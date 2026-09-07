import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, onScopeDispose, reactive, toRefs } from 'vue'
import * as store from '@/api/connections'
import { settingsSnapshot } from '@/composables/useSettings'
import type {
  ConnectionGroup,
  ConnectionGroupDropPosition,
  ConnectionGroupKind,
  ConnectionGroupView,
  ConnectionKind,
  ConnectionTagDefinition,
  NewConnection,
  SavedConnection,
} from '@/types/connection'

export const useConnectionsStore = defineStore('connections', () => {
  const state = reactive({
    // 全部已保存的连接
    items: [] as SavedConnection[],
    groups: [] as ConnectionGroup[],
    tags: [] as ConnectionTagDefinition[],
    // 首次加载是否完成，避免加载途中把空列表当成"一条都没有"
    loaded: false,
    error: '',
  })

  /** 从存储层重新拉取 */
  let disposed = false
  let pending: Promise<void> | undefined
  let refreshRequested = false
  function refresh(): Promise<void> {
    refreshRequested = true
    return (pending ??= (async () => {
      do {
        refreshRequested = false
        const [items, groups, tags] = await Promise.all([
          store.list(),
          store.listGroups(),
          store.listTags(),
        ])
        if (disposed) return
        state.items.splice(0, state.items.length, ...items)
        state.groups.splice(0, state.groups.length, ...groups)
        state.tags.splice(0, state.tags.length, ...tags)
        state.loaded = true
        state.error = ''
      } while (refreshRequested)
    })()
      .catch(error => {
        state.error = error instanceof Error ? error.message : String(error)
        throw error
      })
      .finally(() => {
        pending = undefined
      }))
  }
  function initialize(): Promise<void> {
    return pending ?? (state.loaded ? Promise.resolve() : refresh())
  }
  const unsubscribe = store.subscribe(() => {
    void refresh().catch(error => {
      state.error = String(error)
    })
  })
  onScopeDispose(() => {
    disposed = true
    unsubscribe()
  })

  /** 服务器终端（SSH 与本地 PTY 共用侧栏分组） */
  const sshConnections = computed(() =>
    state.items.filter(item => item.kind === 'ssh' || item.kind === 'local')
  )

  /** 数据库连接 */
  const databaseConnections = computed(() =>
    state.items.filter(
      item => item.kind === 'mysql' || item.kind === 'postgresql'
    )
  )

  /**
   * 按分组名聚合，用于侧栏项目树。
   *
   * 未分组的连接归到"Ungrouped"而不是丢掉 —— 新建时不填分组是常态。
   */
  function groupBy(
    connections: SavedConnection[],
    declaredGroups: ConnectionGroup[],
    kind: ConnectionGroupKind
  ): ConnectionGroupView[] {
    const groups = new Map<string, ConnectionGroupView>()

    for (const group of declaredGroups.filter(group => group.kind === kind)) {
      groups.set(group.name.trim().toLocaleLowerCase(), {
        ...group,
        items: [],
      })
    }

    for (const item of connections) {
      const name = item.group.trim() || 'Ungrouped'
      const key = name.toLocaleLowerCase()
      const bucket = groups.get(key)

      if (bucket) bucket.items.push(item)
      else {
        groups.set(key, {
          id:
            name === 'Ungrouped'
              ? `ungrouped-${kind}`
              : `implicit-${kind}-${key}`,
          name,
          kind,
          createdAt: item.createdAt,
          items: [item],
          virtual: true,
        })
      }
    }

    // 实体分组保留存储顺序；Ungrouped 是运行时兜底桶，固定垫底。
    const views = [...groups.values()]
    return [
      ...views.filter(group => group.name !== 'Ungrouped'),
      ...views.filter(group => group.name === 'Ungrouped'),
    ]
  }

  return {
    ...toRefs(state),
    initialize,
    sshConnections,
    databaseConnections,

    /** 按 kind 取出对应的分组树 */
    groupsFor: (kind: ConnectionKind | 'database') => {
      const groupKind = kind === 'database' ? 'database' : 'ssh'
      return groupBy(
        groupKind === 'database'
          ? databaseConnections.value
          : sshConnections.value,
        state.groups,
        groupKind
      )
    },

    find: (id: string) => state.items.find(item => item.id === id),

    refresh,

    async create(input: NewConnection): Promise<SavedConnection> {
      const created = await store.create(input)
      await refresh()
      return created
    },

    async update(
      id: string,
      patch: Partial<Omit<SavedConnection, 'id'>>
    ): Promise<void> {
      await store.update(id, patch)
      await refresh()
    },

    async remove(id: string): Promise<void> {
      await store.remove(id)
      await refresh()
    },

    async createGroup(kind: ConnectionGroupKind, name: string): Promise<void> {
      await store.createGroup(kind, name)
      await refresh()
    },

    async renameGroup(id: string, name: string): Promise<void> {
      await store.renameGroup(id, name)
      await refresh()
    },

    async reorderGroup(
      id: string,
      targetId: string,
      position: ConnectionGroupDropPosition
    ): Promise<void> {
      await store.reorderGroup(id, targetId, position)
      await refresh()
    },

    async removeGroup(id: string): Promise<void> {
      await store.removeGroup(id)
      await refresh()
    },

    /** 记一次使用，仅供 Recent 视图按最近时间排序 */
    async touch(id: string): Promise<void> {
      if (!settingsSnapshot().saveSessionHistory) return
      await store.touch(id)
      await refresh()
    },
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useConnectionsStore, import.meta.hot))
