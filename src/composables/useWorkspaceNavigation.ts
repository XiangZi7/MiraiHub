import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConnectionsStore } from '@/stores/connections'
import { useWorkspaceStore } from '@/stores/workspace'
import { connectionLocation } from '@/router'
import type { NavId } from '@/types'
import type { SavedConnection } from '@/types/connection'

export function useWorkspaceNavigation() {
  const route = useRoute()
  const router = useRouter()
  const connections = useConnectionsStore()
  const workspace = useWorkspaceStore()
  const activeNav = computed(() => route.meta.nav ?? 'servers')
  async function selectNav(nav: NavId): Promise<void> {
    await router.push({ name: nav })
  }
  async function openConnection(connection: SavedConnection): Promise<void> {
    // 显式重新打开才更新连接配置；普通标签/历史导航只切换活动项。
    if (workspace.tabs.some(tab => tab.id === connection.id))
      workspace.open(connection)
    const failure = await router.push(connectionLocation(connection))
    if (!failure) void connections.touch(connection.id)
  }
  async function selectTab(id: string): Promise<void> {
    const tab = workspace.tabs.find(item => item.id === id)
    if (tab) await router.push(connectionLocation(tab.connection))
  }
  async function followActiveTab(): Promise<void> {
    // 关闭标签用 replace，不把刚关闭的页面重新压入历史。
    await router.replace(
      workspace.active
        ? connectionLocation(workspace.active.connection)
        : { name: activeNav.value, params: {} }
    )
  }
  return { activeNav, selectNav, openConnection, selectTab, followActiveTab }
}
