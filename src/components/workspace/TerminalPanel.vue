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
import TerminalSuggestions from './TerminalSuggestions.vue'
import TerminalActions from './TerminalActions.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import type { ContextMenuItem } from '@/types/context-menu'
import { copyText } from '@/utils/clipboard'
import { toast } from '@/composables/useToast'

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
  askAgent: [content: string]
}>()

defineSlots<{
  metrics(): any
  actions(): any
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

// 响应式状态
const state = reactive({
  // 仅保留用户主动选中的终端文本
  selectedText: '',
  // 右键打开时冻结选区，避免菜单抢焦点后丢失
  contextMenu: { open: false, x: 0, y: 0, text: '' },
})
const { selectedText, contextMenu } = toRefs(state)
watch(
  term,
  (terminal, _, cleanup) => {
    state.selectedText = ''
    const listener = terminal?.onSelectionChange(() => {
      state.selectedText = terminal.getSelection()
    })
    cleanup(() => listener?.dispose())
  },
  { immediate: true }
)
watch(status, () => {
  state.contextMenu.open = false
  state.selectedText = ''
})
const contextItems = computed<ContextMenuItem[]>(() => [
  {
    id: 'ask-agent',
    label: t('让 AI 分析选区'),
    icon: 'lucide:sparkles',
    disabled: status.value !== 'connected' || !state.contextMenu.text.trim(),
  },
  {
    id: 'copy',
    label: t('复制'),
    icon: 'lucide:copy',
    separatorBefore: true,
    disabled: !state.contextMenu.text,
  },
])
function openContextMenu(event: MouseEvent): void {
  state.contextMenu = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    text: state.selectedText || term.value?.getSelection() || '',
  }
}
async function contextAction(id: string): Promise<void> {
  const content = state.contextMenu.text
  state.contextMenu.open = false
  if (id === 'ask-agent' && status.value === 'connected' && content.trim())
    emit('askAgent', content)
  if (id === 'copy' && content) {
    try {
      await copyText(content)
    } catch {
      toast.error(t('复制失败，请选中文字后按 Ctrl+C'))
    }
  }
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
        text: t('Connected'),
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
  if (!props.config) return t('未选择服务器')

  return props.title || `${props.config.username}@${props.config.host}`
})

/* xterm 自带 .xterm .xterm-viewport{background-color:#000}，而终端主题的 background
   是全透明，不盖掉它的话终端永远是纯黑 —— 浅色模式下整块黑面糊在白界面中间。
   选择器必须带上 .xterm 才比它高一级：xterm 的样式表被打包成独立 chunk，
   仅靠 :deep(.xterm-viewport) 是同特异性，谁生效取决于 chunk 加载顺序。
   底色交给容器的 bg-terminal（深浅两套令牌），xterm 只负责画字。 */
:deep(.xterm .xterm-viewport) {
  background-color: transparent;
}

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
