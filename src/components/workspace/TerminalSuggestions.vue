<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { ShellSuggestion } from '@/types/ssh'

const props = defineProps<{
  items: readonly ShellSuggestion[]
  activeIndex: number
  loading: boolean
  anchor: {
    left: number
    top?: number
    bottom?: number
    width: number
    maxHeight: number
  }
}>()

const emit = defineEmits<{
  select: [item: ShellSuggestion]
  hover: [index: number]
}>()

const menu = useTemplateRef<HTMLElement>('menu')
const menuStyle = computed<CSSProperties>(() => ({
  left: `${props.anchor.left}px`,
  top: props.anchor.top === undefined ? undefined : `${props.anchor.top}px`,
  bottom: props.anchor.bottom === undefined ? undefined : `${props.anchor.bottom}px`,
  width: `${props.anchor.width}px`,
  maxHeight: `${props.anchor.maxHeight}px`,
}))

watch(() => props.activeIndex, async (index) => {
  await nextTick()
  menu.value
    ?.querySelector<HTMLElement>(`[data-suggestion-index="${index}"]`)
    ?.scrollIntoView({ block: 'nearest' })
})

function iconOf(item: ShellSuggestion): string {
  if (item.kind === 'command')
    return 'lucide:square-terminal'
  return item.kind === 'directory' ? 'mirai:folder' : 'mirai:file'
}

function toneOf(item: ShellSuggestion): string {
  if (item.kind === 'command')
    return 'text-violet'
  return item.kind === 'directory' ? 'text-blue' : 'text-txt-3'
}

function kindLabel(item: ShellSuggestion): string {
  return item.kind === 'command' ? 'CMD' : item.kind === 'directory' ? 'DIR' : 'FILE'
}
</script>

<template>
  <div ref="menu" class="terminal-suggestions" role="listbox" aria-label="终端输入建议" :style="menuStyle">
    <div class="terminal-suggestions-list">
      <button
        v-for="(item, index) in items"
        :key="`${item.kind}:${item.value}`"
        type="button"
        role="option"
        :data-suggestion-index="index"
        :aria-selected="activeIndex === index"
        :class="['terminal-suggestion', activeIndex === index && 'terminal-suggestion-active']"
        @pointerenter="emit('hover', index)"
        @mousedown.prevent="emit('select', item)"
      >
        <AppIcon :name="iconOf(item)" :size="14" :class="['shrink-0', toneOf(item)]" />
        <span class="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-txt">
          {{ item.label }}
        </span>
        <span class="max-w-44 truncate text-right text-[10px] text-txt-4">
          {{ item.description }}
        </span>
        <span class="suggestion-kind">{{ kindLabel(item) }}</span>
      </button>
    </div>

    <footer class="terminal-suggestions-footer">
      <span>↑↓ 选择</span>
      <span>Tab 接受</span>
      <AppIcon v-if="loading" name="lucide:loader-circle" :size="11" class="ml-auto animate-spin text-violet" />
    </footer>
  </div>
</template>

<style scoped>
.terminal-suggestions {
  position: absolute;
  z-index: 30;
  display: flex;
  min-height: 70px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow: var(--shadow-pop);
  padding: 5px;
  backdrop-filter: blur(22px) saturate(155%);
}

.terminal-suggestions-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in oklch, var(--color-line-strong) 82%, transparent) transparent;
  scrollbar-width: thin;
}

.terminal-suggestions-list::-webkit-scrollbar {
  width: 6px;
}

.terminal-suggestions-list::-webkit-scrollbar-track {
  background: transparent;
}

.terminal-suggestions-list::-webkit-scrollbar-thumb {
  border: 1px solid transparent;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-line-strong) 82%, transparent);
  background-clip: padding-box;
}

.terminal-suggestions-list::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklch, var(--color-txt-3) 72%, transparent);
  background-clip: padding-box;
}

.terminal-suggestions-list::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}

.terminal-suggestion {
  display: flex;
  width: 100%;
  height: 31px;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  border-radius: 5px;
  padding: 0 7px;
  outline: none;
}

.terminal-suggestion-active {
  background: color-mix(in oklch, var(--color-violet) 12%, var(--color-hover));
}

.suggestion-kind {
  min-width: 29px;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  padding: 1px 4px;
  color: var(--color-txt-4);
  font-size: 8px;
  text-align: center;
}

.terminal-suggestions-footer {
  display: flex;
  height: 25px;
  align-items: center;
  gap: 12px;
  border-top: 1px solid var(--color-line-soft);
  margin-top: 4px;
  padding: 3px 7px 0;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
</style>
