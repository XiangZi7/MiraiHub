<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  injectWorkspaceTabSplit,
  type WorkspaceSplitNode,
} from '@/composables/useWorkspaceTabSplit'
import type { WorkspaceTab } from '@/composables/useWorkspaceTabs'
import type { TabDragEvent } from '@/composables/useTabReorder'
import WorkspaceTabBar from './WorkspaceTabBar.vue'
import ServerOperations from '@/components/operations/ServerOperations.vue'
import SplitDivider from '@/components/ui/SplitDivider.vue'
import SplitDropIndicator from '@/components/ui/SplitDropIndicator.vue'
import IconButton from '@/components/ui/IconButton.vue'

const { t } = useI18n()
const props = defineProps<{
  node: WorkspaceSplitNode
  tabs: readonly WorkspaceTab[]
  closeWarning: (ids: string[]) => string
}>()
const emit = defineEmits<{
  activate: [id: string]
  add: []
  closeMany: [ids: string[]]
  action: [id: string, action: string]
}>()
const layout = injectWorkspaceTabSplit()!
const groupTabs = computed(() =>
  props.node.type === 'group'
    ? props.node.tabIds.flatMap(id => {
        const tab = props.tabs.find(tab => tab.id === id)
        return tab ? [tab] : []
      })
    : []
)
const activeTab = computed(() => {
  const node = props.node
  return node.type === 'group'
    ? groupTabs.value.find(tab => tab.id === node.activeId)
    : undefined
})
function activate(id: string): void {
  if (id) {
    layout.activate(id)
    emit('activate', id)
  }
}
function focusGroup(): void {
  if (props.node.type === 'group') activate(props.node.activeId)
}
function dropTab(drag: TabDragEvent): void {
  if (layout.drop(drag)) activate(drag.id)
}
function merge(): void {
  const id = layout.mergeGroup(props.node.id)
  if (id) activate(id)
}
</script>

<template>
  <div
    v-if="node.type === 'split'"
    :data-workspace-split-node="node.id"
    :class="[
      'flex min-h-0 min-w-0 flex-1',
      node.orientation === 'vertical' ? 'flex-col' : 'flex-row',
    ]"
  >
    <template
      v-for="(child, index) in node.children"
      :key="child.id"
    >
      <SplitDivider
        v-if="index > 0"
        :orientation="node.orientation"
        :value-now="node.ratios[0]"
        @resize="layout.resize(node.id, $event)"
        @reset="layout.resize(node.id, 50)"
      />
      <div
        class="flex min-h-0 min-w-0 shrink basis-0"
        :style="{ flexGrow: node.ratios[index] }"
      >
        <WorkspaceSplitNode
          :node="child"
          :tabs="tabs"
          :close-warning="closeWarning"
          @activate="activate"
          @add="emit('add')"
          @close-many="emit('closeMany', $event)"
          @action="(id, action) => emit('action', id, action)"
        />
      </div>
    </template>
  </div>
  <div
    v-else
    :data-workspace-tab-group="node.id"
    :class="[
      'flex min-h-0 min-w-0 flex-1 flex-col',
      layout.focusedGroupId.value === node.id && 'workspace-group-active',
    ]"
    @pointerdown.capture="focusGroup"
    @focusin="focusGroup"
  >
    <div
      data-workspace-tab-bar
      :class="[
        'border-line-soft flex h-11 min-w-0 shrink-0 items-end gap-1 border-b px-2',
        layout.dropTarget.value?.groupId === node.id &&
          layout.dropTarget.value.position === 'center' &&
          'bg-violet/10',
      ]"
    >
      <WorkspaceTabBar
        :tabs="groupTabs"
        :active="node.activeId"
        :close-warning="closeWarning"
        class="flex-1"
        @update:active="activate"
        @add="emit('add')"
        @close-many="emit('closeMany', $event)"
        @action="(id, action) => emit('action', id, action)"
        @reorder="(from, to) => layout.reorder(node.id, from, to)"
        @tab-drag-move="layout.preview"
        @tab-drop="dropTab"
        @tab-drag-end="layout.clearPreview"
      />
      <div class="flex shrink-0 items-center gap-0.5 pb-1.5">
        <ServerOperations
          :session-id="
            activeTab?.connection.kind === 'ssh'
              ? activeTab.sessionId
              : undefined
          "
        />
        <IconButton
          v-if="layout.split.value"
          icon="lucide:panel-top-close"
          :size="14"
          :title="t('合并分组（保留全部连接标签）')"
          @click="merge"
        />
      </div>
    </div>
    <div
      :ref="el => layout.setTarget(node.id, el)"
      :data-workspace-split-pane="node.activeId"
      class="relative flex min-h-0 min-w-0 flex-1 p-2"
    >
      <SplitDropIndicator
        v-if="layout.dropTarget.value?.groupId === node.id"
        :direction="layout.dropTarget.value.position"
      />
    </div>
  </div>
</template>
