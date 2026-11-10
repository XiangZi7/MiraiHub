<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
import { registerWorkspaceController } from '@/composables/useWorkspaceControllers'
import { injectWorkspaceTabSplit } from '@/composables/useWorkspaceTabSplit'
import { isDatabaseConnection } from '@/types/connection'
import type { SshSessionStatus } from '@/types/ssh'
import DatabaseView from '@/components/workspace/DatabaseView.vue'
import RedisView from '@/pages/databases/components/redis-view.vue'
import {
  useDatabaseWorkspaceTabs,
  databaseWorkspaceTabId,
} from '@/composables/useDatabaseWorkspaceTabs'
const workspace = useWorkspaceStore()
const openTabs = workspace.tabs
const { activeId, active: activeTab } = storeToRefs(workspace)
const { activeNav } = useWorkspaceNavigation()
const tabSplit = injectWorkspaceTabSplit()
const databaseTabs = useDatabaseWorkspaceTabs()
/** 根据分屏或当前活动标签判断数据库视图可见性，隐藏时保留连接与草稿。 */
function visible(id: string): boolean {
  return tabSplit ? tabSplit.isVisible(id) : activeId.value === id
}
const views =
  useTemplateRef<
    Array<InstanceType<typeof DatabaseView> | InstanceType<typeof RedisView>>
  >('databaseViews')
/** 将数据库连接及其 SSH 隧道的会话状态同步到工作区标签。 */
const handleSshStatus = (
  id: string,
  status: SshSessionStatus,
  sessionId: string
) => workspace.setStatus(id, status, sessionId)
const activeDatabaseConnection = computed(() => {
  const connection = activeTab.value?.connection
  return connection && isDatabaseConnection(connection) ? connection : undefined
})

/** 数据库标签独立挂载，使每条连接的连接池、SQL 草稿与结果互不覆盖。 */
const databaseTabViews = computed(() =>
  openTabs.flatMap(tab => {
    const connection = tab.connection
    if (!isDatabaseConnection(connection)) return []
    const ids = [
      tab.id,
      ...(databaseTabs?.get(tab.id)?.tabs() ?? []).map(content =>
        databaseWorkspaceTabId(tab.id, content.id)
      ),
    ]
    // 连接壳固定在连接标签所属分组，只承载该组的活动内容。
    // 其他分屏的表独立投放，新增表或标签排序不能把目录树搬到另一屏。
    const groupActiveId = tabSplit?.groupForTab(tab.id)?.activeId
    const hostId =
      groupActiveId && ids.includes(groupActiveId) ? groupActiveId : tab.id
    return [{ id: tab.id, connection, hostId }]
  })
)

registerWorkspaceController('databases', {
  /** 汇总待关闭连接的未保存内容，供工作区统一进行关闭确认。 */
  closeWarning: ids =>
    (views.value ?? [])
      .map(view => view.closeWarningFor(ids))
      .filter(Boolean)
      .join('；'),
  /** 将侧栏刷新请求交给持有该连接的数据库视图。 */
  refreshDatabase: id => {
    for (const view of views.value ?? []) view.refreshForConnection(id)
  },
  /** 在指定数据库连接中创建查询，并等待对应视图完成处理。 */
  newQuery: async (id, database) => {
    for (const view of views.value ?? [])
      await view.newQueryForConnection(id, database)
  },
  /** 将工作区菜单的重连或断开操作交给对应数据库或 Redis 视图。 */
  action: async (id, action) => {
    for (const view of views.value ?? []) {
      if (action === 'reconnect') await view.reconnectFor(id)
      else if (action === 'disconnect') await view.disconnectFor(id)
    }
  },
})
</script>
<template>
  <div class="contents">
    <Teleport
      v-for="tab in databaseTabViews"
      :key="tab.id"
      :to="tabSplit?.targetFor(tab.hostId) ?? 'body'"
      :disabled="!tabSplit?.targetFor(tab.hostId)"
    >
      <component
        :is="tab.connection.kind === 'redis' ? RedisView : DatabaseView"
        v-show="visible(tab.hostId)"
        ref="databaseViews"
        :connection="tab.connection"
        :workspace-host-id="tab.hostId"
        :active="
          visible(tab.hostId) &&
          (Boolean(tabSplit) || activeNav === 'databases')
        "
        @status="
          (status, sessionId) => handleSshStatus(tab.id, status, sessionId)
        "
      />
    </Teleport>
    <Teleport
      :to="tabSplit?.targetFor(activeId) ?? 'body'"
      :disabled="!tabSplit?.targetFor(activeId)"
    >
      <DatabaseView
        v-if="!tabSplit && !activeDatabaseConnection"
        v-show="activeNav === 'databases'"
      />
    </Teleport>
  </div>
</template>
