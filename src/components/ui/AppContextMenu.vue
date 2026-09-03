<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { ContextMenuItem } from '@/types/context-menu'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: readonly ContextMenuItem[]
  label?: string
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
}>()

const menu = useTemplateRef<HTMLElement>('menu')

const menuStyle = computed(() => {
  const estimatedHeight = props.items.length * 30 + 12
  return {
    left: `${Math.max(6, Math.min(props.x, window.innerWidth - 194))}px`,
    top: `${Math.max(6, Math.min(props.y, window.innerHeight - estimatedHeight - 6))}px`,
  }
})

function enabledItems(): HTMLButtonElement[] {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
}

function selectItem(item: ContextMenuItem): void {
  if (item.disabled)
    return

  emit('select', item.id)
  emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  const items = enabledItems()
  if (!items.length)
    return

  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  let nextIndex = index

  if (event.key === 'ArrowDown')
    nextIndex = index < items.length - 1 ? index + 1 : 0
  else if (event.key === 'ArrowUp')
    nextIndex = index > 0 ? index - 1 : items.length - 1
  else if (event.key === 'Home')
    nextIndex = 0
  else if (event.key === 'End')
    nextIndex = items.length - 1
  else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  else {
    return
  }

  event.preventDefault()
  items[nextIndex]?.focus()
}

watch(() => props.open, (open) => {
  if (open)
    void nextTick(() => enabledItems()[0]?.focus())
})

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (props.open && !menu.value?.contains(event.target as Node))
    emit('close')
}, { capture: true })
useEventListener(window, 'resize', () => props.open && emit('close'))
useEventListener(window, 'blur', () => props.open && emit('close'))
</script>

<template>
  <Teleport to="body">
    <Transition name="context-menu">
      <div
        v-if="open"
        ref="menu"
        class="app-context-menu"
        role="menu"
        :aria-label="label ?? 'Context menu'"
        :style="menuStyle"
        @keydown="handleKeydown"
        @contextmenu.prevent
      >
        <template v-for="item in items" :key="item.id">
          <div v-if="item.separatorBefore" class="app-context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            :disabled="item.disabled"
            :class="['app-context-menu-item', item.danger && 'app-context-menu-item-danger']"
            @click="selectItem(item)"
          >
            <AppIcon v-if="item.icon" :name="item.icon" :size="14" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
            <kbd v-if="item.shortcut" class="text-[9.5px] text-txt-4">{{ item.shortcut }}</kbd>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-context-menu {
  position: fixed;
  z-index: 100;
  width: 188px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-panel) 90%, transparent);
  box-shadow: var(--shadow-pop);
  padding: 5px;
  backdrop-filter: blur(24px) saturate(165%);
  -webkit-backdrop-filter: blur(24px) saturate(165%);
}

.app-context-menu-item {
  display: flex;
  width: 100%;
  height: 30px;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  border-radius: 5px;
  padding: 0 8px;
  color: var(--color-txt-2);
  font-size: 11.5px;
  outline: none;
  transition: color 120ms ease, background-color 120ms ease;
}

.app-context-menu-item:hover,
.app-context-menu-item:focus-visible {
  background: var(--color-hover);
  color: var(--color-txt);
}

.app-context-menu-item:disabled {
  pointer-events: none;
  opacity: 0.38;
}

.app-context-menu-item-danger {
  color: var(--color-danger);
}

.app-context-menu-item-danger:hover,
.app-context-menu-item-danger:focus-visible {
  background: color-mix(in oklch, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}

.app-context-menu-separator {
  height: 1px;
  margin: 4px 3px;
  background: var(--color-line-soft);
}

.context-menu-enter-active,
.context-menu-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
  transform-origin: top left;
}

.context-menu-enter-from,
.context-menu-leave-to {
  transform: translateY(-3px) scale(0.98);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .app-context-menu-item,
  .context-menu-enter-active,
  .context-menu-leave-active {
    transition: none;
  }
}
</style>
