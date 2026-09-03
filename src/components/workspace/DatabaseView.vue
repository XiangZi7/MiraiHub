<script setup lang="ts">
import { computed, reactive, shallowRef, toRef } from 'vue'
import type { TabItem } from '@/components/ui/TabBar.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import TabBar from '@/components/ui/TabBar.vue'
import { useDatabaseSession } from '@/composables/useDatabaseSession'
import type { SavedConnection } from '@/types/connection'
import { isDatabaseConnection } from '@/types/connection'
import type { DatabaseObject } from '@/types/database'
import type { SshSessionStatus } from '@/types/ssh'
import { openConnectionWindow } from '@/utils/window'
import DatabaseConnectionState from './database/DatabaseConnectionState.vue'
import DatabaseObjectTree from './database/DatabaseObjectTree.vue'
import DatabaseQueryResults from './database/DatabaseQueryResults.vue'
import SqlEditor from './database/SqlEditor.vue'

interface QueryTab extends TabItem {
  sql: string
}

const props = defineProps<{
  connection?: SavedConnection
}>()

const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string]
}>()

const connection = toRef(props, 'connection')
const password = shallowRef('')
const queryState = reactive({
  tabs: [{ id: 'query-1', label: 'Query 1', closable: true, sql: 'SELECT 1;' }] as QueryTab[],
  activeId: 'query-1',
})

const {
  sessionId,
  status,
  connectionError,
  needsPassword,
  objects,
  objectsLoading,
  objectsError,
  columnsByObject,
  inspectingKeys,
  queryResult,
  queryLoading,
  queryError,
  connected,
  connect,
  disconnect,
  refreshObjects,
  inspectObject,
  executeSql,
} = useDatabaseSession(connection, {
  onStatus: (nextStatus, nextSessionId) => emit('status', nextStatus, nextSessionId),
})

const databaseName = computed(() => {
  const target = props.connection
  if (!target || !isDatabaseConnection(target))
    return '未选择连接'
  return target.settings.database || target.name
})

const activeQuery = computed(() => queryState.tabs.find(tab => tab.id === queryState.activeId))
const activeSql = computed({
  get: () => activeQuery.value?.sql ?? '',
  set: (value: string) => {
    if (activeQuery.value)
      activeQuery.value.sql = value
  },
})
const canRun = computed(() => connected.value && Boolean(activeSql.value.trim()) && !queryLoading.value)

function addQueryTab(): void {
  const index = queryState.tabs.length + 1
  const id = `query-${Date.now()}`
  queryState.tabs.push({ id, label: `Query ${index}`, closable: true, sql: '' })
  queryState.activeId = id
}

function closeQueryTab(id: string): void {
  const index = queryState.tabs.findIndex(tab => tab.id === id)
  if (index === -1)
    return

  queryState.tabs.splice(index, 1)
  if (!queryState.tabs.length) {
    addQueryTab()
    return
  }
  if (queryState.activeId === id)
    queryState.activeId = (queryState.tabs[index] ?? queryState.tabs[index - 1]).id
}

function quoteIdentifier(identifier: string): string {
  return props.connection?.kind === 'mysql'
    ? `\`${identifier.replaceAll('`', '``')}\``
    : `"${identifier.replaceAll('"', '""')}"`
}

/** 双击对象时生成一条安全引用 schema/table 的查询，不直接执行。 */
function openObject(object: DatabaseObject): void {
  if (!activeQuery.value)
    addQueryTab()
  activeSql.value = `SELECT *\nFROM ${quoteIdentifier(object.schema)}.${quoteIdentifier(object.name)}\nLIMIT 100;`
}

function runQuery(): void {
  if (canRun.value)
    void executeSql(activeSql.value)
}
</script>

<template>
  <div v-if="!connection" class="pane flex-1 items-center justify-center">
    <div class="flex flex-col items-center gap-3 text-center">
      <div class="grid size-14 place-items-center rounded-2xl border border-line bg-card text-txt-3">
        <AppIcon name="lucide:database" :size="26" />
      </div>
      <p class="text-sm text-txt-2">还没有打开数据库</p>
      <p class="max-w-70 text-xs text-txt-4">从左侧选一个数据库连接，或新建一个</p>
      <button type="button" class="btn mt-1" @click="openConnectionWindow('database')">
        <AppIcon name="lucide:plus" :size="13" />
        <span>新建数据库连接</span>
      </button>
    </div>
  </div>

  <div v-else class="pane flex-1 flex-row">
    <DatabaseObjectTree
      :database-name="databaseName"
      :objects="objects"
      :columns-by-object="columnsByObject"
      :inspecting-keys="inspectingKeys"
      :loading="objectsLoading"
      :error="objectsError"
      @refresh="refreshObjects"
      @inspect="inspectObject"
      @open="openObject"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-10 shrink-0 items-end border-b border-line-soft px-2">
        <TabBar
          v-model:active="queryState.activeId"
          :tabs="queryState.tabs"
          addable
          @add="addQueryTab"
          @close="closeQueryTab"
        />
      </div>

      <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-line-soft px-2.5">
        <button
          type="button"
          class="grid size-6 place-items-center rounded bg-accent-deep text-black transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
          title="执行（Ctrl+Enter）"
          :disabled="!canRun"
          @click="runQuery"
        >
          <AppIcon :name="queryLoading ? 'lucide:loader-circle' : 'lucide:play'" :size="12" :class="queryLoading && 'animate-spin'" />
        </button>
        <IconButton
          :icon="connected ? 'lucide:unplug' : 'lucide:plug-zap'"
          :size="13"
          :title="connected ? '断开连接' : '重新连接'"
          :disabled="status === 'connecting'"
          @click="connected ? disconnect() : connect()"
        />

        <div class="flex-1" />
        <span class="max-w-48 truncate text-[11px] text-txt-3" :title="sessionId || connectionError">
          {{ connected ? `${connection.kind} · ${databaseName}` : status === 'connecting' ? 'Connecting…' : 'Disconnected' }}
        </span>
      </div>

      <DatabaseConnectionState
        v-if="!connected"
        v-model:password="password"
        :status="status"
        :error="connectionError"
        :needs-password="needsPassword"
        @connect="connect"
      />

      <template v-else>
        <SqlEditor v-model="activeSql" :disabled="queryLoading" @run="runQuery" />
        <DatabaseQueryResults :result="queryResult" :loading="queryLoading" :error="queryError" />
      </template>
    </div>
  </div>
</template>
