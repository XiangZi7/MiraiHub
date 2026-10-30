<script setup lang="ts" generic="T extends TabItem">
import {
  nextTick,
  reactive,
  shallowReactive,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import TabBar, { type TabItem } from '@/components/ui/TabBar.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SplitPaneGroup from '@/components/ui/SplitPaneGroup.vue'
import SplitDropIndicator from '@/components/ui/SplitDropIndicator.vue'
import { useSplitPanes, type SplitDirection } from '@/composables/useSplitPanes'
import { useSplitDropZone } from '@/composables/useSplitDropZone'
import type { TabDragEvent } from '@/composables/useTabReorder'
import { splitDropAtPoint, type SplitDropPosition } from '@/utils/split-drop'
import type { ContextMenuItem } from '@/types/context-menu'

const props = defineProps<{
  tabs: readonly T[]
  contextItems: (id: string) => readonly ContextMenuItem[]
  tabLabel: (tab: T) => string
  tabTooltip?: (tab: T) => TabItem['tooltip']
}>()
const active = defineModel<string>('active', { required: true })
const emit = defineEmits<{
  add: []
  close: [id: string]
  closeMany: [ids: string[]]
  contextAction: [id: string, action: string]
  reorder: [from: number, to: number]
}>()
defineSlots<{
  default(props: { tab: T; visible: boolean }): unknown
  empty(): unknown
}>()
const { t } = useI18n()
const rootId = 'primary'
const stack = useTemplateRef<HTMLElement>('stack')
const {
  panes,
  ratios,
  orientation,
  activeId,
  split,
  add,
  remove,
  resize,
  focus,
  toggleOrientation,
  distributeEvenly,
} = useSplitPanes({ rootId })
// 响应式状态
const state = reactive({
  // 标签所属的分屏，移动时不重建其内容组件。
  owners: {} as Record<string, string>,
  // 每个分屏独立选中的标签。
  selections: { [rootId]: '' } as Record<string, string>,
  // 标签拖放时命中的面板和边缘方向。
  tabDrop: null as { paneId: string; position: SplitDropPosition } | null,
})
const { selections, tabDrop } = toRefs(state)
// DOM 目标保持原始对象，供 Teleport 在分屏之间移动已挂载的内容。
const targets = shallowReactive<Record<string, HTMLElement>>({})
function setTarget(id: string, element: unknown): void {
  if (element) targets[id] = element as HTMLElement
  else delete targets[id]
}
function tabsFor(id: string): T[] {
  return props.tabs.filter(tab => state.owners[tab.id] === id)
}
/** 为当前分屏的标签补上库名和悬停字段，面板内容仍使用原来的稳定标签实例。 */
function displayTabsFor(id: string): T[] {
  return tabsFor(id).map(tab => ({
    ...tab,
    label: props.tabLabel(tab),
    tooltip: props.tabTooltip?.(tab),
  }))
}
function select(id: string, tabId = state.selections[id] ?? ''): void {
  focus(id)
  state.selections[id] = tabId
  active.value = tabId
}
watch(
  () => props.tabs.map(tab => tab.id),
  ids => {
    const available = new Set(ids)
    for (const id of Object.keys(state.owners))
      if (!available.has(id)) delete state.owners[id]
    for (const id of ids)
      if (!state.owners[id]) state.owners[id] = activeId.value
    for (const pane of panes.value) {
      const tabs = tabsFor(pane.id)
      if (!tabs.some(tab => tab.id === state.selections[pane.id]))
        state.selections[pane.id] = tabs[0]?.id ?? ''
    }
  },
  { immediate: true, flush: 'sync' }
)
watch(
  active,
  id => {
    const owner = state.owners[id]
    if (owner) {
      state.selections[owner] = id
      focus(owner)
    }
  },
  { immediate: true, flush: 'sync' }
)
async function splitTab(
  direction: SplitDirection,
  tabId = active.value,
  anchorId?: string
): Promise<void> {
  if (!tabId) {
    emit('add')
    await nextTick()
    tabId = active.value
  }
  if (!tabId) return
  const source = state.owners[tabId] ?? activeId.value
  focus(anchorId ?? source)
  const destination = add(direction)
  state.owners[tabId] = destination
  state.selections[destination] = tabId
  state.selections[source] = tabsFor(source)[0]?.id ?? ''
  select(destination, tabId)
}
function dragMove(drag: TabDragEvent): void {
  state.tabDrop = null
  for (const pane of panes.value) {
    const target = targets[pane.id]
    if (!target) continue
    const position = splitDropAtPoint(
      drag.clientX,
      drag.clientY,
      target.getBoundingClientRect()
    )
    if (position) {
      state.tabDrop = { paneId: pane.id, position }
      return
    }
  }
}
function drop(drag: TabDragEvent): void {
  dragMove(drag)
  const destination = state.tabDrop
  state.tabDrop = null
  if (!destination) return
  if (destination.position !== 'center') {
    void splitTab(destination.position, drag.id, destination.paneId)
    return
  }
  const source = state.owners[drag.id]
  state.owners[drag.id] = destination.paneId
  if (source && source !== destination.paneId)
    state.selections[source] = tabsFor(source)[0]?.id ?? ''
  select(destination.paneId, drag.id)
}
async function closePane(id: string): Promise<void> {
  if (id === rootId) return
  for (const tab of tabsFor(id)) state.owners[tab.id] = rootId
  state.selections[rootId] ||= state.selections[id] ?? ''
  // 先移动内容，再移除 Teleport 目标，保留编辑器、表格改动和滚动位置。
  await nextTick()
  remove(id)
  delete state.selections[id]
  select(rootId)
}
const { direction, start, consumeSuppressedClick } = useSplitDropZone({
  container: () => stack.value,
  onDrop: direction => void splitTab(direction),
})
function newQuery(paneId: string): void {
  select(paneId)
  emit('add')
}
function startDrag(paneId: string, event: PointerEvent): void {
  select(paneId)
  start(event)
}
function splitClicked(): void {
  if (!consumeSuppressedClick()) void splitTab('right')
}
function contextItems(id: string): ContextMenuItem[] {
  return [
    ...props.contextItems(id),
    {
      id: 'split:right',
      label: t('左右分屏'),
      icon: 'lucide:columns-2',
      separatorBefore: true,
    },
    { id: 'split:down', label: t('上下分屏'), icon: 'lucide:rows-2' },
  ]
}
function contextAction(id: string, action: string): void {
  if (action === 'split:right' || action === 'split:down')
    void splitTab(action === 'split:right' ? 'right' : 'down', id)
  else emit('contextAction', id, action)
}
function reorder(paneId: string, from: number, to: number): void {
  const tabs = tabsFor(paneId)
  emit(
    'reorder',
    props.tabs.findIndex(tab => tab.id === tabs[from]?.id),
    props.tabs.findIndex(tab => tab.id === tabs[to]?.id)
  )
}
</script>

<template>
  <div
    ref="stack"
    class="relative flex min-h-0 min-w-0 flex-1"
  >
    <SplitPaneGroup
      :panes="panes"
      :ratios="ratios"
      :orientation="orientation"
      :active-id="activeId"
      @resize="resize"
      @reset="distributeEvenly"
    >
      <template #pane="{ pane, active: focused }">
        <section
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          :data-database-pane="pane.id"
          @pointerdown.capture="select(pane.id)"
          @focusin="select(pane.id)"
        >
          <div
            :class="[
              'border-line-soft flex h-10 min-w-0 shrink-0 items-center gap-1 border-b px-2',
              split && focused && 'bg-accent/5',
            ]"
          >
            <TabBar
              :tabs="displayTabsFor(pane.id)"
              :active="selections[pane.id] ?? ''"
              :context-items="contextItems"
              class="flex-1"
              addable
              split-draggable
              @update:active="select(pane.id, $event)"
              @add="newQuery(pane.id)"
              @close="emit('close', $event)"
              @close-many="emit('closeMany', $event)"
              @context-action="contextAction"
              @reorder="(from, to) => reorder(pane.id, from, to)"
              @tab-drag-move="dragMove"
              @tab-drop="drop"
              @tab-drag-end="state.tabDrop = null"
            />
            <IconButton
              icon="lucide:columns-2"
              :size="13"
              :title="t('分屏（拖拽选择方向）')"
              @pointerdown="startDrag(pane.id, $event)"
              @click="splitClicked"
            />
            <IconButton
              v-if="split"
              :icon="
                orientation === 'vertical'
                  ? 'lucide:columns-2'
                  : 'lucide:rows-2'
              "
              :size="13"
              :title="
                orientation === 'vertical'
                  ? t('改为左右分屏')
                  : t('改为上下分屏')
              "
              @click="toggleOrientation"
            />
            <IconButton
              v-if="pane.id !== rootId"
              icon="lucide:x"
              :size="13"
              :title="t('关闭分屏')"
              @click="closePane(pane.id)"
            />
          </div>
          <div
            :ref="element => setTarget(pane.id, element)"
            class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <slot
              v-if="!selections[pane.id]"
              name="empty"
            />
            <SplitDropIndicator
              v-if="tabDrop?.paneId === pane.id"
              :direction="tabDrop.position"
            />
          </div>
        </section>
      </template>
    </SplitPaneGroup>
    <template
      v-for="tab in tabs"
      :key="tab.id"
    >
      <Teleport
        v-if="targets[rootId]"
        :to="targets[state.owners[tab.id] ?? ''] ?? targets[rootId]!"
      >
        <div
          v-show="selections[state.owners[tab.id] ?? ''] === tab.id"
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <slot
            :tab="tab"
            :visible="selections[state.owners[tab.id] ?? ''] === tab.id"
          />
        </div>
      </Teleport>
    </template>
    <SplitDropIndicator
      v-if="direction"
      :direction="direction"
    />
  </div>
</template>
