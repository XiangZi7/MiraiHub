<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
import { injectWorkspaceTabSplit } from '@/composables/useWorkspaceTabSplit'
import { isDatabaseConnection } from '@/types/connection'
import WorkspaceSplitNode from './WorkspaceSplitNode.vue'

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
const { activeNav, selectTab } = useWorkspaceNavigation()
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
      const tab = workspace.tabs.find(tab => tab.id === group.activeId)
      if (!tab) continue
      if (isDatabaseConnection(tab.connection)) state.databasesVisited = true
      else state.serversVisited = true
    }
  },
  { immediate: true }
)
function activate(id: string): void {
  layout.activate(id)
  if (workspace.activeId !== id) void selectTab(id)
}
</script>

<template>
  <div
    v-show="connectionPage"
    class="flex min-h-0 min-w-0 flex-1"
  >
    <WorkspaceSplitNode
      :node="layout.tree.value"
      :tabs="workspace.tabs"
      :close-warning="closeWarning"
      @activate="activate"
      @add="emit('add')"
      @close-many="emit('closeMany', $event)"
      @action="(id, action) => emit('action', id, action)"
    />
  </div>
  <!-- 会话组件始终位于缓存宿主中，嵌套分屏、移动标签、折叠空分组只移动 DOM。 -->
  <div class="hidden">
    <ServersPage v-if="state.serversVisited" />
    <DatabasesPage v-if="state.databasesVisited" />
  </div>
</template>
