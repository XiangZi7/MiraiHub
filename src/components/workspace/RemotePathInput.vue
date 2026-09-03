<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { SshRemoteFile } from '@/types/ssh'

const props = defineProps<{
  path: string
  entries: readonly SshRemoteFile[]
  connected: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  navigate: [path: string]
}>()

const root = useTemplateRef<HTMLElement>('root')
const input = useTemplateRef<HTMLInputElement>('input')
const draft = shallowRef('')
const open = shallowRef(false)
const activeIndex = shallowRef(0)

interface PathSuggestion {
  label: string
  path: string
}

const suggestions = computed<PathSuggestion[]>(() => {
  if (!props.connected)
    return []

  const value = draft.value.trim()
  const slash = value.lastIndexOf('/')
  const prefix = slash >= 0 ? value.slice(slash + 1) : value
  const directoryPrefix = slash >= 0 ? value.slice(0, slash + 1) : ''

  return props.entries
    .filter(entry => entry.kind === 'directory' || entry.kind === 'symlink')
    .filter(entry => !prefix || entry.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))
    .slice(0, 10)
    .map(entry => ({
      label: entry.name,
      path: directoryPrefix
        ? `${directoryPrefix}${entry.name}`
        : entry.name,
    }))
})

watch(() => props.path, (path) => {
  draft.value = path
}, { immediate: true })

watch(suggestions, (items) => {
  if (activeIndex.value >= items.length)
    activeIndex.value = 0
})

function absolutePath(value: string): string {
  const target = value.trim()
  if (!target)
    return props.path || ''
  if (target.startsWith('/') || target === '~' || target.startsWith('~/'))
    return target
  if (!props.path || props.path === '/')
    return `/${target}`
  return `${props.path.replace(/\/$/, '')}/${target}`
}

function navigate(value = draft.value): void {
  open.value = false
  emit('navigate', absolutePath(value))
}

function choose(item: PathSuggestion): void {
  draft.value = item.path
  navigate(item.path)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' && suggestions.value.length) {
    event.preventDefault()
    open.value = true
    activeIndex.value = (activeIndex.value + 1) % suggestions.value.length
  }
  else if (event.key === 'ArrowUp' && suggestions.value.length) {
    event.preventDefault()
    open.value = true
    activeIndex.value = (activeIndex.value - 1 + suggestions.value.length) % suggestions.value.length
  }
  else if ((event.key === 'Tab' || event.key === 'Enter') && open.value && suggestions.value[activeIndex.value]) {
    event.preventDefault()
    choose(suggestions.value[activeIndex.value])
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    navigate()
  }
  else if (event.key === 'Escape') {
    open.value = false
    draft.value = props.path
  }
}

function showSuggestions(): void {
  if (props.connected) {
    activeIndex.value = 0
    open.value = true
  }
}

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (!root.value?.contains(event.target as Node))
    open.value = false
})

defineExpose({
  focus: () => void nextTick(() => input.value?.focus()),
})
</script>

<template>
  <div ref="root" class="remote-path-root">
    <div class="remote-path-field">
      <AppIcon name="lucide:folder" :size="13" class="shrink-0 text-txt-3" />
      <input
        ref="input"
        v-model="draft"
        type="text"
        spellcheck="false"
        autocomplete="off"
        aria-label="远端文件路径"
        :disabled="!connected"
        :placeholder="connected ? '/path/to/folder' : '连接后可输入目录路径'"
        @focus="showSuggestions"
        @input="showSuggestions"
        @keydown="handleKeydown"
      >
      <AppIcon v-if="loading" name="lucide:loader-circle" :size="13" class="animate-spin text-violet" />
      <kbd class="shrink-0 text-[9px] text-txt-4">Enter</kbd>
    </div>

    <Transition name="path-suggestions">
      <div
        v-if="open && suggestions.length"
        class="path-suggestions"
        role="listbox"
        aria-label="目录建议"
      >
        <button
          v-for="(item, index) in suggestions"
          :key="item.path"
          type="button"
          role="option"
          :aria-selected="activeIndex === index"
          :class="['path-suggestion', activeIndex === index && 'path-suggestion-active']"
          @pointerenter="activeIndex = index"
          @mousedown.prevent="choose(item)"
        >
          <AppIcon name="mirai:folder" :size="14" class="shrink-0 text-blue" />
          <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
          <span class="truncate font-mono text-[9.5px] text-txt-4">{{ item.path }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.remote-path-root {
  position: relative;
  min-width: 0;
  flex: 1;
}

.remote-path-field {
  display: flex;
  height: 28px;
  min-width: 0;
  align-items: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-card) 72%, transparent);
  padding: 0 8px;
  transition: border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
}

.remote-path-field:focus-within {
  border-color: color-mix(in oklch, var(--color-violet) 52%, var(--color-line));
  background: color-mix(in oklch, var(--color-panel) 90%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 10%, transparent);
}

.remote-path-field input {
  min-width: 0;
  flex: 1;
  background: transparent;
  color: var(--color-txt);
  font-family: "JetBrains Mono Variable", ui-monospace, monospace;
  font-size: 11px;
  outline: none;
}

.remote-path-field input::placeholder {
  color: var(--color-txt-4);
}

.remote-path-field input:disabled {
  cursor: not-allowed;
}

.path-suggestions {
  position: absolute;
  z-index: 40;
  top: calc(100% + 5px);
  right: 0;
  left: 0;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow: var(--shadow-pop);
  padding: 5px;
  backdrop-filter: blur(20px) saturate(150%);
}

.path-suggestion {
  display: flex;
  width: 100%;
  height: 30px;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  border-radius: 5px;
  padding: 0 7px;
  color: var(--color-txt-2);
  font-size: 11px;
}

.path-suggestion-active {
  background: var(--color-hover);
  color: var(--color-txt);
}

.path-suggestions-enter-active,
.path-suggestions-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.path-suggestions-enter-from,
.path-suggestions-leave-to {
  transform: translateY(-3px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .remote-path-field,
  .path-suggestions-enter-active,
  .path-suggestions-leave-active {
    transition: none;
  }
}
</style>

