<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import TerminalActions from '@/components/workspace/TerminalActions.vue'
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

/** 底部状态栏展示的终端网格尺寸（列 × 行），随 xterm resize 更新 */
const termSize = ref('')
let resizeDisposable: { dispose: () => void } | undefined
watch(term, terminal => {
  resizeDisposable?.dispose()
  resizeDisposable = undefined
  if (!terminal) return
  termSize.value = `${terminal.cols} × ${terminal.rows}`
  resizeDisposable = terminal.onResize(({ cols, rows }) => {
    termSize.value = `${cols} × ${rows}`
  })
})
onBeforeUnmount(() => resizeDisposable?.dispose())

/** 顶栏主机色块上的首字母，取标题第一个字符 */
const hostInitial = computed(() => props.title.charAt(0).toUpperCase() || 'L')
const { term, status, sessionId, error, mount, connect, disconnect, resize } =
  useLocalTerminal()
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
  <section class="local-terminal-pane pane bg-terminal min-w-0 flex-1">
    <div
      class="border-line-soft flex h-9 shrink-0 items-center gap-2.5 border-b px-3"
    >
      <span
        class="bg-accent grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white select-none"
        aria-hidden="true"
        >{{ hostInitial }}</span
      >
      <span :class="['flex items-center gap-1.5 text-[11px]', statusMeta.tone]">
        <StatusDot
          :tone="statusMeta.dot"
          :size="6"
          :glow="status === 'connected'"
        />
        <span>{{ statusMeta.text }}</span>
      </span>
      <span class="text-txt-4 shrink-0 text-[10px] font-medium tracking-wider">
        LOCAL
      </span>
      <span class="text-txt-2 truncate text-[11px]">{{ title }}</span>
      <span class="text-txt-4 truncate font-mono text-[10px]">{{
        shellLabel
      }}</span>
      <div class="flex-1" />
      <TerminalActions
        :terminal="term"
        :status="status"
        available
        local
        @reconnect="reconnect"
        @disconnect="disconnect"
      />
    </div>
    <div
      ref="terminal"
      class="bg-terminal min-h-0 flex-1 px-4 py-3"
    />
    <!-- 底部状态栏：与 SSH 面板同一规格，展示 shell 与网格尺寸等真实数据 -->
    <div
      class="border-line-soft text-txt-3 flex h-6 shrink-0 items-center gap-3 border-t px-3 font-mono text-[10px]"
    >
      <span class="truncate">{{ shellLabel }}</span>
      <div class="flex-1" />
      <span v-if="termSize">{{ termSize }}</span>
      <span :class="status === 'connected' && 'text-success'">{{
        statusMeta.text
      }}</span>
    </div>
  </section>
</template>

<style scoped>
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
