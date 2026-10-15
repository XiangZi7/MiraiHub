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
import RedisView from '@/components/workspace/RedisView.vue'
const workspace = useWorkspaceStore()
const openTabs = workspace.tabs
const { activeId, active: activeTab } = storeToRefs(workspace)
const { activeNav } = useWorkspaceNavigation()
const tabSplit = injectWorkspaceTabSplit()
function visible(id: string): boolean {
  return tabSplit ? tabSplit.isVisible(id) : activeId.value === id
}
const views =
  useTemplateRef<
    Array<InstanceType<typeof DatabaseView> | InstanceType<typeof RedisView>>
  >('databaseViews')
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
    return isDatabaseConnection(connection) ? [{ id: tab.id, connection }] : []
  })
)

registerWorkspaceController('databases', {
  closeWarning: ids =>
    (views.value ?? [])
      .map(view => view.closeWarningFor(ids))
      .filter(Boolean)
      .join('；'),
  refreshDatabase: id => {
    for (const view of views.value ?? []) view.refreshForConnection(id)
  },
  newQuery: async (id, database) => {
    for (const view of views.value ?? [])
      await view.newQueryForConnection(id, database)
  },
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
      :to="tabSplit?.targetFor(tab.id) ?? 'body'"
      :disabled="!tabSplit?.targetFor(tab.id)"
    >
      <component
        :is="tab.connection.kind === 'redis' ? RedisView : DatabaseView"
        v-show="visible(tab.id)"
        ref="databaseViews"
        :connection="tab.connection"
        :active="
          visible(tab.id) && (Boolean(tabSplit) || activeNav === 'databases')
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
        v-if="!activeDatabaseConnection"
        v-show="activeNav === 'databases'"
      />
    </Teleport>
  </div>
</template>
