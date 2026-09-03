<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import type { ShellSuggestion } from '@/types/ssh'

defineProps<{
  items: readonly ShellSuggestion[]
  activeIndex: number
  loading: boolean
}>()

const emit = defineEmits<{
  select: [item: ShellSuggestion]
  hover: [index: number]
}>()

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
  <div class="terminal-suggestions" role="listbox" aria-label="终端输入建议">
    <button
      v-for="(item, index) in items"
      :key="`${item.kind}:${item.value}`"
      type="button"
      role="option"
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
  right: 12px;
  bottom: 12px;
  left: 12px;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow: var(--shadow-pop);
  padding: 5px;
  backdrop-filter: blur(22px) saturate(155%);
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
