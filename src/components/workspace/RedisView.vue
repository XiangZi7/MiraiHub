<script setup lang="ts">
import { computed, reactive, toRef, toRefs, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppResizeHandle from '@/components/ui/AppResizeHandle.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import TabBar from '@/components/ui/TabBar.vue'
import AiAgentPanel from '@/components/agent/AiAgentPanel.vue'
import DatabaseConnectionState from './database/DatabaseConnectionState.vue'
import RedisKeyBrowser from './redis/RedisKeyBrowser.vue'
import RedisKeyDetail from './redis/RedisKeyDetail.vue'
import RedisConsole from './redis/RedisConsole.vue'
import { useRedisSession } from '@/composables/useRedisSession'
import { useDatabaseSidebarWidth } from '@/composables/useDatabaseSidebarWidth'
import { useAgentPaneWidth } from '@/composables/useAgentPaneWidth'
import type { AgentTarget } from '@/types/agent'
import type { SavedConnection } from '@/types/connection'
import type { SshSessionStatus } from '@/types/ssh'
const props = defineProps<{ connection: SavedConnection; active?: boolean }>()
const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string]
}>()
const { t } = useI18n()
const {
  session,
  status,
  error,
  needsPassword,
  busy,
  keys,
  cursor,
  detail,
  result,
  connected,
  connect,
  disconnect,
  scan,
  inspect,
  switchDatabase,
  execute,
  saveString,
  deleteKey,
  expireKey,
} = useRedisSession(toRef(props, 'connection'), (status, id) =>
  emit('status', status, id)
)
// 响应式状态
const state = reactive({
  // 认证与数据库切换草稿
  password: '',
  database: '0',
  // 工作区标签与命令草稿；切换标签保留未保存内容
  activeTab: 'keys',
  tabOrder: ['keys', 'command'],
  command: '',
  dirty: false,
  // AI 可以独占工作区或在右侧分屏
  agentOpen: false,
  agentSplit: false,
  // 放弃修改后继续的动作
  pendingAction: null as (() => void) | null,
})
const {
  password,
  database,
  command,
  dirty,
  activeTab,
  agentOpen,
  agentSplit,
  pendingAction,
} = toRefs(state)
const container = useTemplateRef<HTMLElement>('container')
const agentContainer = useTemplateRef<HTMLElement>('agentContainer')
const {
  width: sidebarWidth,
  min: sidebarMin,
  max: sidebarMax,
  style: sidebarStyle,
} = useDatabaseSidebarWidth(container)
const {
  width: agentWidth,
  min: agentMin,
  max: agentMax,
  style: agentStyle,
} = useAgentPaneWidth(agentContainer, 'database')
const agentTarget = computed<AgentTarget>(() => ({
  kind: 'redis',
  sessionId: connected.value ? (session.value?.sessionId ?? '') : '',
  database: session.value?.database ?? '',
}))
const tabItems = computed(() => [
  {
    id: 'keys',
    label: (detail.value?.key.name || t('键值')) + (state.dirty ? ' •' : ''),
    icon: 'lucide:key-round',
  },
  { id: 'command', label: t('Redis 命令'), icon: 'lucide:square-terminal' },
])
const tabs = computed(() =>
  state.tabOrder.flatMap(id => tabItems.value.filter(tab => tab.id === id))
)
function reorderTabs(from: number, to: number) {
  if (
    from < 0 ||
    to < 0 ||
    from >= state.tabOrder.length ||
    to >= state.tabOrder.length
  )
    return
  const [tab] = state.tabOrder.splice(from, 1)
  if (tab) state.tabOrder.splice(to, 0, tab)
}
watch(
  () => session.value?.database,
  value => {
    state.database = value ?? '0'
  }
)
watch(detail, () => {
  state.dirty = false
})
function guard(action: () => void) {
  if (busy.value) return
  if (state.dirty) state.pendingAction = action
  else action()
}
function discardAndContinue() {
  const action = state.pendingAction
  state.pendingAction = null
  action?.()
}
function openCommand() {
  state.activeTab = 'command'
  state.agentOpen = state.agentOpen && state.agentSplit
}
function toggleAgentSplit() {
  state.agentSplit = !state.agentOpen || !state.agentSplit
  state.agentOpen = true
}
function openAgent() {
  state.agentOpen = true
  state.agentSplit = false
}
function runCommand() {
  if (connected.value && state.command.trim())
    guard(() => execute(state.command))
}
defineExpose({
  closeWarningFor: (ids: readonly string[]) =>
    ids.includes(props.connection.id) && state.dirty
      ? t('Redis 值有未保存的修改')
      : '',
  refreshForConnection: (id: string) => {
    if (id === props.connection.id) void scan(true)
  },
  newQueryForConnection: async (id: string, _database?: string) => {
    if (id === props.connection.id) openCommand()
  },
  reconnectFor: async (id: string) => {
    if (id === props.connection.id) await connect()
  },
  disconnectFor: async (id: string) => {
    if (id === props.connection.id) await disconnect()
  },
})
</script>

<template>
  <div
    ref="container"
    class="pane flex-1 flex-row"
  >
    <RedisKeyBrowser
      v-show="!agentOpen || agentSplit"
      :style="sidebarStyle"
      :name="connection.name"
      :database="session?.database ?? '0'"
      :connected="connected"
      :keys="keys"
      :busy="busy"
      :has-more="cursor !== '0'"
      :selected="detail?.key.id"
      @search="scan(true, $event)"
      @more="scan()"
      @refresh="scan(true)"
      @command="openCommand"
      @select="
        key =>
          guard(() => {
            activeTab = 'keys'
            void inspect(key)
          })
      "
    />
    <AppResizeHandle
      v-show="!agentOpen || agentSplit"
      v-model="sidebarWidth"
      pane-side="left"
      :min="sidebarMin"
      :max="sidebarMax"
      :label="t('调整数据库侧栏宽度')"
      overlay
    />
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        class="border-line-soft flex h-9 shrink-0 items-center gap-3 border-b px-3"
      >
        <button
          type="button"
          class="h-full border-b-2 text-[11px]"
          :class="
            !agentOpen || agentSplit
              ? 'border-accent text-txt'
              : 'text-txt-3 border-transparent'
          "
          @click="agentOpen = false"
        >
          {{ t('Query') }}
        </button>
        <button
          type="button"
          class="flex h-full items-center gap-1.5 border-b-2 text-[11px]"
          :class="
            agentOpen
              ? 'border-accent text-txt'
              : 'text-txt-3 border-transparent'
          "
          @click="openAgent"
        >
          <AppIcon
            name="lucide:bot"
            :size="13"
          />AI Agent
          <span class="rounded bg-blue-400/10 px-1 text-[8px] text-blue-300"
            >BETA</span
          >
        </button>
        <div class="flex-1" />
        <IconButton
          icon="lucide:columns-2"
          :size="14"
          :title="t('AI Agent 分屏')"
          :aria-label="t('AI Agent 分屏')"
          :class="agentOpen && agentSplit && 'text-accent'"
          @click="toggleAgentSplit"
        />
      </div>
      <div
        ref="agentContainer"
        class="flex min-h-0 min-w-0 flex-1"
      >
        <div
          v-show="!agentOpen || agentSplit"
          class="redis-workspace flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div
            class="border-line-soft flex h-10 min-w-0 shrink-0 items-center gap-1.5 border-b px-2"
          >
            <TabBar
              v-model:active="activeTab"
              :tabs="tabs"
              class="min-w-0 flex-1"
              @reorder="reorderTabs"
            />
            <div
              class="flex shrink-0 items-center gap-1"
              role="group"
              :aria-label="t('数据库工具栏')"
            >
              <IconButton
                v-if="activeTab === 'command'"
                :icon="busy ? 'lucide:loader-circle' : 'lucide:play'"
                :size="12"
                :class="[
                  'bg-accent-deep hover:bg-accent size-6 text-white hover:text-white',
                  busy && '[&_svg]:animate-spin',
                ]"
                :title="t('执行 Redis 命令（Ctrl+Enter）')"
                :aria-label="t('执行 Redis 命令（Ctrl+Enter）')"
                :disabled="!connected || busy || !command.trim()"
                @click="runCommand"
              />
              <IconButton
                :icon="connected ? 'lucide:unplug' : 'lucide:plug-zap'"
                :size="13"
                :title="connected ? t('断开连接') : t('重新连接')"
                :disabled="status === 'connecting' || busy"
                @click="guard(() => (connected ? disconnect() : connect()))"
              />
              <form
                class="redis-database-selector field h-6 w-24 gap-1 rounded-md px-1.5"
                @submit.prevent="
                  connected &&
                  /^\d+$/.test(database) &&
                  guard(() => switchDatabase(database))
                "
              >
                <span class="text-txt-3 text-[10px]">DB</span>
                <input
                  v-model="database"
                  :aria-label="t('Redis 数据库索引')"
                  inputmode="numeric"
                  class="min-w-0"
                  :disabled="!connected || busy"
                />
                <IconButton
                  icon="lucide:corner-down-left"
                  :size="11"
                  class="size-5"
                  :title="t('切换')"
                  :aria-label="t('切换')"
                  :disabled="!connected || busy || !/^\d+$/.test(database)"
                  @click="guard(() => switchDatabase(database))"
                />
              </form>
              <span
                class="redis-connection-info text-txt-4 px-1 font-mono text-[10px]"
                >Redis</span
              >
            </div>
          </div>
          <p
            v-if="error"
            role="alert"
            class="text-danger bg-card shrink-0 px-3 py-2 text-xs break-words"
          >
            {{ error }}
          </p>
          <DatabaseConnectionState
            v-if="!connected"
            v-model:password="password"
            :status="status"
            :needs-password="needsPassword"
            @connect="connect"
          />
          <template v-else>
            <RedisKeyDetail
              v-show="activeTab === 'keys'"
              :detail="detail"
              :busy="busy"
              @dirty="dirty = $event"
              @save="saveString"
              @remove="deleteKey"
              @expire="expireKey"
              @command="openCommand"
              @refresh="detail && inspect(detail.key)"
            />
            <RedisConsole
              v-show="activeTab === 'command'"
              v-model="command"
              :busy="busy"
              :result="result"
              @execute="runCommand"
            />
          </template>
          <footer
            class="border-line-soft text-txt-4 flex h-6 shrink-0 items-center gap-2 border-t px-3 text-[10px]"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="connected ? 'bg-success' : 'bg-txt-4'"
            />
            <span class="truncate">{{
              session?.endpoint || connection.name
            }}</span>
            <span class="ml-auto shrink-0"
              >Redis · DB {{ session?.database ?? '0' }}</span
            >
          </footer>
        </div>
        <AppResizeHandle
          v-if="agentOpen && agentSplit"
          v-model="agentWidth"
          pane-side="right"
          :min="agentMin"
          :max="agentMax"
          :label="t('调整 AI 面板宽度')"
        />
        <AiAgentPanel
          v-show="agentOpen"
          :target="agentTarget"
          :title="connection.name + ' / DB ' + (session?.database ?? '0')"
          :active="active !== false && agentOpen"
          :split="agentSplit"
          :style="agentSplit ? agentStyle : undefined"
          @split="toggleAgentSplit"
          @close="agentOpen = false"
        />
      </div>
    </div>
    <AppConfirmDialog
      :open="!!pendingAction"
      :title="t('放弃未保存的修改？')"
      :description="t('Redis 值有未保存的修改')"
      :confirm-label="t('放弃修改')"
      @close="pendingAction = null"
      @confirm="discardAndContinue"
    />
  </div>
</template>

<style scoped>
.redis-workspace {
  container-type: inline-size;
}
@container (max-width: 420px) {
  .redis-connection-info {
    display: none;
  }
  .redis-database-selector {
    width: 78px;
  }
}
</style>
