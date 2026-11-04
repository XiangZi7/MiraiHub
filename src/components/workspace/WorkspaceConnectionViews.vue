<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
import { injectWorkspaceTabSplit } from '@/composables/useWorkspaceTabSplit'
import { isDatabaseConnection } from '@/types/connection'
import WorkspaceSplitNode from './WorkspaceSplitNode.vue'
import {
  useDatabaseWorkspaceTabs,
  workspaceViewTabs,
  databaseWorkspaceTabTarget,
} from '@/composables/useDatabaseWorkspaceTabs'

const TerminalPanel = defineAsyncComponent(
  () => import('@/components/workspace/TerminalPanel.vue')
)
const DatabaseView = defineAsyncComponent(
  () => import('@/components/workspace/DatabaseView.vue')
)

const ServersPage = defineAsyncComponent(
  () => import('@/pages/workspace/ServersPage.vue')
)
const DatabasesPage = defineAsyncComponent(
  () => import('@/pages/workspace/DatabasesPage.vue')
)
defineProps<{ closeWarning: (ids: string[]) => string }>()
const emit = defineEmits<{
  add: []
  closeMany: [ids: string[]]
  action: [id: string, action: string]
}>()
const workspace = useWorkspaceStore()
const databaseTabs = useDatabaseWorkspaceTabs()
const viewTabs = computed(() => workspaceViewTabs(workspace.tabs, databaseTabs))
const { activeNav, hasOpenSectionTabs, selectTab } = useWorkspaceNavigation()
const layout = injectWorkspaceTabSplit()!
const state = reactive({ serversVisited: false, databasesVisited: false })
const connectionPage = computed(() =>
  ['servers', 'databases'].includes(activeNav.value)
)
watch(
  () => [activeNav.value, layout.groups.value] as const,
  ([nav, groups]) => {
    if (nav === 'servers') state.serversVisited = true
    if (nav === 'databases') state.databasesVisited = true
    for (const group of groups) {
      const owner =
        databaseWorkspaceTabTarget(group.activeId)?.connectionId ??
        group.activeId
      const tab = workspace.tabs.find(tab => tab.id === owner)
      if (!tab) continue
      if (isDatabaseConnection(tab.connection)) state.databasesVisited = true
      else state.serversVisited = true
    }
  },
  { immediate: true }
)
// 分屏焦点使用实际内容标签；导航只切换所属连接，不改变其他分屏的选中项。
function activate(id: string): void {
  layout.activate(id)
  const target = databaseWorkspaceTabTarget(id)
  const owner = target?.connectionId ?? id
  databaseTabs?.get(owner)?.select(target?.tabId ?? '')
  if (workspace.activeId !== owner) void selectTab(owner)
}
</script>

<template>
  <div
    v-show="connectionPage"
    class="flex min-h-0 min-w-0 flex-1"
  >
    <WorkspaceSplitNode
      v-show="hasOpenSectionTabs"
      :node="layout.tree.value"
      :tabs="viewTabs"
      :close-warning="closeWarning"
      @activate="activate"
      @add="emit('add')"
      @close-many="emit('closeMany', $event)"
      @action="(id, action) => emit('action', id, action)"
    />
    <!-- 分类没有打开的连接时，空状态独占内容区；原分屏只隐藏，保留会话。 -->
    <div
      v-if="connectionPage && !hasOpenSectionTabs"
      class="flex min-h-0 min-w-0 flex-1 p-2"
    >
      <TerminalPanel v-if="activeNav === 'servers'" />
      <DatabaseView v-else />
    </div>
  </div>
  <!-- 会话组件始终位于缓存宿主中，嵌套分屏、移动标签、折叠空分组只移动 DOM。 -->
  <div class="hidden">
    <ServersPage v-if="state.serversVisited" />
    <DatabasesPage v-if="state.databasesVisited" />
  </div>
</template>
