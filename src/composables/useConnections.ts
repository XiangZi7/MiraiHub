/**
 * 已保存连接的全局状态。
 *
 * 用模块级单例而不是 provide/inject：连接窗口是独立的 window，
 * 两个窗口共享的是 localStorage 而非组件树，
 * 各自持有一份这样的单例、靠存储层的 subscribe 保持同步即可。
 */

import { computed, reactive, readonly } from 'vue'
import * as store from '@/api/connections'
import type {
  ConnectionGroup,
  ConnectionGroupKind,
  ConnectionGroupView,
  ConnectionKind,
  NewConnection,
  SavedConnection,
} from '@/types/connection'

const state = reactive({
  // 全部已保存的连接
  items: [] as SavedConnection[],
  groups: [] as ConnectionGroup[],
  // 首次加载是否完成，避免加载途中把空列表当成"一条都没有"
  loaded: false,
})

/** 从存储层重新拉取 */
async function refresh(): Promise<void> {
  const [items, groups] = await Promise.all([store.list(), store.listGroups()])
  state.items = items
  state.groups = groups
  state.loaded = true
}

// 存储变更时自动同步。订阅在模块加载时建立且不再取消 ——
// 单例的生命周期就是页面的生命周期
store.subscribe(() => void refresh())

void refresh()

/** SSH 连接 */
const sshConnections = computed(() =>
  state.items.filter(item => item.kind === 'ssh'),
)

/** 数据库连接 */
const databaseConnections = computed(() =>
  state.items.filter(item => item.kind !== 'ssh'),
)

/**
 * 按分组名聚合，用于侧栏项目树。
 *
 * 未分组的连接归到"Ungrouped"而不是丢掉 —— 新建时不填分组是常态。
 */
function groupBy(
  connections: SavedConnection[],
  declaredGroups: ConnectionGroup[],
  kind: ConnectionGroupKind,
): ConnectionGroupView[] {
  const groups = new Map<string, ConnectionGroupView>()

  for (const group of declaredGroups.filter(group => group.kind === kind)) {
    groups.set(group.name.trim().toLocaleLowerCase(), { ...group, items: [] })
  }

  for (const item of connections) {
    const name = item.group.trim() || 'Ungrouped'
    const key = name.toLocaleLowerCase()
    const bucket = groups.get(key)

    if (bucket)
      bucket.items.push(item)
    else {
      groups.set(key, {
        id: name === 'Ungrouped' ? `ungrouped-${kind}` : `implicit-${kind}-${key}`,
        name,
        kind,
        createdAt: item.createdAt,
        items: [item],
        virtual: true,
      })
    }
  }

  // 名称排序，但 Ungrouped 永远垫底 —— 它是兜底桶，不该抢占视线
  return [...groups.values()]
    .sort((a, b) => {
      if (a.name === 'Ungrouped')
        return 1
      if (b.name === 'Ungrouped')
        return -1
      return a.name.localeCompare(b.name)
    })
}

export function useConnections() {
  return {
    connections: readonly(state).items,
    groups: readonly(state).groups,
    loaded: computed(() => state.loaded),
    sshConnections,
    databaseConnections,

    /** 按 kind 取出对应的分组树 */
    groupsFor: (kind: ConnectionKind | 'database') => {
      const groupKind = kind === 'database' ? 'database' : 'ssh'
      return groupBy(
        groupKind === 'database' ? databaseConnections.value : sshConnections.value,
        state.groups,
        groupKind,
      )
    },

    find: (id: string) => state.items.find(item => item.id === id),

    refresh,

    async create(input: NewConnection): Promise<SavedConnection> {
      const created = await store.create(input)
      await refresh()
      return created
    },

    async update(id: string, patch: Partial<Omit<SavedConnection, 'id'>>): Promise<void> {
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

    async removeGroup(id: string): Promise<void> {
      await store.removeGroup(id)
      await refresh()
    },

    /** 记一次使用，驱动"最近"排序 */
    async touch(id: string): Promise<void> {
      await store.touch(id)
      await refresh()
    },
  }
}
