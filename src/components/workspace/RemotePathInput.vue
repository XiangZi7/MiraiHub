<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  reactive,
  toRefs,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { SshDirectoryListing, SshRemoteFile } from '@/types/ssh'
import {
  appendFilePathSeparator,
  filePathCompletionContext,
  filePathKey,
  resolveFilePath,
} from '@/utils/file-path'

const { t } = useI18n()
const props = defineProps<{
  path: string
  entries: readonly SshRemoteFile[]
  connected: boolean
  loading: boolean
  local?: boolean
  showHidden?: boolean
  contextKey?: string
  listDirectory?: (path: string) => Promise<SshDirectoryListing>
}>()
const emit = defineEmits<{ navigate: [path: string] }>()
const root = useTemplateRef<HTMLElement>('root')
const input = useTemplateRef<HTMLInputElement>('input')
const menu = useTemplateRef<HTMLElement>('menu')
const menuId = `path-suggestions-${useId()}`

interface PathSuggestion {
  label: string
  path: string
}

// 响应式状态
const state = reactive({
  // 地址栏草稿；只有确认导航才改变文件面板目录
  draft: '',
  // 是否展示当前父目录的候选
  open: false,
  // -1 表示尚未主动选择，直接回车始终打开用户输入的地址
  activeIndex: -1,
  // 未编辑的当前地址直接使用面板已有子目录
  pristine: true,
  // 中文输入法组词期间不请求补全或接管回车
  composing: false,
  // 异步候选所属的查询目录，防止不同目录的结果串用
  suggestionDirectory: '',
  // 原生返回的目录项作为只读快照，不做深层代理
  suggestionEntries: markRaw([]) as readonly SshRemoteFile[],
  // 仅表示地址补全查询，不影响文件列表的加载状态
  queryLoading: false,
})
const { draft, open, activeIndex, queryLoading, composing } = toRefs(state)
let generation = 0
let disposed = false
const cache = new Map<
  string,
  { expires: number; entries: readonly SshRemoteFile[] }
>()
const pending = new Map<string, Promise<SshDirectoryListing>>()
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})
const context = computed(() =>
  filePathCompletionContext(
    state.draft,
    props.path,
    props.local,
    state.pristine
  )
)
const directoryKey = computed(() =>
  filePathKey(context.value.directory, props.local)
)
const suggestionEntries = computed(() =>
  directoryKey.value === filePathKey(props.path, props.local)
    ? props.entries
    : state.suggestionDirectory === directoryKey.value
      ? state.suggestionEntries
      : []
)
const suggestions = computed<PathSuggestion[]>(() => {
  if (!props.connected || state.composing) return []
  const prefix = context.value.prefix.toLocaleLowerCase()
  return suggestionEntries.value
    .filter(entry => entry.kind === 'directory' || entry.kind === 'symlink')
    .filter(
      entry =>
        props.showHidden ||
        prefix.startsWith('.') ||
        !entry.name.startsWith('.')
    )
    .filter(entry => entry.name.toLocaleLowerCase().startsWith(prefix))
    .sort((a, b) => collator.compare(a.name, b.name))
    .slice(0, 10)
    .map(entry => ({
      label: entry.name,
      path: appendFilePathSeparator(entry.path, props.local),
    }))
})
const menuOpen = computed(() => state.open && suggestions.value.length > 0)

/** 停稳后只查询实际父目录，同目录请求复用；切换会话、关闭或卸载后不应用迟到结果。 */
const requestDirectory = useDebounceFn(
  async (token: number, directory: string) => {
    const loader = props.listDirectory
    if (
      disposed ||
      token !== generation ||
      !state.open ||
      !props.connected ||
      !loader
    )
      return
    const key = filePathKey(directory, props.local)
    const source = props.contextKey
    const local = props.local
    let request: Promise<SshDirectoryListing> | undefined
    state.queryLoading = true
    try {
      request = pending.get(key)
      if (!request) {
        request = loader(directory)
        pending.set(key, request)
      }
      const listing = await request
      if (
        disposed ||
        !props.connected ||
        source !== props.contextKey ||
        local !== props.local ||
        loader !== props.listDirectory
      )
        return
      const entries = markRaw(listing.entries)
      cache.delete(key)
      cache.set(key, { entries, expires: Date.now() + 5000 })
      if (cache.size > 32) cache.delete(cache.keys().next().value!)
      if (token !== generation || !state.open || !props.connected) return
      state.suggestionDirectory = key
      state.suggestionEntries = entries
    } catch {
      // 自动补全失败静默降级，用户确认导航时仍由面板统一报告实际错误。
    } finally {
      if (request && pending.get(key) === request) pending.delete(key)
      if (token === generation) state.queryLoading = false
    }
  },
  100
)

// 实际导航成功后恢复规范地址；原地刷新不会覆盖正在编辑的草稿。
watch(
  () => props.path,
  path => {
    state.draft = path
    state.pristine = true
    state.open = false
    state.activeIndex = -1
  },
  { immediate: true }
)

// 缓存只属于当前来源，重连或切换本地/远端时不能复用旧连接的目录。
watch(
  [() => props.contextKey, () => props.local, () => props.listDirectory],
  () => {
    generation += 1
    cache.clear()
    pending.clear()
    state.suggestionDirectory = ''
    state.suggestionEntries = markRaw([])
  },
  { flush: 'sync' }
)

// 前缀变化由 computed 即时筛选，只有父目录变化才防抖查询，避免每个按键发请求。
watch(
  [
    directoryKey,
    () => state.open && !state.composing,
    () => props.connected,
    () => props.contextKey,
    () => props.listDirectory,
  ],
  () => {
    const token = ++generation
    state.queryLoading = false
    state.suggestionDirectory = ''
    state.suggestionEntries = markRaw([])
    if (!state.open || state.composing || !props.connected) return
    if (directoryKey.value === filePathKey(props.path, props.local)) return
    const cached = cache.get(directoryKey.value)
    if (cached && cached.expires > Date.now()) {
      state.suggestionDirectory = directoryKey.value
      state.suggestionEntries = cached.entries
      return
    }
    void requestDirectory(token, context.value.directory)
  }
)

// 键盘选项保持在滚动容器内，候选收窄后撤销越界选中项。
watch([suggestions, () => state.activeIndex], async ([items, index]) => {
  if (index >= items.length) state.activeIndex = -1
  if (state.activeIndex < 0) return
  await nextTick()
  menu.value
    ?.querySelector<HTMLElement>(`[data-path-index="${state.activeIndex}"]`)
    ?.scrollIntoView({ block: 'nearest' })
})

/** 确认地址栏导航；相对路径基于当前目录解析，失败时保留草稿供用户修正。 */
function navigate(value = state.draft): void {
  if (!props.connected) return
  state.open = false
  state.activeIndex = -1
  emit(
    'navigate',
    state.pristine && value === props.path
      ? value
      : resolveFilePath(value, props.path, props.local)
  )
}

/** Tab 只补齐并保留分隔符，点击或主动选中后回车才进入目录，支持连续补齐多级路径。 */
function choose(item: PathSuggestion, enter = true): void {
  state.draft = item.path
  state.pristine = false
  state.activeIndex = -1
  if (enter) navigate(item.path)
  else state.open = true
}

/** 地址栏独占补全键；IME、修饰键和 Shift+Tab 保留原生输入与焦点行为。 */
function handleKeydown(event: KeyboardEvent): void {
  if (
    event.isComposing ||
    state.composing ||
    event.keyCode === 229 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return
  if (
    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
    suggestions.value.length
  ) {
    event.preventDefault()
    state.open = true
    const count = suggestions.value.length
    state.activeIndex =
      event.key === 'ArrowDown'
        ? (state.activeIndex + 1) % count
        : state.activeIndex < 0
          ? count - 1
          : (state.activeIndex - 1 + count) % count
  } else if (
    event.key === 'Tab' &&
    !event.shiftKey &&
    state.open &&
    suggestions.value.length
  ) {
    event.preventDefault()
    choose(suggestions.value[Math.max(0, state.activeIndex)]!, false)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const selected = state.open
      ? suggestions.value[state.activeIndex]
      : undefined
    if (selected) choose(selected)
    else navigate()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    state.open = false
    state.draft = props.path
    state.pristine = true
    state.activeIndex = -1
  }
}

/** 聚焦时使用当前目录已有内容，输入时取消默认选中，不让回车误跳第一条建议。 */
function showSuggestions(): void {
  state.activeIndex = -1
  state.open = props.connected
}

/** 用户编辑后按新的父目录查询，中文组词完成前暂停自动建议。 */
function handleInput(event: Event): void {
  state.pristine = false
  state.composing = Boolean((event as InputEvent).isComposing)
  showSuggestions()
  // 同目录失败后继续输入可重试，已过期快照也在输入停稳后刷新；在途请求仍复用。
  const key = directoryKey.value
  if (
    !state.composing &&
    props.listDirectory &&
    props.connected &&
    key !== filePathKey(props.path, props.local) &&
    !pending.has(key) &&
    (cache.get(key)?.expires ?? 0) <= Date.now()
  )
    void requestDirectory(++generation, context.value.directory)
}

/** 供文件面板快捷键聚焦并选中地址，便于直接粘贴或替换整条路径。 */
function focus(): void {
  void nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
}

// 点击外部或失去连接时关闭弹层，所有监听与异步应用随组件生命周期撤销。
useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (!root.value?.contains(event.target as Node)) state.open = false
})
watch(
  () => props.connected,
  connected => {
    if (!connected) {
      state.open = false
      state.draft = props.path
      cache.clear()
      pending.clear()
    }
  }
)
onBeforeUnmount(() => {
  disposed = true
  generation += 1
  cache.clear()
  pending.clear()
})
defineExpose({ focus })
</script>

<template>
  <div
    ref="root"
    class="remote-path-root"
  >
    <div class="remote-path-field">
      <AppIcon
        name="lucide:folder"
        :size="13"
        class="text-txt-3 shrink-0"
      />
      <input
        ref="input"
        v-model="draft"
        type="text"
        role="combobox"
        spellcheck="false"
        autocomplete="off"
        aria-autocomplete="list"
        :aria-controls="menuId"
        :aria-expanded="menuOpen"
        :aria-activedescendant="
          menuOpen && activeIndex >= 0 ? `${menuId}-${activeIndex}` : undefined
        "
        :aria-label="local ? t('本地目录路径') : t('远端文件路径')"
        :disabled="!connected"
        :placeholder="
          connected
            ? local
              ? t('输入本地目录路径')
              : '/path/to/folder'
            : t('连接后可输入目录路径')
        "
        @focus="showSuggestions"
        @blur="open = false"
        @input="handleInput"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown="handleKeydown"
      />
      <AppIcon
        v-if="loading || queryLoading"
        name="lucide:loader-circle"
        :size="13"
        class="text-violet animate-spin"
      />
      <kbd class="text-txt-4 shrink-0 text-[9px]">Enter</kbd>
    </div>

    <Transition name="path-suggestions">
      <div
        v-if="menuOpen"
        :id="menuId"
        ref="menu"
        class="path-suggestions"
        role="listbox"
        :aria-label="t('目录建议')"
      >
        <button
          v-for="(item, index) in suggestions"
          :id="`${menuId}-${index}`"
          :key="item.path"
          type="button"
          role="option"
          tabindex="-1"
          :data-path-index="index"
          :aria-selected="activeIndex === index"
          :class="[
            'path-suggestion',
            activeIndex === index && 'path-suggestion-active',
          ]"
          @pointerenter="activeIndex = index"
          @mousedown.prevent="choose(item)"
        >
          <AppIcon
            name="mirai:folder"
            :size="14"
            class="text-blue shrink-0"
          />
          <span class="min-w-0 flex-1 truncate text-left">{{
            item.label
          }}</span>
          <span class="text-txt-4 truncate font-mono text-[9.5px]">{{
            item.path
          }}</span>
        </button>
        <div
          class="text-txt-4 border-line-soft mt-1 border-t px-2 pt-1.5 pb-1 text-[9.5px]"
        >
          {{ t('Tab 补齐 · Enter 打开') }}
        </div>
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
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    background-color 150ms ease;
}
.remote-path-field:focus-within {
  border-color: color-mix(in oklch, var(--color-violet) 52%, var(--color-line));
  background: color-mix(in oklch, var(--color-panel) 90%, transparent);
  box-shadow: 0 0 0 3px
    color-mix(in oklch, var(--color-violet) 10%, transparent);
}
.remote-path-field input {
  min-width: 0;
  flex: 1;
  background: transparent;
  color: var(--color-txt);
  font-family: var(--font-mono);
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
  max-height: 280px;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  transition:
    opacity 120ms ease,
    transform 120ms ease;
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
