<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import AppIcon from './AppIcon.vue'
import AppContextMenu from './AppContextMenu.vue'
import type { ContextMenuItem } from '@/types/context-menu'
import { useTabContextMenu } from '@/composables/useTabContextMenu'
import StatusDot from './StatusDot.vue'
import { useTabReorder } from '@/composables/useTabReorder'
import { cn } from '@/utils/cn'

export interface TabItem {
  /** 唯一标识 */
  id: string
  /** 标签文案 */
  label: string
  /** 左侧图标（与 dot 二选一） */
  icon?: string
  /** 左侧状态点色调 */
  dot?: 'accent' | 'success' | 'amber' | 'txt-3'
  /** 激活下划线颜色；连接标签可跟随用户选择的标签色。 */
  accent?: string
  /** 是否可关闭 */
  closable?: boolean
}

const props = defineProps<{
  tabs: readonly TabItem[]
  /** 是否显示新建按钮 */
  addable?: boolean
  contextItems?: (id: string) => readonly ContextMenuItem[]
}>()

const emit = defineEmits<{
  add: []
  /** 请求关闭某个标签 */
  close: [id: string]
  closeMany: [ids: string[]]
  contextAction: [id: string, action: string]
  /** 请求父组件将标签从一个索引移动到另一个索引 */
  reorder: [fromIndex: number, toIndex: number]
}>()

const active = defineModel<string>('active', { required: true })
const tabList = useTemplateRef<HTMLElement>('tabList')
const reorder = useTabReorder({
  tabs: () => props.tabs,
  container: () => tabList.value,
  onReorder: (fromIndex, toIndex) => emit('reorder', fromIndex, toIndex),
})
const menu = useTabContextMenu({
  tabs: () => props.tabs,
  container: () => tabList.value,
  active: () => active.value,
  extraItems: id => props.contextItems?.(id) ?? [],
  close: id => emit('close', id),
  closeMany: ids => emit('closeMany', ids),
  reorder: (from, to) => emit('reorder', from, to),
  action: (id, action) => emit('contextAction', id, action),
})
function closeFromPointer(id: string): void {
  if (props.tabs.find(tab => tab.id === id)?.closable) emit('close', id)
}
const draggedTab = computed(() =>
  props.tabs.find(tab => tab.id === reorder.draggedId.value)
)

function activateTab(id: string): void {
  if (reorder.consumeSuppressedClick(id)) return
  active.value = id
}

function handleTabKeydown(event: KeyboardEvent, id: string): void {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    menu.show(event, id)
    return
  }
  if ((event.target as HTMLElement).closest('[data-tab-action]')) return
  if (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  ) {
    event.preventDefault()
    event.stopPropagation()
    const index = props.tabs.findIndex(tab => tab.id === id)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? props.tabs.length - 1
          : (index + (event.key === 'ArrowLeft' ? -1 : 1) + props.tabs.length) %
            props.tabs.length
    const next = props.tabs[nextIndex]
    if (next) {
      active.value = next.id
      tabList.value
        ?.querySelectorAll<HTMLElement>('[role="tab"]')
        [nextIndex]?.focus()
    }
    return
  }
  if (
    event.altKey &&
    (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
  ) {
    event.preventDefault()
    event.stopPropagation()
    reorder.moveByKeyboard(id, event.key === 'ArrowLeft' ? -1 : 1)
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    active.value = id
  }
}
</script>

<template>
  <div
    ref="tabList"
    role="tablist"
    aria-label="打开的标签"
    class="scroll-none flex h-full min-w-0 items-center gap-0.5 overflow-x-auto"
  >
    <!-- 关闭按钮嵌在标签里，所以外层用 div 而不是 button：button 不能嵌套 -->
    <div
      v-for="(tab, index) in tabs"
      :key="tab.id"
      role="tab"
      tabindex="0"
      :data-reorderable-tab-id="tab.id"
      :aria-selected="active === tab.id"
      :aria-posinset="index + 1"
      :aria-setsize="tabs.length"
      :title="`${tab.label} · 右键操作，中键关闭；拖动或 Alt + ←/→ 排序`"
      :style="
        active === tab.id
          ? { borderBottomColor: tab.accent || 'var(--color-accent)' }
          : undefined
      "
      :class="
        cn(
          'tab-item group flex h-full shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 text-xs transition-colors duration-150 motion-reduce:transition-none',
          active === tab.id
            ? 'bg-card text-txt border-transparent'
            : 'text-txt-3 hover:bg-panel hover:text-txt-2 border-transparent',
          reorder.draggedId.value === tab.id && 'tab-item-dragging',
          reorder.targetId.value === tab.id &&
            reorder.targetPosition.value === 'before' &&
            'tab-drop-before',
          reorder.targetId.value === tab.id &&
            reorder.targetPosition.value === 'after' &&
            'tab-drop-after'
        )
      "
      @click="activateTab(tab.id)"
      @keydown="handleTabKeydown($event, tab.id)"
      @pointerdown="reorder.start($event, tab.id)"
      @contextmenu="menu.show($event, tab.id)"
      @mousedown.middle.prevent
      @auxclick.middle.stop.prevent="closeFromPointer(tab.id)"
    >
      <StatusDot
        v-if="tab.dot"
        :tone="tab.dot"
        :size="6"
        :glow="tab.dot !== 'txt-3'"
      />
      <AppIcon
        v-else-if="tab.icon"
        :name="tab.icon"
        :size="13"
      />
      <span class="whitespace-nowrap">{{ tab.label }}</span>

      <!-- 常态半隐，hover 才显形：一排标签全挂着叉号太吵 -->
      <button
        v-if="tab.closable"
        type="button"
        data-tab-action
        class="hover:bg-hover -mr-1 grid size-4 shrink-0 place-items-center rounded opacity-0 transition-opacity group-focus-within:opacity-60 group-hover:opacity-60 hover:opacity-100!"
        :title="`关闭 ${tab.label}`"
        @click.stop="emit('close', tab.id)"
      >
        <AppIcon
          name="lucide:x"
          :size="12"
        />
      </button>
    </div>

    <button
      v-if="addable"
      type="button"
      data-tab-action
      class="icon-btn ml-1"
      title="新建"
      @click="emit('add')"
    >
      <AppIcon
        name="lucide:plus"
        :size="14"
      />
    </button>

    <AppContextMenu
      scrollable
      :open="menu.state.open"
      :x="menu.state.x"
      :y="menu.state.y"
      :items="menu.items.value"
      label="标签页操作"
      @select="menu.select"
      @close="menu.dismiss"
    />

    <Teleport to="body">
      <div
        v-if="reorder.dragging.value && draggedTab"
        class="tab-drag-ghost"
        :style="reorder.dragStyle.value"
        aria-hidden="true"
      >
        <StatusDot
          v-if="draggedTab.dot"
          :tone="draggedTab.dot"
          :size="6"
          :glow="draggedTab.dot !== 'txt-3'"
        />
        <AppIcon
          v-else-if="draggedTab.icon"
          :name="draggedTab.icon"
          :size="13"
        />
        <span>{{ draggedTab.label }}</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tab-item {
  position: relative;
  touch-action: pan-y;
  user-select: none;
}

.tab-item-dragging {
  background: var(--color-hover);
  opacity: 0.42;
}

.tab-drop-before::before,
.tab-drop-after::after {
  position: absolute;
  top: 5px;
  bottom: 5px;
  width: 2px;
  border-radius: 999px;
  background: var(--color-violet);
  box-shadow: 0 0 9px color-mix(in oklch, var(--color-violet) 55%, transparent);
  content: '';
}

.tab-drop-before::before {
  left: -2px;
}

.tab-drop-after::after {
  right: -2px;
}

.tab-drag-ghost {
  position: fixed;
  z-index: 200;
  display: flex;
  max-width: 260px;
  pointer-events: none;
  align-items: center;
  gap: 7px;
  border: 1px solid
    color-mix(in oklch, var(--color-violet) 48%, var(--color-line));
  border-radius: 7px;
  background: var(--color-panel);
  box-shadow: 0 10px 28px rgb(0 0 0 / 28%);
  padding: 7px 10px;
  color: var(--color-txt);
  font-size: 11.5px;
  line-height: 1;
  transform: translateY(-50%);
  white-space: nowrap;
}
</style>
