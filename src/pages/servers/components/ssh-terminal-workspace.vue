<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  nextTick,
  onScopeDispose,
  reactive,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import type { SshConfig, SshSessionStatus } from '@/types/ssh'
import type { SavedConnection } from '@/types/connection'
import type { AgentContextRequest } from '@/types/agent'
import { useWorkspaceLayoutStore } from '@/stores/workspace-layout'
import { useMachinePaneWidth } from '@/composables/useMachinePaneWidth'
import { useSplitPanes, type SplitDirection } from '@/composables/useSplitPanes'
import { useSplitDropZone } from '@/composables/useSplitDropZone'
import { onAgentContextRequest } from '@/composables/useAgentContextBus'
import {
  onTerminalTargetRequest,
  sshPaste,
} from '@/composables/useTerminalInsert'
import TerminalPanel from '@/components/workspace/TerminalPanel.vue'
import MachinePanel from '@/components/workspace/MachinePanel.vue'
import ServerStatusBar from '@/components/workspace/ServerStatusBar.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppResizeHandle from '@/components/ui/AppResizeHandle.vue'
import AppSidePane from '@/components/ui/AppSidePane.vue'
import SplitPaneGroup from '@/components/ui/SplitPaneGroup.vue'
import SplitDropIndicator from '@/components/ui/SplitDropIndicator.vue'

/**
 * 主面板的固定 id。
 *
 * Agent、服务器指标和对外上报的会话状态都绑在它身上，所以它既不换 id
 * 也不能被关掉 —— 否则这些消费方会突然失去会话。分屏出来的都是副面板。
 */
const ROOT_PANE_ID = 'primary'

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
const layout = useWorkspaceLayoutStore()
const machineKey = props.connectionId || crypto.randomUUID()
const {
  width: preferredMachineWidth,
  open: machineOpen,
  view: machineView,
} = toRefs(layout.machinePaneFor(machineKey))
const workspaceContainer = useTemplateRef<HTMLElement>('workspaceContainer')
const {
  width: machineWidth,
  min: machineMinWidth,
  max: machineMaxWidth,
} = useMachinePaneWidth(workspaceContainer, preferredMachineWidth)
onScopeDispose(() => layout.removeMachinePane(machineKey))
// 响应式状态
const state = reactive({
  // 主终端会话，Agent 和服务器指标始终绑定这个会话
  sessionId: '',
  // 侧面板首次访问后保留挂载，收起时不丢失 Agent 草稿
  machineVisited: false,
  // 从终端显式选择、待加入 AI 草稿的上下文
  contextRequest: null as AgentContextRequest | null,
  // 是否把任一分屏的输入广播到同工作区的其他分屏
  broadcast: false,
})
const { sessionId, machineVisited, contextRequest, broadcast } = toRefs(state)

const {
  panes,
  ratios,
  orientation,
  tiled,
  canTile,
  activeId: activePaneId,
  split,
  add: addPane,
  remove: removePane,
  resize: resizePane,
  focus: focusPane,
  toggleOrientation,
  toggleTiled,
  distributeEvenly,
} = useSplitPanes({ rootId: ROOT_PANE_ID })

type TerminalPanelInstance = InstanceType<typeof TerminalPanel>
// 面板实例按 pane id 存取。只用于命令式调用（聚焦 / 重连），无需响应式
const panels = new Map<string, TerminalPanelInstance>()
// 各分屏当前已连接的会话 id，主面板未连接时副面板可借此调用 AI
const paneSessions = new Map<string, string>()
// 记录面板实例，供聚焦、重连与广播输入使用
function setPanelRef(id: string, el: unknown): void {
  if (el) panels.set(id, el as TerminalPanelInstance)
  else panels.delete(id)
}

const stack = useTemplateRef<HTMLElement>('stack')
const machinePanel =
  useTemplateRef<InstanceType<typeof MachinePanel>>('machinePanel')

watch(
  () => props.active && machineOpen.value,
  open => {
    if (open) state.machineVisited = true
  },
  { immediate: true }
)

/** 副面板只是额外的 SSH 会话，不参与对外的状态上报 */
function statusChanged(
  paneId: string,
  status: SshSessionStatus,
  session: string
): void {
  if (status === 'connected') paneSessions.set(paneId, session)
  else paneSessions.delete(paneId)
  if (paneId !== ROOT_PANE_ID) return

  state.sessionId = status === 'connected' ? session : ''
  emit('status', status, session)
}
function toggleFiles(): void {
  if (machineOpen.value && machineView.value === 'files')
    machineOpen.value = false
  else {
    machineView.value = 'files'
    machineOpen.value = true
  }
}
function toggleAgent(): void {
  if (machineOpen.value && machineView.value === 'agent')
    machineOpen.value = false
  else {
    machineView.value = 'agent'
    machineOpen.value = true
  }
}
// 把终端内容交给 AI 面板；主会话优先，未连接时退回发起请求的分屏会话
function askAgent(
  paneId: string,
  content: string,
  intent: 'explain' | 'fix' = 'explain'
): void {
  const session = state.sessionId || paneSessions.get(paneId)
  if (!session) return
  state.contextRequest = {
    id: crypto.randomUUID(),
    target: { kind: 'ssh', sessionId: session, database: '' },
    source: 'terminal',
    intent,
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
// 接收监控栏、批量执行结果等跨层入口投递的上下文：会话匹配或未指定会话时由活动工作区接收
onAgentContextRequest(ask => {
  const session = ask.sessionId
    ? [state.sessionId, ...paneSessions.values()].find(
        id => id === ask.sessionId
      )
    : props.active
      ? state.sessionId || paneSessions.values().next().value
      : undefined
  if (!session) return false
  state.contextRequest = {
    id: crypto.randomUUID(),
    target: { kind: 'ssh', sessionId: session, database: '' },
    source: 'terminal',
    intent: ask.intent,
    name: ask.name,
    content: ask.content,
  }
  machineView.value = 'agent'
  machineOpen.value = true
  return true
})
// 命令面板插入片段时提供当前聚焦分屏的会话；聚焦的分屏未连接时退回任一已连接分屏
onTerminalTargetRequest(tabId => {
  if (tabId !== props.connectionId || !props.active) return undefined
  const paneId = paneSessions.has(activePaneId.value)
    ? activePaneId.value
    : paneSessions.keys().next().value
  const session = paneId ? paneSessions.get(paneId) : undefined
  if (!paneId || !session) return undefined
  return { paste: sshPaste(session), focus: () => panels.get(paneId)?.focus() }
})

// 广播输入：把某个分屏的输入写到其他所有分屏的会话
function broadcastInput(fromId: string, data: string): void {
  if (!state.broadcast || !split.value) return
  for (const [id, panel] of panels) if (id !== fromId) panel.write(data)
}
// 退出分屏后自动关闭广播，避免下次分屏时意外广播
watch(split, value => {
  if (!value) state.broadcast = false
})

/** 新开一块分屏，并把焦点交给它 */
async function openPane(direction: SplitDirection = 'down'): Promise<void> {
  const id = addPane(direction)
  await nextTick()
  panels.get(id)?.focus()
}

async function closePane(id: string): Promise<void> {
  if (id === ROOT_PANE_ID) return

  removePane(id)
  await nextTick()
  panels.get(activePaneId.value)?.focus()
}

const {
  direction: dropDirection,
  start: startSplitDrag,
  consumeSuppressedClick,
} = useSplitDropZone({
  container: () => stack.value,
  onDrop: direction => void openPane(direction),
})

/** 分屏按钮的点击分支。拖拽结束后浏览器补的那次 click 要忽略掉 */
function splitClicked(): void {
  if (consumeSuppressedClick()) return
  void openPane('down')
}

function paneTitle(id: string, index: number): string {
  const base = props.title || props.config.host
  if (id === ROOT_PANE_ID) return props.title ?? base

  return t('{value0} · 分屏 {value1}', { value0: base, value1: index + 1 })
}

defineExpose({
  reconnectFor: async (id: string) => {
    if (props.connectionId !== id) return
    for (const panel of panels.values()) await panel.reconnect()
  },
  disconnectFor: async (id: string) => {
    if (props.connectionId !== id) return
    for (const panel of panels.values()) await panel.disconnect()
  },
  focusFor: (id: string) => {
    if (props.connectionId !== id) return
    ;(panels.get(activePaneId.value) ?? panels.get(ROOT_PANE_ID))?.focus()
  },
  splitFor: async (id: string) => {
    if (props.connectionId === id) await openPane('down')
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
  <div
    ref="workspaceContainer"
    :data-ssh-workspace="machineKey"
    class="flex min-h-0 min-w-0 flex-1"
  >
    <!-- 投放提示绝对定位在这一层，所以它得是分屏组的定位父级 -->
    <div
      ref="stack"
      class="relative flex min-h-0 min-w-0 flex-1"
    >
      <SplitPaneGroup
        :panes="panes"
        :ratios="ratios"
        :orientation="orientation"
        :active-id="activePaneId"
        :grid="tiled"
        @resize="resizePane"
        @reset="distributeEvenly"
      >
        <template #pane="{ pane, index }">
          <TerminalPanel
            :ref="el => setPanelRef(pane.id, el)"
            :config="config"
            :title="paneTitle(pane.id, index)"
            :terminal-type="terminalType"
            :startup-command="
              pane.id === ROOT_PANE_ID ? startupCommand : undefined
            "
            :split="split"
            :broadcast="broadcast && split"
            :closable="pane.id !== ROOT_PANE_ID"
            @pointerdown.capture="focusPane(pane.id)"
            @split="splitClicked"
            @split-pointer-down="startSplitDrag"
            @close="closePane(pane.id)"
            @status="
              (status, session) => statusChanged(pane.id, status, session)
            "
            @ask-agent="(content, intent) => askAgent(pane.id, content, intent)"
            @input="broadcastInput(pane.id, $event)"
          >
            <template
              v-if="pane.id === ROOT_PANE_ID"
              #metrics
            >
              <ServerStatusBar
                :session-id="sessionId"
                :active="active"
              />
            </template>
            <template
              v-if="pane.id === ROOT_PANE_ID"
              #actions
            >
              <!-- 平铺时各格等分，横竖排切换看不出效果，先收起 -->
              <IconButton
                v-if="split && !tiled"
                :icon="
                  orientation === 'vertical'
                    ? 'lucide:columns-2'
                    : 'lucide:rows-2'
                "
                :size="14"
                :title="
                  orientation === 'vertical'
                    ? t('改为左右分屏')
                    : t('改为上下分屏')
                "
                @click="toggleOrientation"
              />
              <IconButton
                v-if="canTile"
                :icon="tiled ? 'lucide:columns-2' : 'lucide:layout-grid'"
                :size="14"
                :title="tiled ? t('恢复分栏排列') : t('平铺所有分屏')"
                @click="toggleTiled"
              />
              <IconButton
                v-if="split"
                icon="lucide:radio-tower"
                :size="14"
                :title="t('广播输入到所有分屏')"
                :class="broadcast && 'text-accent'"
                :aria-pressed="broadcast"
                @click="broadcast = !broadcast"
              />
              <IconButton
                icon="lucide:folder-open"
                :size="14"
                :title="t('远端文件')"
                :class="machineOpen && machineView === 'files' && 'text-accent'"
                :aria-pressed="machineOpen && machineView === 'files'"
                @click="toggleFiles"
              />
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
        </template>
      </SplitPaneGroup>
      <SplitDropIndicator
        v-if="dropDirection"
        :direction="dropDirection"
        :grid="tiled"
      />
    </div>
    <AppSidePane
      v-if="machineVisited"
      :open="machineOpen"
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
