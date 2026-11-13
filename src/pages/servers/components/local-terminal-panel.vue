<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import TerminalActions from '@/components/workspace/TerminalActions.vue'
import TerminalStatusBar from '@/components/workspace/terminal-status-bar.vue'
import { useTerminalPresentation } from '@/composables/useTerminalPresentation'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useLocalTerminal } from '@/composables/useLocalTerminal'
import { onTerminalTargetRequest } from '@/composables/useTerminalInsert'
import { toast } from '@/composables/useToast'
import type { LocalConnectionSettings } from '@/types/connection'
import type { SshSessionStatus } from '@/types/ssh'
import { LOCAL_SHELL_OPTIONS } from '@/constants/connection'
import { normalizeLocalShell } from '@/utils/platform'
import '@xterm/xterm/css/xterm.css'

const { t } = useI18n()

const props = defineProps<{
  connectionId?: string
  title: string
  settings: LocalConnectionSettings
}>()

const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string]
}>()

const containerRef = useTemplateRef<HTMLElement>('terminal')

const { term, status, sessionId, error, mount, connect, disconnect, resize } =
  useLocalTerminal()
const { v4, directory, branch, position, size } = useTerminalPresentation(
  term,
  sessionId
)
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
  <section
    class="local-terminal-pane pane bg-terminal min-w-0 flex-1"
    :class="{ 'terminal-v4': v4 }"
    :aria-busy="status === 'connecting'"
  >
    <!-- 本地终端顶栏：两种样式共用原有连接状态、名称和 Shell 信息。 -->
    <div
      class="border-line-soft flex h-9 shrink-0 items-center gap-2.5 border-b px-3"
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
        LOCAL
      </span>
      <span class="text-txt-2 truncate text-[11px]">{{ title }}</span>
      <span class="text-txt-4 truncate font-mono text-[10px]">{{
        shellLabel
      }}</span>
      <div class="flex-1" />
      <!-- 经典顶栏操作区：复用同一终端操作组件。 -->
      <TerminalActions
        :terminal="term"
        :status="status"
        available
        local
        @reconnect="reconnect"
        @disconnect="disconnect"
      />
    </div>
    <!-- 本地终端内容区：切换样式只调整内边距，保留挂载节点与会话。 -->
    <div
      ref="terminal"
      class="terminal-output bg-terminal min-h-0 flex-1"
      :class="v4 ? 'px-4 py-3' : 'p-2'"
    />
    <!-- 本地终端底栏：共用 v4 状态组件，路径优先读取实际 Shell 提示符。 -->
    <TerminalStatusBar
      v-if="v4"
      :kind="shellLabel"
      :directory="directory || settings.workingDirectory"
      :branch="branch"
      :position="position"
      :size="size"
    />
  </section>
</template>

<style scoped>
.local-terminal-pane {
  container-type: inline-size;
  container-name: terminal;
}

/* 盖掉 xterm 自带的 #000 底色，选择器带 .xterm 提一级特异性，
   见 TerminalPanel 里的同一处注释。 */
:deep(.xterm .xterm-viewport) {
  background-color: transparent;
}

/* 滚动条只在指针悬停面板时出现，与 SSH 面板同一规格 */
:deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

.local-terminal-pane:hover :deep(.xterm-viewport) {
  scrollbar-color: var(--color-line-strong) transparent;
}
</style>
