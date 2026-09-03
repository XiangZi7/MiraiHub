<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import IconButton from '@/components/ui/IconButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useLocalTerminal } from '@/composables/useLocalTerminal'
import type { LocalConnectionSettings } from '@/types/connection'
import type { SshSessionStatus } from '@/types/ssh'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  title: string
  settings: LocalConnectionSettings
}>()

const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string]
}>()

const containerRef = useTemplateRef<HTMLElement>('terminal')
const { status, sessionId, mount, connect, resize } = useLocalTerminal()
let mounted = false

const shellLabel = computed(() => ({
  powershell: 'Windows PowerShell',
  cmd: 'Command Prompt',
  'git-bash': 'Git Bash',
}[props.settings.shell]))

const statusMeta = computed(() => {
  if (status.value === 'connected')
    return { text: 'Connected', tone: 'text-accent', dot: 'accent' as const }
  if (status.value === 'connecting')
    return { text: 'Starting…', tone: 'text-amber', dot: 'amber' as const }
  return { text: 'Disconnected', tone: 'text-txt-3', dot: 'txt-3' as const }
})

watch(status, value => emit('status', value, sessionId.value), { immediate: true })

watch(
  () => props.settings,
  async (settings) => {
    if (!containerRef.value)
      return
    if (!mounted) {
      mount(containerRef.value)
      mounted = true
    }
    await connect(settings).catch(() => {})
  },
  { immediate: true, deep: true, flush: 'post' },
)

useResizeObserver(containerRef, () => resize())

function reconnect(): void {
  void connect(props.settings).catch(() => {})
}
</script>

<template>
  <section class="pane min-w-0 flex-1 bg-terminal">
    <div class="flex h-9 shrink-0 items-center gap-2.5 border-b border-line-soft px-3">
      <span :class="['flex items-center gap-1.5 text-[11px]', statusMeta.tone]">
        <StatusDot :tone="statusMeta.dot" :size="6" :glow="status === 'connected'" />
        <span>{{ statusMeta.text }}</span>
      </span>
      <span class="rounded border border-line bg-card px-1.5 py-0.5 text-[10px] font-medium text-txt-2">
        LOCAL
      </span>
      <span class="truncate text-[11px] text-txt-2">{{ title }}</span>
      <span class="truncate font-mono text-[10px] text-txt-4">{{ shellLabel }}</span>
      <div class="flex-1" />
      <IconButton icon="lucide:search" :size="14" title="搜索" />
      <IconButton icon="lucide:rotate-cw" :size="14" title="重新启动" @click="reconnect" />
      <IconButton icon="lucide:ellipsis" :size="14" title="更多" />
    </div>
    <div ref="terminal" class="min-h-0 flex-1 p-2" />
  </section>
</template>

<style scoped>
:deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: var(--color-line-strong) transparent;
}
</style>
