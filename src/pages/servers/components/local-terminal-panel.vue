<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  onScopeDispose,
  shallowRef,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { useResizeObserver } from '@vueuse/core'
import TerminalActions from '@/components/workspace/TerminalActions.vue'
import MachinePanel from '@/components/workspace/MachinePanel.vue'
import type { FilePaneDrop } from '@/components/workspace/useFilePaneDrag'
import AppResizeHandle from '@/components/ui/AppResizeHandle.vue'
import AppSidePane from '@/components/ui/AppSidePane.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useWorkspaceLayoutStore } from '@/stores/workspace-layout'
import type { MachineViewId } from '@/types'
import type { AgentContextRequest, AgentTarget } from '@/types/agent'
import type { AgentTerminalTarget } from '@/composables/useAgentContextBus'
import { useMachinePaneWidth } from '@/composables/useMachinePaneWidth'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useLocalTerminal } from '@/composables/useLocalTerminal'
import { useTerminalColors } from '@/composables/useTerminalColors'
import { listLocalDirectory } from '@/api/workspace-files'
import {
  onTerminalTargetRequest,
  pasteTerminalPaths,
} from '@/composables/useTerminalInsert'
import { toast } from '@/composables/useToast'
import type { LocalConnectionSettings } from '@/types/connection'
import type { SshSessionStatus } from '@/types/ssh'
import { LOCAL_SHELL_OPTIONS } from '@/constants/connection'
import { DESKTOP_PLATFORM, normalizeLocalShell } from '@/utils/platform'
import '@xterm/xterm/css/xterm.css'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    connectionId?: string
    active?: boolean
    title: string
    settings: LocalConnectionSettings
  }>(),
  { active: true }
)

const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string]
}>()

const containerRef = useTemplateRef<HTMLElement>('terminal')
const workspace = useTemplateRef<HTMLElement>('workspace')
const layout = useWorkspaceLayoutStore()
const paneId = props.connectionId || crypto.randomUUID()
const {
  open: sideOpen,
  view: sideView,
  width: preferredWidth,
} = toRefs(layout.machinePaneFor(paneId))
const {
  width: machineWidth,
  min: machineMinWidth,
  max: machineMaxWidth,
} = useMachinePaneWidth(workspace, preferredWidth)
const filesOpen = computed(() => sideOpen.value && sideView.value === 'files')
const agentOpen = computed(() => sideOpen.value && sideView.value === 'agent')
const machineVisited = shallowRef(false)
const contextRequest = shallowRef<AgentContextRequest | null>(null)
watch(
  () => props.active && sideOpen.value,
  open => {
    if (open) machineVisited.value = true
  },
  { immediate: true }
)
onScopeDispose(() => layout.removeMachinePane(paneId))

const { term, status, sessionId, error, mount, connect, disconnect, resize } =
  useLocalTerminal()

const agentTarget = computed<AgentTarget>(() => ({
  kind: 'local',
  sessionId: status.value === 'connected' ? sessionId.value : '',
  database: '',
}))
const terminalInsertTarget = computed<AgentTerminalTarget | undefined>(() => {
  const terminal = term.value
  const id = agentTarget.value.sessionId
  if (!terminal || !id) return undefined
  return {
    singleLineOnly: true,
    paste: text => {
      if (agentTarget.value.sessionId !== id || term.value !== terminal)
        throw new Error(t('终端未连接，无法插入'))
      // 本机 Shell 不一定启用括号粘贴，换行和控制字符可能触发执行。
      if (/[\u0000-\u001f\u007f-\u009f]/u.test(text))
        throw new Error(t('本地终端只能插入单行命令'))
      terminal.paste(text)
    },
    focus: () => terminal.focus(),
  }
})
watch(
  () => agentTarget.value.sessionId,
  () => {
    contextRequest.value = null
  }
)

/** 点击同一页签收起侧栏，切换文件与 AI 时沿用当前侧栏宽度。 */
function toggleSidePane(view: MachineViewId): void {
  if (sideOpen.value && sideView.value === view) sideOpen.value = false
  else layout.openMachinePane(paneId, view)
}

/** 将用户选中的终端内容放入 AI 草稿，等用户确认发送。 */
function askAgent(content: string): void {
  const target = agentTarget.value
  if (!target.sessionId || !content.trim()) return
  contextRequest.value = {
    id: crypto.randomUUID(),
    target,
    source: 'terminal',
    intent: 'explain',
    content,
  }
  layout.openMachinePane(paneId, 'agent')
}

// 按 Shell 显示的本机绝对路径读取目录，跳过无法直接解析的相对路径。
useTerminalColors(term, sessionId, async (_id, path) => {
  const absolute =
    DESKTOP_PLATFORM === 'windows'
      ? /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(path)
      : path.startsWith('/')
  if (!absolute) return []
  const { entries } = await listLocalDirectory(path)
  return entries.map(entry => ({
    name: entry.name,
    kind: entry.directory ? ('directory' as const) : ('file' as const),
  }))
})
let mounted = false

const shellLabel = computed(() =>
  t(
    LOCAL_SHELL_OPTIONS.find(
      option => option.value === normalizeLocalShell(props.settings.shell)
    )?.label ?? '系统默认 Shell'
  )
)

// 工具条上的状态文案与配色
const statusMeta = computed(() => {
  if (status.value === 'connected')
    return {
      text: t('已连接'),
      tone: 'text-success',
      dot: 'success' as const,
    }
  if (status.value === 'connecting')
    return { text: t('启动中…'), tone: 'text-amber', dot: 'amber' as const }
  return { text: t('已断开'), tone: 'text-txt-3', dot: 'txt-3' as const }
})

watch(status, value => emit('status', value, sessionId.value), {
  immediate: true,
})
watch(error, message => {
  if (message)
    toast.error({ title: t('启动本地终端失败'), description: message })
})

watch(
  // getter 避免模板 shallowRef 在生产模式下让同值配置也触发重启。
  [() => containerRef.value, () => JSON.stringify(props.settings)],
  async ([container]) => {
    if (!container) return
    if (!mounted) {
      mount(container)
      mounted = true
    }
    await connect(props.settings).catch(() => {})
  },
  { immediate: true, flush: 'post' }
)

useResizeObserver(containerRef, () => resize())

// 命令面板插入片段时提供本终端；交给 xterm 粘贴，由它按 shell 是否开启括号粘贴处理换行
onTerminalTargetRequest(tabId =>
  tabId === props.connectionId && status.value === 'connected' && term.value
    ? {
        paste: text => term.value?.paste(text),
        focus: () => term.value?.focus(),
      }
    : undefined
)

/** 将选中文件的路径插入当前本地 Shell 的输入行。 */
function insertFilePaths(paths: string[]): void {
  if (status.value !== 'connected') {
    toast.info(t('终端未连接，无法插入'))
    return
  }
  pasteTerminalPaths(
    term.value,
    paths,
    normalizeLocalShell(props.settings.shell)
  )
}

/** 接收同一会话的本地文件拖放，忽略不匹配的来源或过期会话。 */
function receiveFilePaths(event: Event): void {
  const { detail } = event as CustomEvent<FilePaneDrop>
  if (detail.source === 'local' && detail.sessionId === sessionId.value)
    insertFilePaths(detail.files.map(file => file.path))
}

/** 重新启动当前本地连接，沿用其 Shell 与工作目录。 */
function reconnect(): void {
  void connect(props.settings).catch(() => {})
}
defineExpose({
  reconnectFor: async (id: string) => {
    if (props.connectionId === id) await connect(props.settings).catch(() => {})
  },
  disconnectFor: async (id: string) => {
    if (props.connectionId === id) await disconnect()
  },
})
</script>

<template>
  <div
    ref="workspace"
    class="flex min-h-0 min-w-0 flex-1"
  >
    <!-- 终端区：与 SSH 终端共用面板外观和输出布局。 -->
    <section
      class="terminal-pane pane"
      :aria-busy="status === 'connecting'"
    >
      <!-- 本地终端顶栏：展示连接状态、名称和 Shell 信息。 -->
      <div class="terminal-header">
        <span
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
          LOCAL
        </span>
        <span class="text-txt-2 truncate text-[11px]">{{ title }}</span>
        <span class="text-txt-4 truncate font-mono text-[10px]">{{
          shellLabel
        }}</span>
        <div class="flex-1" />
        <!-- 本地终端操作区：与 SSH 终端共用操作组件。 -->
        <TerminalActions
          :terminal="term"
          :status="status"
          available
          local
          ai
          @ask-agent="askAgent"
          @reconnect="reconnect"
          @disconnect="disconnect"
        >
          <IconButton
            icon="lucide:folder-open"
            :size="14"
            :title="t(filesOpen ? '收起文件面板' : '打开文件面板')"
            :class="filesOpen && 'text-accent'"
            :aria-pressed="filesOpen"
            @click="toggleSidePane('files')"
          />
          <!-- AI 按钮：打开绑定当前本地会话的 Agent 侧栏。 -->
          <IconButton
            icon="lucide:bot"
            :size="14"
            :title="t('AI Agent 分屏')"
            :class="agentOpen && 'text-accent'"
            :aria-pressed="agentOpen"
            @click="toggleSidePane('agent')"
          />
        </TerminalActions>
      </div>
      <!-- 本地终端内容区：与 SSH 共用输出容器样式，随可用高度适配网格。 -->
      <div
        class="terminal-output"
        data-file-drop-target="terminal"
        data-file-terminal-source="local"
        :data-file-session-id="status === 'connected' ? sessionId : undefined"
        @mirai-file-drop="receiveFilePaths"
      >
        <div
          ref="terminal"
          class="terminal-mount"
        />
      </div>
    </section>
    <AppSidePane
      v-if="machineVisited"
      :open="sideOpen"
      :width="machineWidth + 10"
    >
      <AppResizeHandle
        v-model="machineWidth"
        pane-side="right"
        :min="machineMinWidth"
        :max="machineMaxWidth"
        :label="t('调整机器面板宽度')"
      />
      <MachinePanel
        v-model:view="sideView"
        :local-settings="settings"
        :title="title"
        :session-id="agentTarget.sessionId"
        :active="active && sideOpen"
        :width="machineWidth"
        :context-request="contextRequest"
        :terminal-insert-target="terminalInsertTarget"
        @close="sideOpen = false"
        @context-consumed="contextRequest = null"
      />
    </AppSidePane>
  </div>
</template>
