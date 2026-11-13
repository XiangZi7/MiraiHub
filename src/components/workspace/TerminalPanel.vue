<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  shallowRef,
  toRefs,
  useTemplateRef,
  watch,
  type VNode,
} from 'vue'
import { useResizeObserver } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useSshTerminal } from '@/composables/useSshTerminal'
import { useSshShellCompletion } from '@/composables/useSshShellCompletion'
import { useSettings } from '@/composables/useSettings'
import SessionErrorNotice from '@/components/ui/SessionErrorNotice.vue'
import type { SshConfig, SshSessionStatus } from '@/types/ssh'
import '@xterm/xterm/css/xterm.css'
import TerminalSuggestions from '@/components/workspace/TerminalSuggestions.vue'
import TerminalActions from '@/components/workspace/TerminalActions.vue'
import TerminalInlineAi from '@/components/workspace/terminal-inline-ai.vue'
import TerminalStatusBar from '@/components/workspace/terminal-status-bar.vue'
import { useTerminalPresentation } from '@/composables/useTerminalPresentation'
import { listDirectory, readTerminalGitBranch } from '@/api/ssh'

const { t } = useI18n()

const { settings } = useSettings()

const props = defineProps<{
  /** 当前工作区是否已开启分屏 */
  split?: boolean
  /** 这一块是分屏出来的副面板，可以单独关掉 */
  closable?: boolean
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
  /** 工作区是否开启了广播输入 */
  broadcast?: boolean
}>()

const emit = defineEmits<{
  /** 请求新增一个分屏面板 */
  split: []
  /** 分屏按钮按下。交给上层区分这是点击还是拖拽选方向 */
  splitPointerDown: [event: PointerEvent]
  /** 关闭这个分屏面板 */
  close: []
  /**
   * 连接状态变化。带上后端会话 id，
   * 让机器面板能用它去查系统指标与目录列表。
   */
  status: [status: SshSessionStatus, sessionId: string]
  /** 把终端内容交给 AI，intent 区分解释与修复 */
  askAgent: [content: string, intent?: 'explain' | 'fix']
  /** 用户发往远端的输入，供分屏广播使用 */
  input: [data: string]
}>()

defineSlots<{
  metrics(): VNode[]
  actions(): VNode[]
}>()

const containerRef = useTemplateRef<HTMLElement>('terminal')
const terminalAreaRef = useTemplateRef<HTMLElement>('terminalArea')

const {
  term,
  route,
  status,
  sessionId,
  error,
  inputLine,
  mount,
  connect,
  disconnect,
  resize,
  sendInput,
  writeRaw,
  setInputInterceptor,
  setSubmitHandler,
} = useSshTerminal()
const {
  v4,
  directory,
  branch,
  gitError,
  position,
  size,
  refreshGit,
  trackSubmit,
} = useTerminalPresentation(term, sessionId, {
  readGitBranch: readTerminalGitBranch,
  readDirectory: listDirectory,
})

// 响应式状态
const state = reactive({
  // 仅保留用户主动选中的终端文本
  selectedText: '',
  // Ctrl+I 自然语言生成命令的输入条是否打开
  inlineAiOpen: false,
  // 是否显示“AI 修复”提示
  fixVisible: false,
})
const { selectedText, inlineAiOpen, fixVisible } = toRefs(state)

// 命令失败检测：最后提交的命令、它所在的缓冲区行号与启发式检测截止时间
let lastCommand = ''
let commandLine = -1
let watchUntil = 0
// 远端是否发出过 shell integration 标记；有则不再使用启发式
let shellIntegration = false
let fixTimer: ReturnType<typeof setTimeout> | undefined
// 启发式检测下一次扫描的起始行，避免大量输出时反复扫描整段缓冲区
let scanFrom = -1
// xterm 自动回应的报告序列：CPR / 焦点进出 / DA
// eslint-disable-next-line no-control-regex
const TERMINAL_REPORT = /^\x1b\[[\d;?>]*[RIOc]$/
// 启发式匹配的常见失败输出
const FAILURE_PATTERN =
  /command not found|no such file or directory|permission denied|\berror:|fatal:|\bfailed\b|traceback \(most recent call last\)|is not recognized as|cannot access|syntax error|segmentation fault/i

watch(
  term,
  (terminal, _, cleanup) => {
    state.selectedText = ''
    if (!terminal) return
    const disposables = [
      terminal.onSelectionChange(() => {
        state.selectedText = terminal.getSelection()
      }),
      terminal.onData(data => {
        // 终端自动回应远端查询的报告（光标位置、焦点、设备属性）不算用户输入
        if (!TERMINAL_REPORT.test(data)) dismissFix()
        // 全屏程序的按键不经过补全拦截器，在这里补发给广播
        if (
          terminal.buffer.active.type === 'alternate' &&
          status.value === 'connected'
        )
          emit('input', data)
      }),
      terminal.parser.registerOscHandler(133, handleShellMark),
      terminal.parser.registerOscHandler(633, handleShellMark),
      terminal.onWriteParsed(scanFailureOutput),
    ]
    cleanup(() => disposables.forEach(item => item.dispose()))
  },
  { immediate: true }
)
watch(status, () => {
  state.selectedText = ''
  state.inlineAiOpen = false
  dismissFix()
  shellIntegration = false
})

// 解析 shell integration 的 OSC 133/633 标记，D;<exitCode> 非 0 视为失败
function handleShellMark(data: string): boolean {
  shellIntegration = true
  const [kind, code] = data.split(';')
  if (kind === 'D' && code !== undefined && code !== '' && Number(code) !== 0)
    showFix()
  return false
}

// 回车提交命令时记录命令与起始行，开启 3 秒启发式检测窗口
function trackCommand(line: string): void {
  const terminal = term.value
  if (!terminal) return
  const buffer = terminal.buffer.active
  commandLine = buffer.baseY + buffer.cursorY
  lastCommand =
    line.trim() ||
    buffer.getLine(commandLine)?.translateToString(true).trim() ||
    ''
  watchUntil = lastCommand && !shellIntegration ? Date.now() + 3000 : 0
  scanFrom = commandLine + 1
}

// 启发式：在检测窗口内扫描命令之后的输出是否含常见错误
function scanFailureOutput(): void {
  const terminal = term.value
  if (!terminal || !watchUntil || shellIntegration) return
  if (Date.now() > watchUntil) {
    watchUntil = 0
    return
  }
  const buffer = terminal.buffer.active
  const end = buffer.baseY + buffer.cursorY
  // 跳过长命令自动换行出来的续行，避免命令本身含 error 等字样被误判
  while (scanFrom <= end && buffer.getLine(scanFrom)?.isWrapped) scanFrom++
  const lines: string[] = []
  // 只扫描新增输出；最后一行可能尚未写完，下次从它重新开始
  for (let index = Math.max(scanFrom, end - 200); index <= end; index++)
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
  scanFrom = Math.max(scanFrom, end)
  if (FAILURE_PATTERN.test(lines.join('\n'))) {
    watchUntil = 0
    showFix()
  }
}

// 显示“AI 修复”提示，8 秒后自动消失
function showFix(): void {
  if (status.value !== 'connected') return
  state.fixVisible = true
  if (fixTimer) clearTimeout(fixTimer)
  fixTimer = setTimeout(dismissFix, 8000)
}

// 隐藏“AI 修复”提示
function dismissFix(): void {
  state.fixVisible = false
  if (fixTimer) clearTimeout(fixTimer)
  fixTimer = undefined
}

// 把最后提交的命令和其后最多 80 行输出交给 AI 修复
function askFix(): void {
  const terminal = term.value
  dismissFix()
  if (!terminal || status.value !== 'connected') return
  const buffer = terminal.buffer.active
  const end = buffer.baseY + buffer.cursorY
  const start = Math.max(commandLine + 1, end - 79, 0)
  const output: string[] = []
  for (let index = start; index <= end; index++)
    output.push(buffer.getLine(index)?.translateToString(true) ?? '')
  emit('askAgent', `$ ${lastCommand}\n${output.join('\n').trimEnd()}`, 'fix')
}

// 选区交给 AI 解释
function askExplain(content: string): void {
  if (status.value === 'connected' && content.trim())
    emit('askAgent', content, 'explain')
}

// 打开自然语言生成命令输入条
function openInlineAi(): void {
  if (status.value !== 'connected') return
  dismissFix()
  state.inlineAiOpen = true
}

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
const showError = ref(false)
watch(error, message => {
  showError.value = Boolean(message)
})

/** 工具条上的连接状态文案与配色 */
const statusMeta = computed(() => {
  switch (status.value) {
    case 'connected':
      return {
        text: t('已连接'),
        tone: 'text-success',
        dot: 'success' as const,
      }
    default:
      return { text: t('已断开'), tone: 'text-txt-3', dot: 'txt-3' as const }
  }
})

/** 标题栏展示的目标 */
const endpoint = computed(() => {
  if (!props.config) return t('未选择服务器')

  return props.title || `${props.config.username}@${props.config.host}`
})

/**
 * 挂载并连接。
 * 同时等待配置与容器就位，避免首次挂载或新建分屏时漏掉初始化。
 * 比较配置内容，避免标签列表重新计算出的同值对象触发其他终端重连。
 */
watch(
  [
    // 通过 getter 比较容器身份；直接传模板 shallowRef 会在生产模式强制触发整个监听器。
    () => containerRef.value,
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
  if (fixTimer) clearTimeout(fixTimer)
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
  emit('input', suffix)
  completion.close()
  term.value?.focus()
}

// 终端输入拦截：先处理补全按键，未拦截的输入同时广播给其他分屏
function interceptTerminalInput(data: string): boolean {
  if (interceptCompletionKey(data)) return true
  if (status.value === 'connected') emit('input', data)
  return false
}

// 补全弹层打开时接管 Tab / 上下键 / Esc
function interceptCompletionKey(data: string): boolean {
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
setSubmitHandler(line => {
  trackSubmit(line)
  trackCommand(line)
  void completion.trackSubmittedCommand(line)
})
defineExpose({
  focus: () => term.value?.focus(),
  // 广播输入：原样写入本面板的会话
  write: writeRaw,
  reconnect,
  disconnect: disconnectSession,
})
</script>

<template>
  <section
    class="terminal-pane pane bg-terminal min-w-0 flex-1"
    :class="{ 'terminal-v4': v4 }"
    :aria-busy="status === 'connecting'"
  >
    <!-- 会话工具条：两种样式共用原有头部，保留监控信息、布局和全部操作。 -->
    <div
      class="terminal-header border-line-soft flex min-h-9 shrink-0 items-center gap-2.5 border-b px-3"
    >
      <span
        v-if="status !== 'connecting'"
        :class="[
          'flex shrink-0 items-center gap-1.5 text-[11px]',
          statusMeta.tone,
        ]"
      >
        <StatusDot
          :tone="statusMeta.dot"
          :size="6"
          :glow="status === 'connected'"
        />
        <span class="terminal-state-label">{{ statusMeta.text }}</span>
      </span>

      <span
        class="terminal-kind border-line bg-card text-txt-2 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium"
      >
        SSH
      </span>

      <span
        v-if="broadcast"
        class="border-accent text-accent flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]"
        :title="t('广播输入到所有分屏')"
      >
        <AppIcon
          name="lucide:radio-tower"
          :size="11"
        />{{ t('广播') }}
      </span>

      <span
        class="terminal-endpoint text-txt-2 max-w-36 shrink-0 truncate text-[11px]"
        :title="
          config
            ? `${config.username}@${config.host}:${config.port}`
            : undefined
        "
      >
        {{ endpoint }}
      </span>

      <div class="terminal-metrics min-w-0 flex-1">
        <slot name="metrics"><div class="flex-1" /></slot>
      </div>

      <TerminalActions
        :terminal="term"
        :status="status"
        :split="split"
        :closable="closable"
        :available="Boolean(config)"
        :ai="true"
        @ask-agent="askExplain"
        @inline-ai="openInlineAi"
        @split="emit('split')"
        @split-pointer-down="emit('splitPointerDown', $event)"
        @close="emit('close')"
        @reconnect="reconnect"
        @disconnect="disconnectSession"
        ><slot name="actions"
      /></TerminalActions>
    </div>

    <div
      v-if="route.length > 1"
      class="border-line-soft text-txt-3 flex shrink-0 items-center gap-2 overflow-x-auto border-b px-3 py-1 text-[10px]"
      :aria-label="t('SSH 连接链路')"
    >
      <span>{{ t('本机') }}</span
      ><span
        v-for="hop in route"
        :key="hop.hop"
        class="shrink-0"
        :class="
          hop.status === 'failed'
            ? 'text-danger'
            : hop.status === 'connected' && status === 'connected'
              ? 'text-success'
              : 'text-txt-3'
        "
        >→ {{ hop.endpoint }} ·
        {{
          t(
            hop.status === 'connecting'
              ? '连接中'
              : hop.status === 'failed'
                ? '失败'
                : status === 'disconnected'
                  ? '已断开'
                  : '已连接'
          )
        }}</span
      >
    </div>
    <!-- 终端输出区。xterm 自己接管这个容器的滚动与渲染，底色由这里给 -->
    <div
      v-if="config"
      ref="terminalArea"
      class="terminal-output bg-terminal relative min-h-0 flex-1 overflow-hidden"
    >
      <div
        ref="terminal"
        class="absolute inset-0"
        :class="[
          v4 ? 'px-4 py-3' : 'p-2',
          status === 'connecting' && 'invisible',
        ]"
      />
      <Transition
        enter-active-class="transition-opacity duration-150 motion-reduce:transition-none"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-100 motion-reduce:transition-none"
        leave-to-class="opacity-0"
      >
        <button
          v-if="selectedText.trim() && status === 'connected'"
          type="button"
          class="border-accent text-accent hover:bg-card focus-visible:outline-accent bg-panel absolute top-2.5 right-4.5 z-20 flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] shadow-[0_3px_12px_#0003] focus-visible:outline-2 focus-visible:outline-offset-2"
          @pointerdown.prevent
          @click="askExplain(selectedText)"
        >
          <AppIcon
            name="lucide:sparkles"
            :size="14"
          />{{ t('分析选中内容') }}
        </button>
      </Transition>
      <Transition
        enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
        enter-from-class="translate-y-1 opacity-0"
        leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
        leave-to-class="translate-y-1 opacity-0"
      >
        <div
          v-if="fixVisible && !inlineAiOpen"
          class="border-accent bg-panel absolute right-4 bottom-3 z-20 flex items-center overflow-hidden rounded-full border text-[11px] shadow-[0_3px_12px_#0003]"
        >
          <button
            type="button"
            class="text-accent hover:bg-hover flex cursor-pointer items-center gap-1.5 py-1 pr-1.5 pl-2.5"
            @pointerdown.prevent
            @click="askFix"
          >
            <AppIcon
              name="lucide:wand-sparkles"
              :size="13"
            />{{ t('AI 修复') }}
          </button>
          <button
            type="button"
            class="text-txt-3 hover:text-txt hover:bg-hover grid cursor-pointer place-items-center py-1 pr-2 pl-1"
            :aria-label="t('关闭')"
            @pointerdown.prevent
            @click="dismissFix"
          >
            <AppIcon
              name="lucide:x"
              :size="12"
            />
          </button>
        </div>
      </Transition>
      <TerminalInlineAi
        :open="inlineAiOpen"
        :terminal="term"
        :session-id="sessionId"
        @close="inlineAiOpen = false"
      />
      <SessionErrorNotice
        v-if="showError && error && status === 'disconnected'"
        class="absolute top-2 right-2 z-10 w-[min(380px,calc(100%-1rem))]"
        :message="error"
        :title="t('SSH 终端连接失败')"
        @retry="reconnect"
        @dismiss="showError = false"
      />
      <div
        v-if="status === 'connecting'"
        class="progress-indeterminate"
        role="progressbar"
        :aria-label="t('连接中…')"
      />
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
        <p class="text-txt-2 text-sm">{{ t('还没有打开终端') }}</p>
        <p class="text-txt-4 max-w-70 text-xs">
          {{ t('从左侧选一台服务器，或新建一个连接') }}
        </p>
      </div>
    </div>

    <!-- v4 状态栏：目录、分支与光标位置均来自当前终端，未知信息留空。 -->
    <TerminalStatusBar
      v-if="v4 && config"
      kind="ssh"
      :directory="directory"
      :branch="branch"
      :git-error="gitError"
      :position="position"
      :size="size"
      @retry-git="refreshGit"
    />
  </section>
</template>

<style scoped>
.terminal-pane {
  container-type: inline-size;
  container-name: terminal;
}
@container terminal (max-width: 640px) {
  .terminal-endpoint,
  .terminal-metrics {
    display: none;
  }
}
@container terminal (max-width: 360px) {
  .terminal-header {
    gap: 6px;
    padding-inline: 8px;
  }
  .terminal-state-label,
  .terminal-kind {
    display: none;
  }
}

/* xterm 自带 .xterm .xterm-viewport{background-color:#000}，而终端主题的 background
   是全透明，不盖掉它的话终端永远是纯黑 —— 浅色模式下整块黑面糊在白界面中间。
   选择器必须带上 .xterm 才比它高一级：xterm 的样式表被打包成独立 chunk，
   仅靠 :deep(.xterm-viewport) 是同特异性，谁生效取决于 chunk 加载顺序。
   底色交给容器的 bg-terminal（深浅两套令牌），xterm 只负责画字。 */
:deep(.xterm .xterm-viewport) {
  background-color: transparent;
}

/* 滚动条只在指针悬停面板时出现：静止时不让一条灰轨常驻在终端右侧 */
:deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

.terminal-pane:hover :deep(.xterm-viewport) {
  scrollbar-color: var(--color-line-strong) transparent;
}

:deep(.xterm-viewport)::-webkit-scrollbar {
  width: 8px;
}

:deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: transparent;
}

.terminal-pane:hover :deep(.xterm-viewport)::-webkit-scrollbar-thumb {
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
