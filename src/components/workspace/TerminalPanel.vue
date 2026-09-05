<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import { useResizeObserver } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useSshTerminal } from '@/composables/useSshTerminal'
import { useSshShellCompletion } from '@/composables/useSshShellCompletion'
import { useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import type { SshConfig, SshSessionStatus } from '@/types/ssh'
import '@xterm/xterm/css/xterm.css'
import TerminalSuggestions from './TerminalSuggestions.vue'
import TerminalActions from './TerminalActions.vue'

const { settings } = useSettings()

const props = defineProps<{
  /** 当前工作区是否已开启分屏 */
  split?: boolean
  /**
   * 要连接的目标。为空表示还没选服务器，此时展示空状态而不是一个连不上的终端。
   * 由上层在用户选中连接后传入。
   */
  config?: SshConfig
  /** 连接名，展示在工具条上。缺省时退回 user@host */
  title?: string
  /** 请求远端 PTY 使用的终端类型 */
  terminalType?: string
  /** shell 就绪后自动执行，空串表示不执行 */
  startupCommand?: string
}>()

const emit = defineEmits<{
  /** 请求打开或关闭副终端 */
  split: []
  /**
   * 连接状态变化。带上后端会话 id，
   * 让机器面板能用它去查系统指标与目录列表。
   */
  status: [status: SshSessionStatus, sessionId: string]
}>()

const containerRef = useTemplateRef<HTMLElement>('terminal')
const terminalAreaRef = useTemplateRef<HTMLElement>('terminalArea')

const {
  term,
  status,
  sessionId,
  error,
  inputLine,
  mount,
  connect,
  disconnect,
  resize,
  sendInput,
  setInputInterceptor,
  setSubmitHandler,
} = useSshTerminal()

const completionEnabled = computed(() => status.value === 'connected')
const completion = useSshShellCompletion({
  sessionId,
  inputLine,
  enabled: completionEnabled,
})
const completionAnchor = shallowRef({
  left: 12,
  top: 40 as number | undefined,
  bottom: undefined as number | undefined,
  width: 420,
  maxHeight: 260,
})
let anchorFrame = 0

// xterm 是否已挂到容器上。挂载只做一次，重连复用同一个实例。
// 用普通变量而非响应式：模板不读它，只是 watch 内部的一次性标记
let mounted = false
let disposed = false
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectAttempts = 0
let intentionalReconnect = false

/** 状态变化即上报，让标签页的状态点跟着走 */
watch(
  status,
  (value, previous) => {
    emit('status', value, sessionId.value)
    if (value === 'connected') {
      reconnectAttempts = 0
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    } else if (
      !intentionalReconnect &&
      previous === 'connected' &&
      value === 'disconnected'
    ) {
      scheduleAutoReconnect()
    }
  },
  { immediate: true }
)
watch(error, message => {
  if (message) toast.error({ title: 'SSH 终端连接失败', description: message })
})

/** 工具条上的连接状态文案与配色 */
const statusMeta = computed(() => {
  switch (status.value) {
    case 'connected':
      return {
        text: 'Connected',
        tone: 'text-success',
        dot: 'success' as const,
      }
    case 'connecting':
      return { text: 'Connecting…', tone: 'text-amber', dot: 'amber' as const }
    default:
      return { text: 'Disconnected', tone: 'text-txt-3', dot: 'txt-3' as const }
  }
})

/** 标题栏展示的目标 */
const endpoint = computed(() => {
  if (!props.config) return '未选择服务器'

  return props.title || `${props.config.username}@${props.config.host}`
})

/**
 * 连接提示是瞬时界面状态，不写入 xterm 缓冲区。
 * 这样连接完成后提示会真正移除，重连也不会把它夹在远端输出中间。
 */
const connectingText = computed(() => {
  if (!props.config) return ''

  return `正在连接 ${props.config.username}@${props.config.host}:${props.config.port} …`
})

/**
 * 挂载并连接。
 * 同时等待配置与容器就位，避免首次挂载或新建分屏时漏掉初始化。
 * 比较配置内容，避免标签列表重新计算出的同值对象触发其他终端重连。
 */
watch(
  [
    containerRef,
    () =>
      JSON.stringify([props.config, props.terminalType, props.startupCommand]),
  ],
  async ([container]) => {
    const config = props.config
    if (!config || !container) return

    if (!mounted) {
      mount(container)
      mounted = true
    }

    intentionalReconnect = true
    try {
      await connect(config, {
        terminalType: props.terminalType,
        startupCommand: props.startupCommand,
      })
    } catch {
      // 失败原因已经写进终端并存到 composable 的 error，这里只是别让 rejection 逃逸
    } finally {
      intentionalReconnect = false
    }
  },
  { immediate: true, flush: 'post' }
)

/**
 * 容器尺寸变化时重新适配。
 * 光靠 window resize 不够：收起机器面板会让终端变宽，但窗口尺寸没变，
 * 不重算的话右侧会留一大片空白。
 */
useResizeObserver(containerRef, () => {
  resize()
  scheduleCompletionAnchorUpdate()
})

function scheduleCompletionAnchorUpdate(): void {
  cancelAnimationFrame(anchorFrame)
  anchorFrame = requestAnimationFrame(updateCompletionAnchor)
}

/** 把建议框贴到当前输入 token，而不是固定压在终端底部。 */
function updateCompletionAnchor(): void {
  const terminal = term.value
  const area = terminalAreaRef.value
  const screen = terminal?.element?.querySelector<HTMLElement>('.xterm-screen')
  if (!terminal || !area || !screen || !completion.open.value) return

  const areaRect = area.getBoundingClientRect()
  const screenRect = screen.getBoundingClientRect()
  const cellWidth = screenRect.width / Math.max(terminal.cols, 1)
  const cellHeight = screenRect.height / Math.max(terminal.rows, 1)
  const tokenLength = [...currentToken(inputLine.value)].length
  const tokenColumn = Math.max(0, terminal.buffer.active.cursorX - tokenLength)
  const cursorTop =
    screenRect.top - areaRect.top + terminal.buffer.active.cursorY * cellHeight
  const desiredWidth = Math.min(440, Math.max(260, areaRect.width - 24))
  const left = Math.min(
    Math.max(12, screenRect.left - areaRect.left + tokenColumn * cellWidth),
    Math.max(12, areaRect.width - desiredWidth - 12)
  )
  const belowTop = cursorTop + cellHeight + 5
  const roomBelow = areaRect.height - belowTop - 10
  const roomAbove = cursorTop - 10
  const placeBelow = roomBelow >= 140 || roomBelow >= roomAbove
  const availableHeight = Math.max(92, placeBelow ? roomBelow : roomAbove)

  completionAnchor.value = {
    left,
    top: placeBelow ? belowTop : undefined,
    bottom: placeBelow ? undefined : areaRect.height - cursorTop + 5,
    width: desiredWidth,
    maxHeight: Math.min(260, availableHeight),
  }
}

watch(
  [
    () => completion.open.value,
    inputLine,
    () => completion.suggestions.value.length,
  ],
  ([isOpen]) => {
    if (isOpen) void nextTick(scheduleCompletionAnchorUpdate)
  }
)

watch(
  term,
  (terminal, _previous, onCleanup) => {
    const disposable = terminal?.onCursorMove(scheduleCompletionAnchorUpdate)
    onCleanup(() => disposable?.dispose())
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(anchorFrame)
  if (reconnectTimer) clearTimeout(reconnectTimer)
})

function scheduleAutoReconnect(): void {
  if (
    disposed ||
    !settings.autoReconnect ||
    !props.config ||
    reconnectAttempts >= 3 ||
    reconnectTimer
  )
    return

  reconnectAttempts += 1
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = undefined
    if (disposed || !settings.autoReconnect || !props.config) return
    await connect(props.config, {
      terminalType: props.terminalType,
      startupCommand: props.startupCommand,
    }).catch(scheduleAutoReconnect)
  }, reconnectAttempts * 1500)
}

/** 重连：先断干净再按原配置连一次 */
async function reconnect(): Promise<void> {
  if (!props.config) return

  reconnectAttempts = 0
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = undefined

  intentionalReconnect = true
  try {
    await connect(props.config, {
      terminalType: props.terminalType,
      startupCommand: props.startupCommand,
    })
  } catch {
  } finally {
    intentionalReconnect = false
  }
}

async function disconnectSession(): Promise<void> {
  intentionalReconnect = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  try {
    await disconnect()
  } finally {
    intentionalReconnect = false
  }
}

function currentToken(line: string): string {
  return line.match(/\S+$/)?.[0] ?? ''
}

function acceptSuggestion(item = completion.activeSuggestion.value): void {
  if (!item) return

  const token = currentToken(inputLine.value)
  if (!item.value.toLocaleLowerCase().startsWith(token.toLocaleLowerCase()))
    return

  const suffix =
    item.value.slice(token.length) + (item.kind === 'directory' ? '' : ' ')
  sendInput(suffix)
  completion.close()
  term.value?.focus()
}

function interceptTerminalInput(data: string): boolean {
  if (!completion.open.value) return false

  if (data === '\t') {
    acceptSuggestion()
    return true
  }
  if (data === '\x1b[A') {
    completion.move(-1)
    return true
  }
  if (data === '\x1b[B') {
    completion.move(1)
    return true
  }
  if (data === '\x1b') {
    completion.close()
    return true
  }

  return false
}

setInputInterceptor(interceptTerminalInput)
setSubmitHandler(line => void completion.trackSubmittedCommand(line))
defineExpose({
  focus: () => term.value?.focus(),
  reconnect,
  disconnect: disconnectSession,
})
</script>

<template>
  <section class="pane bg-terminal min-w-0 flex-1">
    <!-- 会话工具条 -->
    <div
      class="border-line-soft flex min-h-9 shrink-0 items-center gap-2.5 border-b px-3"
    >
      <span :class="['flex items-center gap-1.5 text-[11px]', statusMeta.tone]">
        <StatusDot
          :tone="statusMeta.dot"
          :size="6"
          :glow="status === 'connected'"
        />
        <span>{{ statusMeta.text }}</span>
      </span>

      <span
        class="border-line bg-card text-txt-2 rounded border px-1.5 py-0.5 text-[10px] font-medium"
      >
        SSH
      </span>

      <span
        class="text-txt-2 truncate text-[11px]"
        :title="sessionId || undefined"
      >
        {{ endpoint }}
      </span>

      <div class="flex-1" />

      <TerminalActions
        :terminal="term"
        :status="status"
        :split="split"
        :available="Boolean(config)"
        @split="emit('split')"
        @reconnect="reconnect"
        @disconnect="disconnectSession"
      />
    </div>

    <!-- 终端输出区。xterm 自己接管这个容器的滚动与渲染 -->
    <div
      v-if="config"
      ref="terminalArea"
      class="relative min-h-0 flex-1 overflow-hidden"
    >
      <div
        ref="terminal"
        class="absolute inset-0 p-2"
      />
      <p
        v-if="status === 'connecting'"
        class="text-txt-3 pointer-events-none absolute top-2 left-2 z-10 font-mono text-xs leading-[1.4]"
        role="status"
        aria-live="polite"
      >
        {{ connectingText }}
      </p>
      <Transition name="terminal-completion">
        <TerminalSuggestions
          v-if="completion.open.value"
          :items="completion.suggestions.value"
          :active-index="completion.activeIndex.value"
          :loading="completion.loading.value"
          :anchor="completionAnchor"
          @hover="completion.activeIndex.value = $event"
          @select="acceptSuggestion"
        />
      </Transition>
    </div>

    <!-- 还没选服务器 -->
    <div
      v-else
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <div class="flex flex-col items-center gap-3 text-center">
        <div
          class="border-line bg-card text-txt-3 grid size-14 place-items-center rounded-2xl border"
        >
          <AppIcon
            name="lucide:square-terminal"
            :size="26"
          />
        </div>
        <p class="text-txt-2 text-sm">还没有打开终端</p>
        <p class="text-txt-4 max-w-70 text-xs">
          从左侧选一台服务器，或新建一个连接
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* xterm 默认给容器加内边距的位置不对，且它的滚动条要跟项目其余部分统一 */
:deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: var(--color-line-strong) transparent;
}

:deep(.xterm-viewport)::-webkit-scrollbar {
  width: 8px;
}

:deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--color-line-strong);
}

:deep(.xterm-viewport)::-webkit-scrollbar-track {
  background: transparent;
}

.terminal-completion-enter-active,
.terminal-completion-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.terminal-completion-enter-from,
.terminal-completion-leave-to {
  transform: translateY(4px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .terminal-completion-enter-active,
  .terminal-completion-leave-active {
    transition: none;
  }
}
</style>
