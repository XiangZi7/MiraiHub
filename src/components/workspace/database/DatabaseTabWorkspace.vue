<script setup lang="ts" generic="T extends TabItem">
import type { TabItem } from '@/components/ui/TabBar.vue'
import { injectWorkspaceTabSplit } from '@/composables/useWorkspaceTabSplit'
import { databaseWorkspaceTabId } from '@/composables/useDatabaseWorkspaceTabs'

// 数据库内容保持挂载；标签入口统一由顶部主标签栏提供。
const props = defineProps<{
  tabs: readonly T[]
  active: string
  connectionId?: string
  workspaceHostId?: string
}>()
const layout = injectWorkspaceTabSplit()
defineSlots<{
  default(props: { tab: T; visible: boolean }): unknown
  toolbar(props: { tab: T }): unknown
  empty(): unknown
}>()

// 非连接壳当前内容的标签独立传送到主分屏；隐藏标签仍留在所属分组中保留实例。
function detachedTarget(tab: T): HTMLElement | undefined {
  if (!layout || !props.connectionId || props.workspaceHostId === undefined)
    return
  const id = databaseWorkspaceTabId(props.connectionId, tab.id)
  if (id === props.workspaceHostId) return
  return layout.targetFor(id)
}

// 每屏只显示自己的活动内容，不依赖同连接其他屏最近聚焦的查询。
function visible(tab: T): boolean {
  return detachedTarget(tab)
    ? Boolean(
        layout?.isVisible(databaseWorkspaceTabId(props.connectionId!, tab.id))
      )
    : tab.id === props.active
}
</script>

<template>
  <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <slot
      v-if="!tabs.some(tab => tab.id === active)"
      name="empty"
    />
    <Teleport
      v-for="tab in tabs"
      :key="tab.id"
      :to="detachedTarget(tab) ?? 'body'"
      :disabled="!detachedTarget(tab)"
    >
      <div
        v-show="visible(tab)"
        class="bg-panel border-line-soft flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px]"
        :data-database-content="tab.id"
      >
        <slot
          v-if="detachedTarget(tab)"
          name="toolbar"
          :tab="tab"
        />
        <slot
          :tab="tab"
          :visible="visible(tab)"
        />
      </div>
    </Teleport>
  </div>
</template>
