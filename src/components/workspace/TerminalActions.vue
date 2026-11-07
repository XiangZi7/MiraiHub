<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  nextTick,
  reactive,
  shallowRef,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { useEventListener } from '@vueuse/core'
import type { Terminal } from '@xterm/xterm'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import IconButton from '@/components/ui/IconButton.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import { toast } from '@/composables/useToast'
import { useSettings } from '@/composables/useSettings'
import { terminalSearchDecorations } from '@/constants/terminal'
import { copyText } from '@/utils/clipboard'
import { matchesShortcut } from '@/utils/shortcut'
import type { SshSessionStatus } from '@/types/ssh'
import TerminalCommandMenu from '@/components/workspace/TerminalCommandMenu.vue'
import TerminalReplayDialog from '@/components/workspace/terminal-replay-dialog.vue'
import {
  startRecording,
  stopRecording,
  parseCast,
  type TerminalCast,
} from '@/utils/terminal-recording'

const { t } = useI18n()
const { settings } = useSettings()

const props = defineProps<{
  terminal?: Terminal
  status: SshSessionStatus
  /** 当前工作区是否已分屏，仅用于按钮高亮 */
  split?: boolean
  /** 这一块是分屏出来的副面板，可以单独关掉 */
  closable?: boolean
  local?: boolean
  available: boolean
  /** 是否提供 AI 相关操作（分析选区、自然语言生成命令） */
  ai?: boolean
}>()
const emit = defineEmits<{
  split: []
  /** 分屏按钮按下。交给上层判断是点击还是拖拽选方向 */
  splitPointerDown: [event: PointerEvent]
  close: []
  reconnect: []
  disconnect: []
  askAgent: [content: string]
  inlineAi: []
}>()
const castInput = useTemplateRef<HTMLInputElement>('castInput')
const input = useTemplateRef<HTMLInputElement>('input')
const menuTrigger = shallowRef<HTMLElement | null>(null)
// 响应式状态
const state = reactive({
  // 是否展开搜索栏
  searchOpen: false,
  // 当前终端是否正在录制输出
  recording: false,
  // 最近录制或导入的回放
  cast: null as TerminalCast | null,
  // 搜索文本
  query: '',
  // 搜索选项
  caseSensitive: false,
  regex: false,
  wholeWord: false,
  // 正则写错时标红输入框，而不是静默无结果
  invalidQuery: false,
  // 当前匹配索引
  matchIndex: -1,
  // 匹配总数
  matchCount: 0,
  // 更多菜单位置与可见性
  menuOpen: false,
  // 菜单横坐标
  menuX: 0,
  // 菜单纵坐标
  menuY: 0,
  // xterm 选区由事件同步，菜单打开时和工具栏按钮都能及时更新。
  hasSelection: false,
})
const {
  recording,
  cast,
  searchOpen,
  query,
  matchIndex,
  matchCount,
  menuOpen,
  menuX,
  menuY,
} = toRefs(state)
const items = computed(() => {
  const aiItems = props.ai
    ? [
        {
          id: 'ask-agent',
          label: t('让 AI 分析选区'),
          icon: 'lucide:sparkles',
          disabled: !state.hasSelection || props.status !== 'connected',
        },
        {
          id: 'inline-ai',
          label: t('用自然语言生成命令'),
          icon: 'lucide:wand-sparkles',
          shortcut: 'Ctrl+I',
          disabled: props.status !== 'connected',
        },
      ]
    : []
  return [
    ...aiItems,
    {
      id: 'copy',
      label: t('复制选中内容'),
      icon: 'lucide:copy',
      shortcut: 'Ctrl+Shift+C',
      disabled: !state.hasSelection,
      separatorBefore: props.ai,
    },
    {
      id: 'paste',
      label: t('粘贴'),
      icon: 'lucide:clipboard-paste',
      shortcut: 'Ctrl+Shift+V',
      disabled: props.status !== 'connected',
    },
    { id: 'select-all', label: t('全选'), icon: 'lucide:text-select' },
    {
      id: 'clear',
      label: t('清除回滚内容'),
      icon: 'lucide:eraser',
      separatorBefore: true,
    },
    {
      id: 'disconnect',
      label: props.local ? t('停止本地终端') : t('断开连接'),
      icon: 'lucide:unplug',
      disabled: props.status !== 'connected',
      separatorBefore: true,
    },
  ]
})

function openMenu(event: MouseEvent): void {
  if (state.menuOpen && menuTrigger.value === event.currentTarget) {
    closeMenu()
    return
  }
  menuTrigger.value = event.currentTarget as HTMLElement
  const rect = menuTrigger.value.getBoundingClientRect()
  state.menuX = rect.left
  state.menuY = rect.bottom + 4
  state.menuOpen = true
}

// 监听挂载容器（包括空白区域），在 xterm 处理右键前保留选区并打开应用菜单。
const terminalContainer = computed(() => props.terminal?.element?.parentElement)
useEventListener(
  terminalContainer,
  'contextmenu',
  (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    menuTrigger.value = null
    state.menuX = event.clientX
    state.menuY = event.clientY
    state.menuOpen = true
  },
  { capture: true }
)
useEventListener(
  terminalContainer,
  'mousedown',
  (event: MouseEvent) => {
    if (event.button !== 2) return
    // 避免右键触发远端应用的鼠标操作，或让 xterm 移动隐藏输入框。
    event.preventDefault()
    event.stopPropagation()
  },
  { capture: true }
)

function closeMenu(): void {
  state.menuOpen = false
  // Esc 关闭菜单时回到终端；点击其他输入框时保留用户的新焦点。
  if (document.activeElement?.closest('[role="menu"]')) props.terminal?.focus()
}

// 官方搜索插件：全部匹配高亮、增量查找，输出变化时自行刷新装饰，不必每次全量扫描缓冲区。
const searchAddon = shallowRef<SearchAddon>()

async function openSearch(): Promise<void> {
  state.searchOpen = !state.searchOpen
  if (state.searchOpen) {
    await nextTick()
    input.value?.focus()
    input.value?.select()
    search(1, true)
  } else closeSearch()
}
function closeSearch(): void {
  state.searchOpen = false
  searchAddon.value?.clearDecorations()
  props.terminal?.clearSelection()
  props.terminal?.focus()
}
function searchOptions(incremental: boolean): ISearchOptions {
  return {
    caseSensitive: state.caseSensitive,
    regex: state.regex,
    wholeWord: state.wholeWord,
    incremental,
    decorations: terminalSearchDecorations(),
  }
}
function search(direction: 1 | -1 = 1, incremental = false): void {
  const addon = searchAddon.value
  if (!addon) return
  if (!state.query) {
    addon.clearDecorations()
    props.terminal?.clearSelection()
    state.matchCount = 0
    state.matchIndex = -1
    state.invalidQuery = false
    return
  }
  try {
    if (direction === 1) addon.findNext(state.query, searchOptions(incremental))
    else addon.findPrevious(state.query, searchOptions(false))
    state.invalidQuery = false
  } catch {
    // 正则还没输完整时插件会抛错。
    state.invalidQuery = true
    state.matchCount = 0
    state.matchIndex = -1
  }
}
function toggleSearchOption(
  key: 'caseSensitive' | 'regex' | 'wholeWord'
): void {
  state[key] = !state[key]
  input.value?.focus()
}
watch(
  () => [state.query, state.caseSensitive, state.regex, state.wholeWord],
  () => search(1, true)
)
watch(
  () => props.terminal,
  (terminal, _previous, onCleanup) => {
    state.menuOpen = false
    state.hasSelection = terminal?.hasSelection() ?? false
    if (!terminal) return
    const addon = new SearchAddon({ highlightLimit: 2000 })
    terminal.loadAddon(addon)
    searchAddon.value = addon
    const resultListener = addon.onDidChangeResults(
      ({ resultIndex, resultCount }) => {
        state.matchCount = resultCount
        state.matchIndex = resultIndex
      }
    )
    // 有选区时 Ctrl+C 复制；无选区时保留发送中断信号的终端行为。
    terminal.attachCustomKeyEventHandler(event => {
      // 命令面板、全局搜索属于应用级快捷键：交还给窗口，不发给远端。
      if (
        matchesShortcut(event, settings.shortcutPalette) ||
        matchesShortcut(event, settings.shortcutSearch)
      )
        return false
      const key = event.key.toLowerCase()
      const modifier = (event.ctrlKey || event.metaKey) && !event.altKey
      const copy =
        modifier && key === 'c' && (event.shiftKey || terminal.hasSelection())
      const paste = modifier && event.shiftKey && key === 'v'
      if (copy || paste) {
        event.preventDefault()
        if (event.type === 'keydown') void runAction(copy ? 'copy' : 'paste')
        return false
      }
      if (
        key === 'contextmenu' ||
        (event.shiftKey && !event.ctrlKey && !event.metaKey && key === 'f10')
      ) {
        event.preventDefault()
        if (event.type === 'keydown') {
          const rect = terminalContainer.value?.getBoundingClientRect()
          if (rect) {
            menuTrigger.value = null
            state.menuX = rect.left + 12
            state.menuY = rect.top + 12
            state.menuOpen = true
          }
        }
        return false
      }
      if (modifier && !event.shiftKey && key === 'f') {
        event.preventDefault()
        if (event.type === 'keydown') {
          if (!state.searchOpen) void openSearch()
          else input.value?.focus()
        }
        return false
      }
      // Ctrl+I 在终端里等同 Tab，只在 AI 可用时接管。
      if (props.ai && modifier && !event.shiftKey && key === 'i') {
        event.preventDefault()
        if (event.type === 'keydown' && props.status === 'connected')
          emit('inlineAi')
        return false
      }
      return true
    })
    const selectionListener = terminal.onSelectionChange(() => {
      state.hasSelection = terminal.hasSelection()
    })
    onCleanup(() => {
      resultListener.dispose()
      selectionListener.dispose()
      addon.dispose()
      if (searchAddon.value === addon) searchAddon.value = undefined
      terminal.attachCustomKeyEventHandler(() => true)
    })
  },
  { immediate: true }
)

async function runAction(id: string): Promise<void> {
  const terminal = props.terminal
  if (!terminal) return
  try {
    if (id === 'copy') {
      const text = terminal.getSelection()
      if (text) {
        await copyText(text)
        toast.success(t('已复制终端选中内容'))
      }
    } else if (id === 'paste' && props.status === 'connected') {
      const text = await navigator.clipboard.readText()
      if (props.terminal === terminal && props.status === 'connected')
        terminal.paste(text)
    } else if (id === 'select-all') terminal.selectAll()
    else if (id === 'clear') {
      terminal.clear()
      search(1, true)
    } else if (id === 'disconnect') emit('disconnect')
    else if (id === 'ask-agent') {
      const text = terminal.getSelection()
      if (text.trim() && props.status === 'connected') emit('askAgent', text)
      return
    } else if (id === 'inline-ai') {
      emit('inlineAi')
      return
    }
    terminal.focus()
  } catch (error) {
    toast.error({ title: t('终端操作失败'), description: String(error) })
  }
}
/** 切换输出录制；停止后立即打开回放以便导出。 */
function toggleRecording(): void {
  if (!props.terminal) return
  if (state.recording) state.cast = stopRecording(props.terminal)
  else startRecording(props.terminal)
  state.recording = !state.recording
}
/** 从本地选择标准 cast 文件，在只读终端中回放。 */
async function importCast(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  try {
    if (file) {
      if (file.size > 32 * 1024 * 1024) throw new Error(t('录制文件过大'))
      state.cast = parseCast(await file.text())
    }
  } catch (error) {
    toast.error({ title: t('读取录制失败'), description: String(error) })
  } finally {
    input.value = ''
  }
}
// 切换终端时结束上一实例的录制，防止录到新的会话。
watch(
  () => props.terminal,
  (_next, previous) => {
    if (previous && state.recording) state.cast = stopRecording(previous)
    state.recording = false
  }
)
const searchToggles = computed(() => [
  { key: 'caseSensitive' as const, label: 'Aa', title: t('区分大小写') },
  { key: 'wholeWord' as const, label: 'ab', title: t('全词匹配') },
  { key: 'regex' as const, label: '.*', title: t('使用正则表达式') },
])
function insertCommand(command: string): void {
  if (props.status !== 'connected' || !props.terminal) return
  props.terminal.paste(command)
  props.terminal.focus()
}
</script>

<template>
  <div class="relative ml-auto flex shrink-0 items-center gap-1">
    <div
      v-if="!local"
      class="terminal-secondary-action"
    >
      <TerminalCommandMenu
        :connected="status === 'connected' && Boolean(terminal)"
        @insert="insertCommand"
      />
    </div>
    <IconButton
      v-if="!local"
      icon="lucide:rows-2"
      :size="14"
      :title="t('分屏：点击在下方新开，按住拖到边缘可选方向')"
      :disabled="!available"
      :class="split && 'text-accent'"
      @pointerdown="emit('splitPointerDown', $event)"
      @click="emit('split')"
    />
    <IconButton
      v-if="closable"
      icon="lucide:x"
      :size="14"
      :title="t('关闭此分屏')"
      @click="emit('close')"
    />
    <slot />
    <IconButton
      v-if="!local"
      :icon="recording ? 'lucide:square' : 'lucide:circle-dot'"
      :size="14"
      :class="recording && 'text-danger'"
      :title="recording ? t('停止录制') : t('开始录制')"
      :disabled="!terminal"
      @click="toggleRecording"
    />
    <IconButton
      v-if="!local"
      icon="lucide:film"
      :size="14"
      :title="t('导入录制回放')"
      @click="castInput?.click()"
    />
    <input
      ref="castInput"
      type="file"
      accept=".cast"
      hidden
      @change="importCast"
    />
    <Teleport to="body"
      ><TerminalReplayDialog
        v-if="cast"
        :cast="cast"
        @close="cast = null"
    /></Teleport>
    <IconButton
      icon="lucide:copy"
      class="terminal-secondary-action"
      :size="14"
      :title="t('复制选中内容 (Ctrl+Shift+C)')"
      :disabled="!state.hasSelection"
      @click="runAction('copy')"
    />
    <IconButton
      icon="lucide:search"
      class="terminal-secondary-action"
      :size="14"
      :title="t('搜索终端 (Ctrl+F)')"
      :disabled="!terminal"
      @click="openSearch"
    />
    <IconButton
      icon="lucide:rotate-cw"
      :size="14"
      :title="local ? t('重新启动') : t('重连')"
      :disabled="!available || status === 'connecting'"
      @click="emit('reconnect')"
    />
    <IconButton
      icon="lucide:ellipsis"
      :size="14"
      :title="t('更多')"
      :disabled="!terminal"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      @click="openMenu"
    />
    <div
      v-if="searchOpen"
      class="border-line panel-fade-in absolute top-full right-0 z-30 mt-2 flex w-84 items-center gap-1 rounded-lg border bg-[var(--color-canvas)] p-2 shadow-lg"
      role="search"
      @keydown.esc.stop="closeSearch"
    >
      <input
        ref="input"
        v-model="query"
        :aria-label="t('搜索终端内容')"
        :aria-invalid="state.invalidQuery"
        :placeholder="t('搜索终端内容…')"
        class="text-txt min-w-0 flex-1 bg-transparent text-xs outline-none aria-[invalid=true]:text-danger"
        @keydown.enter.prevent="search($event.shiftKey ? -1 : 1)"
      />
      <button
        v-for="option in searchToggles"
        :key="option.key"
        type="button"
        class="text-txt-3 hover:bg-hover hover:text-txt grid h-5 min-w-5 shrink-0 place-items-center rounded px-1 font-mono text-[10px] transition-colors aria-pressed:bg-accent/15 aria-pressed:text-accent"
        :title="option.title"
        :aria-label="option.title"
        :aria-pressed="state[option.key]"
        @click="toggleSearchOption(option.key)"
      >
        {{ option.label }}
      </button>
      <span
        class="text-txt-3 min-w-9 shrink-0 text-right text-[10px] tabular-nums"
        aria-live="polite"
        >{{ matchIndex >= 0 ? matchIndex + 1 : matchCount ? '?' : 0 }}/{{
          matchCount
        }}</span
      >
      <IconButton
        icon="lucide:chevron-up"
        :size="12"
        :title="t('上一个 (Shift+Enter)')"
        :disabled="!matchCount"
        @click="search(-1)"
      />
      <IconButton
        icon="lucide:chevron-down"
        :size="12"
        :title="t('下一个 (Enter)')"
        :disabled="!matchCount"
        @click="search(1)"
      />
      <IconButton
        icon="lucide:x"
        :size="12"
        :title="t('关闭搜索')"
        @click="closeSearch"
      />
    </div>
    <AppContextMenu
      :open="menuOpen"
      :x="menuX"
      :y="menuY"
      :items="items"
      :label="t('终端操作')"
      :trigger="menuTrigger"
      @close="closeMenu"
      @select="runAction"
    />
  </div>
</template>

<style scoped>
@container terminal (max-width: 640px) {
  .terminal-secondary-action {
    display: none;
  }
}
</style>
