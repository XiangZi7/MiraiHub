<script setup lang="ts">
import {
  computed,
  nextTick,
  reactive,
  shallowRef,
  toRefs,
  useTemplateRef,
} from 'vue'
import type { SshConfig, SshSessionStatus } from '@/types/ssh'
import TerminalPanel from './TerminalPanel.vue'
import AiAgentPanel from '@/components/agent/AiAgentPanel.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'

const props = withDefaults(
  defineProps<{
    connectionId?: string
    config: SshConfig
    title?: string
    terminalType?: string
    startupCommand?: string
    active?: boolean
  }>(),
  { active: true }
)
const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string]
}>()
const split = shallowRef(false)
// AI 始终绑定主终端的会话；切换连接后不复用旧会话审批。
const state = reactive({ aiOpen: false, aiSplit: false, sessionId: '' })
const { aiOpen, aiSplit } = toRefs(state)
const target = computed(() => ({
  kind: 'ssh' as const,
  sessionId: state.sessionId,
  database: '',
}))
const primary = useTemplateRef<InstanceType<typeof TerminalPanel>>('primary')
const secondary =
  useTemplateRef<InstanceType<typeof TerminalPanel>>('secondary')
function statusChanged(status: SshSessionStatus, sessionId: string): void {
  state.sessionId = status === 'connected' ? sessionId : ''
  emit('status', status, sessionId)
}
function splitAgent(): void {
  state.aiSplit = !(state.aiOpen && state.aiSplit)
  state.aiOpen = true
}
function showTerminal(): void {
  state.aiOpen = false
  void nextTick(() => primary.value?.focus())
}
defineExpose({
  reconnectFor: async (id: string) => {
    if (props.connectionId !== id) return
    await primary.value?.reconnect()
    await secondary.value?.reconnect()
  },
  disconnectFor: async (id: string) => {
    if (props.connectionId !== id) return
    await primary.value?.disconnect()
    await secondary.value?.disconnect()
  },
  focusFor: (id: string) => {
    if (props.connectionId === id) {
      showTerminal()
      primary.value?.focus()
    }
  },
  splitFor: async (id: string) => {
    if (props.connectionId !== id) return
    split.value = !split.value
    await nextTick()
    primary.value?.focus()
  },
})
</script>

<template>
  <div class="ssh-agent-workspace">
    <div class="workspace-tabs">
      <button
        type="button"
        :class="(!aiOpen || aiSplit) && 'selected'"
        @click="showTerminal"
      >
        <AppIcon
          name="lucide:terminal"
          :size="13"
        />SSH
      </button>
      <button
        type="button"
        :class="aiOpen && 'selected'"
        @click="aiOpen = true"
      >
        <AppIcon
          name="lucide:bot"
          :size="14"
        />AI Agent
        <span class="beta">BETA</span>
      </button>
      <div class="flex-1" />
      <IconButton
        icon="lucide:rows-2"
        :size="14"
        title="新建或关闭第二个 SSH 终端"
        :class="split && 'text-accent'"
        @click="split = !split"
      />
      <IconButton
        icon="lucide:columns-2"
        :size="14"
        title="AI Agent 分屏"
        :class="aiOpen && aiSplit && 'text-accent'"
        @click="splitAgent"
      />
    </div>
    <div class="workspace-content">
      <div
        v-show="!aiOpen || aiSplit"
        class="terminal-stack"
        :class="split && 'flex-col'"
      >
        <TerminalPanel
          ref="primary"
          :config="config"
          :title="title"
          :terminal-type="terminalType"
          :startup-command="startupCommand"
          :split="aiOpen && aiSplit"
          @split="splitAgent"
          @status="statusChanged"
        />
        <TerminalPanel
          ref="secondary"
          v-if="split"
          :config="config"
          :title="`${title || config.host} · 分屏`"
          :terminal-type="terminalType"
          split
          @split="split = false"
        />
      </div>
      <AiAgentPanel
        v-show="aiOpen"
        :target="target"
        :title="title || config.host"
        :active="active && aiOpen"
        :split="aiSplit"
        :class="aiSplit && 'split-agent'"
        @split="splitAgent"
        @close="showTerminal"
      />
    </div>
  </div>
</template>
<style scoped>
.ssh-agent-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 6px;
}
.workspace-tabs {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  flex-shrink: 0;
  padding: 0 8px;
}
.workspace-tabs > button:not([title]) {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-txt-3);
  height: 32px;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.workspace-tabs > button.selected {
  color: var(--color-txt);
  border-bottom-color: var(--color-accent);
}
.beta {
  font-size: 8px;
  color: #9ac3ff;
  background: #8aaaff15;
  padding: 1px 3px;
  border-radius: 3px;
}
.workspace-content {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  gap: 8px;
  container-type: inline-size;
}
.terminal-stack {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 8px;
}
.split-agent {
  flex: 0 0 44%;
  min-width: 280px;
}
@container (max-width:650px) {
  .split-agent {
    min-width: 250px;
  }
}
</style>
