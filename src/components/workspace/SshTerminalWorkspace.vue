<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { nextTick, reactive, toRefs, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SshConfig, SshSessionStatus } from '@/types/ssh'
import type { SavedConnection } from '@/types/connection'
import type { AgentContextRequest } from '@/types/agent'
import {
  MACHINE_MIN_WIDTH,
  useWorkspaceLayoutStore,
} from '@/stores/workspace-layout'
import TerminalPanel from './TerminalPanel.vue'
import MachinePanel from './MachinePanel.vue'
import ServerStatusBar from './ServerStatusBar.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppResizeHandle from '@/components/ui/AppResizeHandle.vue'
import AppSidePane from '@/components/ui/AppSidePane.vue'

const { t } = useI18n()
const props = withDefaults(
  defineProps<{
    connectionId?: string
    connection?: SavedConnection
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
const { machineWidth, machineOpen, machineView, machineMaxWidth, recording } =
  storeToRefs(useWorkspaceLayoutStore())
// 响应式状态
const state = reactive({
  // 是否打开独立的第二个 SSH 终端
  split: false,
  // 主终端会话，Agent 和服务器指标始终绑定这个会话
  sessionId: '',
  // 侧面板首次访问后保留挂载，收起时不丢失 Agent 草稿
  machineVisited: false,
  // 从终端显式选择、待加入 AI 草稿的上下文
  contextRequest: null as AgentContextRequest | null,
})
const { split, sessionId, machineVisited, contextRequest } = toRefs(state)
const primary = useTemplateRef<InstanceType<typeof TerminalPanel>>('primary')
const secondary =
  useTemplateRef<InstanceType<typeof TerminalPanel>>('secondary')
const machinePanel =
  useTemplateRef<InstanceType<typeof MachinePanel>>('machinePanel')
watch(
  () => props.active && machineOpen.value,
  open => {
    if (open) state.machineVisited = true
  },
  { immediate: true }
)

function statusChanged(status: SshSessionStatus, sessionId: string): void {
  state.sessionId = status === 'connected' ? sessionId : ''
  emit('status', status, sessionId)
}
function toggleAgent(): void {
  if (machineOpen.value && machineView.value === 'agent')
    machineOpen.value = false
  else {
    machineView.value = 'agent'
    machineOpen.value = true
  }
}
function askAgent(content: string): void {
  if (!state.sessionId) return
  state.contextRequest = {
    id: crypto.randomUUID(),
    target: { kind: 'ssh', sessionId: state.sessionId, database: '' },
    source: 'terminal',
    intent: 'explain',
    content,
  }
  machineView.value = 'agent'
  machineOpen.value = true
}
watch(
  () => state.sessionId,
  () => {
    state.contextRequest = null
  }
)
async function toggleSplit(): Promise<void> {
  state.split = !state.split
  await nextTick()
  primary.value?.focus()
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
    if (props.connectionId === id) primary.value?.focus()
  },
  splitFor: async (id: string) => {
    if (props.connectionId === id) await toggleSplit()
  },
  uploadFor: async (id: string) => {
    if (props.connectionId !== id) return
    machineOpen.value = true
    machineView.value = 'files'
    await nextTick()
    await machinePanel.value?.upload()
  },
})
</script>

<template>
  <div class="ssh-workspace">
    <div class="terminal-stack">
      <TerminalPanel
        ref="primary"
        :config="config"
        :title="title"
        :terminal-type="terminalType"
        :startup-command="startupCommand"
        :split="split"
        @split="toggleSplit"
        @status="statusChanged"
        @ask-agent="askAgent"
      >
        <template #metrics>
          <ServerStatusBar
            :session-id="sessionId"
            :active="active"
          />
        </template>
        <template #actions>
          <IconButton
            icon="lucide:bot"
            :size="14"
            :title="t('AI Agent 分屏')"
            :class="machineOpen && machineView === 'agent' && 'text-accent'"
            :aria-pressed="machineOpen && machineView === 'agent'"
            @click="toggleAgent"
          />
        </template>
      </TerminalPanel>
      <Transition name="terminal-split">
        <TerminalPanel
          ref="secondary"
          v-if="split"
          :config="config"
          :title="t('{value0} · 分屏', { value0: title || config.host })"
          :terminal-type="terminalType"
          split
          @split="toggleSplit"
          @ask-agent="askAgent"
        />
      </Transition>
    </div>
    <AppSidePane
      v-if="machineVisited"
      :open="machineOpen"
      :width="machineWidth + (recording ? 0 : 10)"
    >
      <AppResizeHandle
        v-show="!recording"
        v-model="machineWidth"
        pane-side="right"
        :min="MACHINE_MIN_WIDTH"
        :max="machineMaxWidth"
        :label="t('调整机器面板宽度')"
      />
      <MachinePanel
        ref="machinePanel"
        v-model:view="machineView"
        :connection="connection"
        :title="title || config.host"
        :session-id="sessionId"
        :active="active && machineOpen"
        :width="machineWidth"
        :context-request="contextRequest"
        @close="machineOpen = false"
        @context-consumed="state.contextRequest = null"
      />
    </AppSidePane>
  </div>
</template>

<style scoped>
.ssh-workspace {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.terminal-stack {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 8px;
}
.terminal-split-enter-active,
.terminal-split-leave-active {
  transition:
    flex-grow var(--motion-panel),
    opacity var(--motion-panel),
    transform var(--motion-panel);
}
.terminal-split-enter-from,
.terminal-split-leave-to {
  flex-grow: 0 !important;
  opacity: 0;
  transform: translateY(8px);
}
</style>
