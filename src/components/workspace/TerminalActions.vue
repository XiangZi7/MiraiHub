<script setup lang="ts">
import {
  computed,
  nextTick,
  reactive,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import type { Terminal } from '@xterm/xterm'
import IconButton from '@/components/ui/IconButton.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import { toast } from '@/composables/useToast'
import { copyText } from '@/utils/clipboard'
import { findTerminalMatches } from '@/utils/terminal-search'
import type { SshSessionStatus } from '@/types/ssh'
import TerminalCommandMenu from './TerminalCommandMenu.vue'

const props = defineProps<{
  terminal?: Terminal
  status: SshSessionStatus
  split?: boolean
  local?: boolean
  available: boolean
}>()
const emit = defineEmits<{ split: []; reconnect: []; disconnect: [] }>()
const input = useTemplateRef<HTMLInputElement>('input')
// 响应式状态
const state = reactive({
  // 是否展开搜索栏
  searchOpen: false,
  // 搜索文本
  query: '',
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
const { searchOpen, query, matchIndex, matchCount, menuOpen, menuX, menuY } =
  toRefs(state)
const items = computed(() => {
  return [
    {
      id: 'copy',
      label: '复制选中内容',
      icon: 'lucide:copy',
      shortcut: 'Ctrl+Shift+C',
      disabled: !state.hasSelection,
    },
    {
      id: 'paste',
      label: '粘贴',
      icon: 'lucide:clipboard-paste',
      shortcut: 'Ctrl+Shift+V',
      disabled: props.status !== 'connected',
    },
    { id: 'select-all', label: '全选', icon: 'lucide:text-select' },
    {
      id: 'clear',
      label: '清除回滚内容',
      icon: 'lucide:eraser',
      separatorBefore: true,
    },
    {
      id: 'disconnect',
      label: props.local ? '停止本地终端' : '断开连接',
      icon: 'lucide:unplug',
      disabled: props.status !== 'connected',
      separatorBefore: true,
    },
  ]
})

function openMenu(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
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

async function openSearch(): Promise<void> {
  state.searchOpen = !state.searchOpen
  if (state.searchOpen) {
    await nextTick()
    input.value?.focus()
    input.value?.select()
    search(0)
  } else closeSearch()
}
function closeSearch(): void {
  state.searchOpen = false
  props.terminal?.clearSelection()
  props.terminal?.focus()
}
function search(direction = 1, reset = false): void {
  const terminal = props.terminal
  if (!terminal) return
  const matches = findTerminalMatches(terminal.buffer.active, state.query)
  state.matchCount = matches.length
  state.matchIndex = matches.length
    ? reset
      ? 0
      : (state.matchIndex + direction + matches.length) % matches.length
    : -1
  const match = matches[state.matchIndex]
  if (match) {
    terminal.select(match.column, match.row, match.length)
    terminal.scrollToLine(match.row)
  } else terminal.clearSelection()
}
const refreshSearch = useDebounceFn(
  () => {
    if (state.searchOpen && state.query) search(0)
  },
  120,
  { maxWait: 500 }
)
watch(
  () => state.query,
  () => search(1, true)
)
watch(
  () => props.terminal,
  (terminal, _previous, onCleanup) => {
    state.menuOpen = false
    state.hasSelection = terminal?.hasSelection() ?? false
    if (!terminal) return
    // 有选区时 Ctrl+C 复制；无选区时保留发送中断信号的终端行为。
    terminal.attachCustomKeyEventHandler(event => {
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
            state.menuX = rect.left + 12
            state.menuY = rect.top + 12
            state.menuOpen = true
          }
        }
        return false
      }
      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault()
        if (!state.searchOpen) void openSearch()
        else input.value?.focus()
        return false
      }
      return true
    })
    const listener = terminal.onWriteParsed(() => {
      void refreshSearch()
    })
    const resizeListener = terminal.onResize(() => {
      void refreshSearch()
    })
    const selectionListener = terminal.onSelectionChange(() => {
      state.hasSelection = terminal.hasSelection()
    })
    onCleanup(() => {
      listener.dispose()
      resizeListener.dispose()
      selectionListener.dispose()
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
        toast.success('已复制终端选中内容')
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
    terminal.focus()
  } catch (error) {
    toast.error({ title: '终端操作失败', description: String(error) })
  }
}
function insertCommand(command: string): void {
  if (props.status !== 'connected' || !props.terminal) return
  props.terminal.paste(command)
  props.terminal.focus()
}
</script>

<template>
  <div class="relative flex shrink-0 items-center gap-1">
    <TerminalCommandMenu
      v-if="!local"
      :connected="status === 'connected' && Boolean(terminal)"
      @insert="insertCommand"
    />
    <IconButton
      v-if="!local"
      :icon="split ? 'lucide:rows-2' : 'lucide:columns-2'"
      :size="14"
      :title="split ? '关闭分屏' : '分屏（独立 SSH 会话）'"
      :disabled="!available"
      @click="emit('split')"
    />
    <IconButton
      icon="lucide:copy"
      :size="14"
      title="复制选中内容 (Ctrl+Shift+C)"
      :disabled="!state.hasSelection"
      @click="runAction('copy')"
    />
    <IconButton
      icon="lucide:search"
      :size="14"
      title="搜索终端 (Ctrl+F)"
      :disabled="!terminal"
      @click="openSearch"
    />
    <IconButton
      icon="lucide:rotate-cw"
      :size="14"
      :title="local ? '重新启动' : '重连'"
      :disabled="!available || status === 'connecting'"
      @click="emit('reconnect')"
    />
    <IconButton
      icon="lucide:ellipsis"
      :size="14"
      title="更多"
      :disabled="!terminal"
      @click="openMenu"
    />
    <div
      v-if="searchOpen"
      class="border-line absolute top-full right-0 z-30 mt-2 flex w-72 items-center gap-1 rounded-lg border bg-[var(--color-canvas)] p-2 shadow-lg"
      role="search"
      @keydown.esc.stop="closeSearch"
    >
      <input
        ref="input"
        v-model="query"
        aria-label="搜索终端内容"
        placeholder="搜索终端内容…"
        class="text-txt min-w-0 flex-1 bg-transparent text-xs outline-none"
        @keydown.enter.prevent="search($event.shiftKey ? -1 : 1)"
      />
      <span
        class="text-txt-3 shrink-0 text-[10px]"
        aria-live="polite"
        >{{ matchCount ? matchIndex + 1 : 0 }}/{{ matchCount }}</span
      >
      <IconButton
        icon="lucide:chevron-up"
        :size="12"
        title="上一个 (Shift+Enter)"
        :disabled="!matchCount"
        @click="search(-1)"
      />
      <IconButton
        icon="lucide:chevron-down"
        :size="12"
        title="下一个 (Enter)"
        :disabled="!matchCount"
        @click="search(1)"
      />
      <IconButton
        icon="lucide:x"
        :size="12"
        title="关闭搜索"
        @click="closeSearch"
      />
    </div>
    <AppContextMenu
      :open="menuOpen"
      :x="menuX"
      :y="menuY"
      :items="items"
      label="终端操作"
      @close="closeMenu"
      @select="runAction"
    />
  </div>
</template>
