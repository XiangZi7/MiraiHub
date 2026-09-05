<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import TerminalActions from './TerminalActions.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useLocalTerminal } from '@/composables/useLocalTerminal'
import { toast } from '@/composables/useToast'
import type { LocalConnectionSettings } from '@/types/connection'
import type { SshSessionStatus } from '@/types/ssh'
import '@xterm/xterm/css/xterm.css'

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
let mounted = false

const shellLabel = computed(
  () =>
    ({
      powershell: 'Windows PowerShell',
      cmd: 'Command Prompt',
      'git-bash': 'Git Bash',
    })[props.settings.shell]
)

const statusMeta = computed(() => {
  if (status.value === 'connected')
    return { text: 'Connected', tone: 'text-success', dot: 'success' as const }
  if (status.value === 'connecting')
    return { text: 'Starting…', tone: 'text-amber', dot: 'amber' as const }
  return { text: 'Disconnected', tone: 'text-txt-3', dot: 'txt-3' as const }
})

watch(status, value => emit('status', value, sessionId.value), {
  immediate: true,
})
watch(error, message => {
  if (message) toast.error({ title: '启动本地终端失败', description: message })
})

watch(
  [containerRef, () => JSON.stringify(props.settings)],
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
  <section class="pane bg-terminal min-w-0 flex-1">
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
      class="min-h-0 flex-1 p-2"
    />
  </section>
</template>

<style scoped>
:deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: var(--color-line-strong) transparent;
}
</style>
