<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  reactive,
  shallowRef,
  toRef,
  toRefs,
  watch,
  useTemplateRef,
} from 'vue'
import { useDebounceFn, useEventListener, useStorage } from '@vueuse/core'
import * as database from '@/api/database'
import {
  addQueryHistory,
  clearQueryHistory,
  listQueryHistory,
} from '@/api/database-history'
import AppButton from '@/components/ui/AppButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { TabItem } from '@/components/ui/TabBar.vue'
import IconButton from '@/components/ui/IconButton.vue'
import TabBar from '@/components/ui/TabBar.vue'
import {
  databaseObjectKey,
  useDatabaseSession,
} from '@/composables/useDatabaseSession'
import { useDatabaseTabActions } from '@/composables/useDatabaseTabActions'
import { activeAfterTabClose } from '@/utils/tab-actions'
import { useSavedDatabaseQueries } from '@/composables/useSavedDatabaseQueries'
import { toast } from '@/composables/useToast'
import type { SavedConnection } from '@/types/connection'
import { isDatabaseConnection } from '@/types/connection'
import type { ContextMenuItem } from '@/types/context-menu'
import type {
  DatabaseHistoryEntry,
  DatabaseKind,
  DatabaseObject,
  DatabaseObjectKind,
} from '@/types/database'
import type {
  PersistedDatabaseQueryTab,
  SavedDatabaseQuery,
} from '@/types/database-query'
import type { SshSessionStatus } from '@/types/ssh'
import { copyText } from '@/utils/clipboard'
import { openConnectionWindow } from '@/utils/window'
import DatabaseConnectionState from './database/DatabaseConnectionState.vue'
import DatabaseObjectNameDialog from './database/DatabaseObjectNameDialog.vue'
import DatabaseObjectTree from './database/DatabaseObjectTree.vue'
import DatabaseQueryResults from './database/DatabaseQueryResults.vue'
import DatabaseQueryResizeHandle from './database/DatabaseQueryResizeHandle.vue'
import DatabaseRoutineView from './database/DatabaseRoutineView.vue'
import DatabaseTableDesigner from './database/DatabaseTableDesigner.vue'
import DatabaseTableView from './database/DatabaseTableView.vue'
import SqlEditor from './database/SqlEditor.vue'
import AiAgentPanel from '@/components/agent/AiAgentPanel.vue'
import AppResizeHandle from '@/components/ui/AppResizeHandle.vue'
import { useAgentPaneWidth } from '@/composables/useAgentPaneWidth'

interface QueryTab extends TabItem {
  kind: 'query'
  sql: string
  database: string
  savedQueryId: string | null
}

interface ObjectTab extends TabItem {
  kind: 'object'
  object: DatabaseObject
  panel: 'data' | 'columns'
  panelNonce: number
}

interface TableDesignerTab extends TabItem {
  kind: 'table-designer'
  schema: string
}

type WorkspaceTab = QueryTab | ObjectTab | TableDesignerTab
type NameActionMode =
  | 'create-database'
  | 'rename-database'
  | 'rename-object'
  | 'save-query'
  | 'create-saved-query'
  | 'rename-saved-query'

interface SqlEditorExpose {
  runnableSql: () => string
}

const props = defineProps<{
  connection?: SavedConnection
  active?: boolean
}>()

const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string]
}>()

// AI 布局与查询编辑器独立，审批始终绑定后端会话及活动库。
const agentState = reactive({ agentOpen: false, agentSplit: false })
const { agentOpen, agentSplit } = toRefs(agentState)
const agentContainer = useTemplateRef<HTMLElement>('agentContainer')
const {
  width: agentWidth,
  min: agentMin,
  max: agentMax,
  style: agentStyle,
} = useAgentPaneWidth(agentContainer, 'database')
const agentTarget = computed(() => ({
  kind: 'database' as const,
  sessionId: connected.value ? sessionId.value : '',
  database: session.value?.database ?? '',
}))
function toggleAgentSplit(): void {
  agentState.agentSplit = !(agentState.agentOpen && agentState.agentSplit)
  agentState.agentOpen = true
}
const connection = toRef(props, 'connection')
const password = shallowRef('')
const editor = shallowRef<SqlEditorExpose | null>(null)
const queryEditorRatio = useStorage<number>(
  `miraihub:database-query-split:${props.connection?.id ?? 'default'}`,
  58
)
const querySplitStyle = computed(() => {
  const editorRatio = Math.min(
    85,
    Math.max(
      15,
      Number.isFinite(queryEditorRatio.value) ? queryEditorRatio.value : 58
    )
  )
  return { gridTemplateRows: `${editorRatio}fr 10px ${100 - editorRatio}fr` }
})
const configuredDatabase =
  props.connection && isDatabaseConnection(props.connection)
    ? props.connection.settings.database
    : ''
const {
  queries: savedQueries,
  createQuery: createSavedQuery,
  updateQuery: updateSavedQuery,
  removeQuery: removeSavedQuery,
  loadWorkspace: loadQueryWorkspace,
  saveWorkspace: saveQueryWorkspace,
  persistQueries,
} = useSavedDatabaseQueries(props.connection?.id ?? 'default')
const restoredWorkspace = loadQueryWorkspace()
const savedQueriesById = new Map(
  savedQueries.value.map(query => [query.id, query])
)
const restoredQueryTabs = restoredWorkspace.tabs.map((tab): QueryTab => {
  const saved = tab.savedQueryId
    ? savedQueriesById.get(tab.savedQueryId)
    : undefined
  return {
    id: tab.id,
    label: saved?.name ?? tab.label,
    icon: saved ? 'lucide:file-code-2' : 'lucide:square-terminal',
    closable: true,
    kind: 'query',
    sql: saved?.sql ?? tab.sql,
    database: saved?.database ?? tab.database,
    savedQueryId: saved?.id ?? null,
  }
})
const initialQueryTabs = restoredQueryTabs.length
  ? restoredQueryTabs
  : [
      {
        id: 'query-1',
        label: 'Query 1',
        icon: 'lucide:square-terminal',
        closable: true,
        kind: 'query' as const,
        sql: 'SELECT 1;',
        database: configuredDatabase,
        savedQueryId: null,
      },
    ]
const queryState = reactive({
  tabs: [...initialQueryTabs] as WorkspaceTab[],
  activeId: initialQueryTabs.some(tab => tab.id === restoredWorkspace.activeId)
    ? restoredWorkspace.activeId
    : (initialQueryTabs[0]?.id ?? 'query-1'),
})
const historyEntries = shallowRef<DatabaseHistoryEntry[]>([])
const historyMenu = reactive({ open: false, x: 0, y: 0 })
const nameDialog = reactive({
  open: false,
  mode: 'create-database' as NameActionMode,
  targetDatabase: '',
  targetObject: null as DatabaseObject | null,
  initialValue: '',
  targetSavedQuery: null as SavedDatabaseQuery | null,
  targetQueryTabId: '',
  queryDatabase: '',
  querySql: '',
  loading: false,
})
const deleteDialog = reactive({
  open: false,
  database: '',
  object: null as DatabaseObject | null,
  savedQuery: null as SavedDatabaseQuery | null,
})

const {
  sessionId,
  session,
  status,
  connectionError,
  needsPassword,
  databases,
  databasesLoading,
  objects,
  objectsLoading,
  objectsError,
  columnsByObject,
  inspectingKeys,
  queryExecution,
  queryLoading,
  queryError,
  connected,
  connect,
  disconnect,
  refreshObjects,
  refreshDatabases,
  switchDatabase,
  inspectObject,
  executeSql,
  cancelQuery,
} = useDatabaseSession(connection, {
  onStatus: (nextStatus, nextSessionId) =>
    emit('status', nextStatus, nextSessionId),
})

const databaseKind = computed<DatabaseKind>(() =>
  props.connection && isDatabaseConnection(props.connection)
    ? props.connection.kind
    : 'mysql'
)
const databaseName = computed(() => {
  if (session.value?.database) return session.value.database
  const target = props.connection
  if (!target || !isDatabaseConnection(target)) return '未选择连接'
  return target.settings.database || target.name
})
const databaseOptions = computed(() =>
  databases.value.map(name => ({ value: name, label: name }))
)
const selectedDatabase = computed({
  get: () => session.value?.database ?? '',
  set: (value: string) => void changeDatabase(value),
})

watch(connectionError, error => {
  if (error) toast.error({ title: '数据库连接失败', description: error })
})

watch(objectsError, error => {
  if (error) toast.error({ title: '读取数据库对象失败', description: error })
})
const activeTab = computed(() =>
  queryState.tabs.find(tab => tab.id === queryState.activeId)
)
const activeQuery = computed(() =>
  activeTab.value?.kind === 'query' ? activeTab.value : undefined
)
const activeObject = computed(() =>
  activeTab.value?.kind === 'object' ? activeTab.value : undefined
)
const activeDesigner = computed(() =>
  activeTab.value?.kind === 'table-designer' ? activeTab.value : undefined
)
const selectedSavedQueryId = computed(
  () => activeQuery.value?.savedQueryId ?? ''
)
const relationTabs = computed(() =>
  queryState.tabs.filter(
    (tab): tab is ObjectTab =>
      tab.kind === 'object' &&
      (tab.object.kind === 'table' || tab.object.kind === 'view')
  )
)
const routineTabs = computed(() =>
  queryState.tabs.filter(
    (tab): tab is ObjectTab =>
      tab.kind === 'object' &&
      (tab.object.kind === 'procedure' || tab.object.kind === 'function')
  )
)
const designerTabs = computed(() =>
  queryState.tabs.filter(
    (tab): tab is TableDesignerTab => tab.kind === 'table-designer'
  )
)
const activeSql = computed({
  get: () => activeQuery.value?.sql ?? '',
  set: (value: string) => {
    const tab = activeQuery.value
    if (!tab) return
    tab.sql = value
    if (tab.savedQueryId)
      updateSavedQuery(tab.savedQueryId, { sql: value, database: tab.database })
  },
})
const persistedQueryTabs = computed<PersistedDatabaseQueryTab[]>(() =>
  queryState.tabs.flatMap(tab =>
    tab.kind === 'query'
      ? [
          {
            id: tab.id,
            label: tab.label,
            sql: tab.sql,
            database: tab.database,
            savedQueryId: tab.savedQueryId,
          },
        ]
      : []
  )
)
const lastActiveQueryId = shallowRef(
  activeQuery.value?.id ?? persistedQueryTabs.value[0]?.id ?? ''
)
let workspaceDisposed = false
const persistQueryWorkspace = (): void => {
  if (!workspaceDisposed)
    saveQueryWorkspace({
      activeId: lastActiveQueryId.value,
      tabs: persistedQueryTabs.value,
    })
}
onBeforeUnmount(() => {
  persistQueryWorkspace()
  persistQueries()
  workspaceDisposed = true
})
const persistQueryWorkspaceSoon = useDebounceFn(persistQueryWorkspace, 220, {
  maxWait: 900,
})

watch(activeQuery, tab => {
  if (tab) lastActiveQueryId.value = tab.id
})
watch(
  [persistedQueryTabs, lastActiveQueryId],
  () => void persistQueryWorkspaceSoon(),
  { deep: true, immediate: true }
)
useEventListener(window, 'beforeunload', () => {
  persistQueryWorkspace()
  persistQueries()
})
const canRun = computed(
  () =>
    connected.value && Boolean(activeSql.value.trim()) && !queryLoading.value
)
const sqlSuggestions = computed(() => {
  const values: string[] = []
  for (const object of objects.value) {
    values.push(object.name, `${object.schema}.${object.name}`)
    for (const column of columnsByObject.value[databaseObjectKey(object)] ?? [])
      values.push(column.name)
  }
  return [...new Set(values)]
})
const historyItems = computed<ContextMenuItem[]>(() => {
  const items = historyEntries.value
    .slice(0, 20)
    .map((entry, index): ContextMenuItem => ({
      id: `history:${entry.id}`,
      label: entry.sql.replace(/\s+/gu, ' ').trim().slice(0, 72),
      icon: 'lucide:history',
      shortcut: new Date(entry.executedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      groupLabel: index === 0 ? '最近执行' : undefined,
    }))
  if (!items.length)
    items.push({
      id: 'empty',
      label: '还没有查询历史',
      icon: 'lucide:inbox',
      disabled: true,
    })
  items.push({
    id: 'clear',
    label: '清空当前连接历史',
    icon: 'lucide:trash-2',
    danger: true,
    separatorBefore: true,
    disabled: !historyEntries.value.length,
  })
  return items
})
const nameDialogTitle = computed(() => {
  if (nameDialog.mode === 'create-database') return '新建数据库'
  if (nameDialog.mode === 'rename-database') return '重命名数据库'
  if (nameDialog.mode === 'save-query') return '保存查询'
  if (nameDialog.mode === 'create-saved-query') return '新建已保存查询'
  if (nameDialog.mode === 'rename-saved-query') return '重命名查询'
  return `重命名${nameDialog.targetObject ? objectKindLabel(nameDialog.targetObject.kind) : '对象'}`
})
const nameDialogDescription = computed(() => {
  if (nameDialog.mode === 'create-database')
    return `${props.connection?.name ?? '数据库连接'} · 创建后会自动刷新对象树`
  if (nameDialog.mode === 'rename-database' && databaseKind.value === 'mysql')
    return 'MySQL 不支持原生 RENAME DATABASE；应用会拒绝危险的模拟迁移并给出说明。'
  if (
    nameDialog.mode === 'save-query' ||
    nameDialog.mode === 'create-saved-query'
  )
    return `${nameDialog.queryDatabase} · 保存后会显示在 Queries 中，并自动同步后续修改`
  if (nameDialog.mode === 'rename-saved-query')
    return `${nameDialog.targetSavedQuery?.database ?? nameDialog.queryDatabase} / Queries`
  return (
    nameDialog.targetDatabase ||
    `${nameDialog.targetObject?.schema}.${nameDialog.targetObject?.name}`
  )
})
const nameDialogConfirmLabel = computed(() => {
  if (nameDialog.mode === 'create-database') return '创建数据库'
  if (nameDialog.mode === 'save-query') return '保存查询'
  if (nameDialog.mode === 'create-saved-query') return '创建查询'
  return '保存名称'
})
const deleteTitle = computed(() =>
  deleteDialog.savedQuery
    ? '删除已保存查询？'
    : deleteDialog.object
      ? `删除${objectKindLabel(deleteDialog.object.kind)}？`
      : '删除数据库？'
)
const deleteDescription = computed(() => {
  if (deleteDialog.savedQuery)
    return `将删除查询“${deleteDialog.savedQuery.name}”。已经打开的标签会转为临时草稿，SQL 内容不会丢失。`
  if (deleteDialog.object)
    return `将永久删除 ${qualifiedName(deleteDialog.object)}。此操作无法撤销，请确认已有备份。`
  return `将永久删除数据库“${deleteDialog.database}”及其中的全部对象和数据。当前活动数据库不能删除。`
})

function refreshForConnection(connectionId: string): void {
  if (props.connection?.id === connectionId) void refreshAll()
}

async function newQueryForConnection(
  connectionId: string,
  targetDatabase: string
): Promise<void> {
  if (props.connection?.id !== connectionId) return
  await newQueryForSchema(targetDatabase || undefined)
}

defineExpose({
  refreshForConnection,
  newQueryForConnection,
  reconnectFor: async (id: string) => {
    if (props.connection?.id === id) await connect()
  },
  disconnectFor: async (id: string) => {
    if (props.connection?.id === id) await disconnect()
  },
  closeWarningFor: (ids: string[]) =>
    props.connection &&
    ids.includes(props.connection.id) &&
    designerTabs.value.length
      ? props.connection.name +
        ' 有 ' +
        designerTabs.value.length +
        ' 个建表草稿，关闭连接后将丢失。'
      : '',
})

async function refreshAll(): Promise<void> {
  await Promise.all([refreshDatabases(), refreshObjects()])
}

function addQueryTab(
  sql = '',
  targetDatabase = session.value?.database || configuredDatabase
): QueryTab {
  const index = queryState.tabs.filter(tab => tab.kind === 'query').length + 1
  const id = `query-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tab: QueryTab = {
    id,
    label: `Query ${index}`,
    icon: 'lucide:square-terminal',
    closable: true,
    kind: 'query',
    sql,
    database: targetDatabase,
    savedQueryId: null,
  }
  queryState.tabs.push(tab)
  queryState.activeId = id
  return tab
}

function closeTab(id: string): void {
  closeQueryTabs([id])
}
function closeQueryTabs(ids: string[]): void {
  const closing = new Set(ids)
  const next = activeAfterTabClose(queryState.tabs, queryState.activeId, ids)
  queryState.tabs = queryState.tabs.filter(tab => !closing.has(tab.id))
  queryState.activeId = next
  if (!queryState.tabs.length) addQueryTab()
}
const queryTabActions = useDatabaseTabActions({
  tabs: () => queryState.tabs,
  close: closeQueryTabs,
  hasSavedQuery: id => savedQueries.value.some(query => query.id === id),
  save: id => saveQueryTab(id),
  duplicate: id => {
    const source = queryState.tabs.find(tab => tab.id === id)
    if (source?.kind === 'query') {
      const duplicate = addQueryTab(source.sql, source.database)
      duplicate.label = source.label + ' 副本'
    }
  },
  copy: async id => {
    const tab = queryState.tabs.find(tab => tab.id === id)
    if (tab?.kind !== 'query') return
    try {
      await copyText(tab.sql)
      toast.success('SQL 已复制')
    } catch {
      toast.error('复制失败，请检查剪贴板权限')
    }
  },
})

function reorderTabs(fromIndex: number, toIndex: number): void {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= queryState.tabs.length ||
    toIndex >= queryState.tabs.length
  )
    return
  const [tab] = queryState.tabs.splice(fromIndex, 1)
  if (tab) queryState.tabs.splice(toIndex, 0, tab)
}

function closeObjectTab(object: DatabaseObject): void {
  const id = objectTabId(object)
  if (queryState.tabs.some(tab => tab.id === id)) closeTab(id)
}

function quoteIdentifier(identifier: string): string {
  return databaseKind.value === 'mysql'
    ? `\`${identifier.replaceAll('`', '``')}\``
    : `"${identifier.replaceAll('"', '""')}"`
}

function qualifiedName(
  object: Pick<DatabaseObject, 'schema' | 'name'>
): string {
  return `${quoteIdentifier(object.schema)}.${quoteIdentifier(object.name)}`
}

function objectTabId(object: DatabaseObject): string {
  return `object:${encodeURIComponent(databaseObjectKey(object))}`
}

function objectKindLabel(kind: DatabaseObjectKind): string {
  if (kind === 'table') return '表'
  if (kind === 'view') return '视图'
  if (kind === 'procedure') return '存储过程'
  return '函数'
}

function objectIcon(kind: DatabaseObjectKind): string {
  if (kind === 'table') return 'lucide:table-2'
  if (kind === 'view') return 'lucide:eye'
  if (kind === 'procedure') return 'lucide:workflow'
  return 'lucide:braces'
}

function openQuery(sql: string): void {
  const tab =
    activeQuery.value && !activeQuery.value.savedQueryId
      ? activeQuery.value
      : addQueryTab()
  tab.sql = sql
  queryState.activeId = tab.id
}

function createObjectQuery(object: DatabaseObject): void {
  const name = qualifiedName(object)
  if (object.kind === 'procedure') openQuery(`CALL ${name}(/* 参数 */);`)
  else if (object.kind === 'function') openQuery(`SELECT ${name}(/* 参数 */);`)
  else openQuery(`SELECT *\nFROM ${name}\nLIMIT 100;`)
}

async function newQueryForSchema(schema?: string): Promise<void> {
  if (
    schema &&
    databaseKind.value === 'mysql' &&
    schema !== session.value?.database
  )
    await changeDatabase(schema)
  addQueryTab('', schema || session.value?.database || configuredDatabase)
}

async function openSavedQuery(query: SavedDatabaseQuery): Promise<void> {
  if (
    databaseKind.value === 'mysql' &&
    query.database &&
    query.database !== session.value?.database
  )
    await changeDatabase(query.database)
  const id = `saved:${query.id}`
  const existing = queryState.tabs.find(
    tab => tab.kind === 'query' && tab.savedQueryId === query.id
  )
  if (existing?.kind === 'query') {
    existing.label = query.name
    existing.icon = 'lucide:file-code-2'
    existing.sql = query.sql
    existing.database = query.database
    queryState.activeId = existing.id
    return
  }
  queryState.tabs.push({
    id,
    label: query.name,
    icon: 'lucide:file-code-2',
    closable: true,
    kind: 'query',
    sql: query.sql,
    database: query.database,
    savedQueryId: query.id,
  })
  queryState.activeId = id
}

function saveActiveQuery(): void {
  if (activeQuery.value) saveQueryTab(activeQuery.value.id)
}
function saveQueryTab(id: string): void {
  const tab = queryState.tabs.find(tab => tab.id === id)
  if (tab?.kind !== 'query') return
  if (tab.savedQueryId) {
    updateSavedQuery(tab.savedQueryId, {
      sql: tab.sql,
      database: tab.database || databaseName.value,
    })
    persistQueries()
    toast.success(`查询“${tab.label}”已保存`)
    return
  }
  showQueryNameDialog(
    'save-query',
    tab.database || databaseName.value,
    tab.sql,
    tab
  )
}

function showQueryNameDialog(
  mode: Extract<
    NameActionMode,
    'save-query' | 'create-saved-query' | 'rename-saved-query'
  >,
  targetDatabase: string,
  sql = '',
  target?: QueryTab | SavedDatabaseQuery
): void {
  nameDialog.mode = mode
  nameDialog.targetDatabase = ''
  nameDialog.targetObject = null
  nameDialog.targetQueryTabId =
    target && 'kind' in target && target.kind === 'query' ? target.id : ''
  nameDialog.targetSavedQuery = target && !('kind' in target) ? target : null
  nameDialog.queryDatabase = targetDatabase || databaseName.value
  nameDialog.querySql = sql
  nameDialog.initialValue =
    mode === 'rename-saved-query'
      ? (nameDialog.targetSavedQuery?.name ?? '')
      : mode === 'save-query' &&
          target &&
          'label' in target &&
          !/^Query \d+$/u.test(target.label)
        ? target.label
        : ''
  nameDialog.loading = false
  nameDialog.open = true
}

function duplicateSavedQuery(query: SavedDatabaseQuery): void {
  const duplicate = createSavedQuery(
    query.database,
    `${query.name} 副本`,
    query.sql
  )
  persistQueries()
  void openSavedQuery(duplicate)
}

function createObjectTemplate(schema: string, kind: DatabaseObjectKind): void {
  if (kind === 'table') {
    openTableDesigner(schema)
    return
  }
  const placeholder =
    kind === 'view'
      ? 'new_view'
      : kind === 'procedure'
        ? 'new_procedure'
        : 'new_function'
  const name = `${quoteIdentifier(schema)}.${quoteIdentifier(placeholder)}`
  if (kind === 'view') {
    openQuery(`CREATE VIEW ${name} AS\nSELECT 1 AS example;`)
  } else if (kind === 'procedure' && databaseKind.value === 'mysql') {
    openQuery(`CREATE PROCEDURE ${name}()\nSELECT 1 AS result;`)
  } else if (kind === 'function' && databaseKind.value === 'mysql') {
    openQuery(
      `CREATE FUNCTION ${name}()\nRETURNS INTEGER\nDETERMINISTIC\nRETURN 1;`
    )
  } else if (kind === 'procedure') {
    openQuery(
      `CREATE PROCEDURE ${name}()\nLANGUAGE SQL\nAS $$\n  SELECT 1;\n$$;`
    )
  } else {
    openQuery(
      `CREATE FUNCTION ${name}()\nRETURNS INTEGER\nLANGUAGE SQL\nAS $$\n  SELECT 1;\n$$;`
    )
  }
}

function openTableDesigner(schema: string): void {
  const id = `table-designer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  queryState.tabs.push({
    id,
    label: '新建表',
    icon: 'lucide:table-properties',
    closable: true,
    kind: 'table-designer',
    schema,
  })
  queryState.activeId = id
}

async function handleTableCreated(
  tabId: string,
  schema: string,
  name: string
): Promise<void> {
  closeTab(tabId)
  await refreshObjects()
  const object = objects.value.find(
    candidate =>
      candidate.kind === 'table' &&
      candidate.schema === schema &&
      candidate.name === name
  )
  if (object) openObject(object)
  toast.success(
    object ? `表“${name}”已创建并打开` : `表“${schema}.${name}”已创建`
  )
}

function openObject(
  object: DatabaseObject,
  panel: 'data' | 'columns' = 'data'
): void {
  const resolvedPanel =
    object.kind === 'view' && panel === 'columns' ? 'data' : panel
  const id = objectTabId(object)
  const existing = queryState.tabs.find(tab => tab.id === id)
  if (!existing) {
    queryState.tabs.push({
      id,
      label:
        object.kind === 'table'
          ? object.name
          : `${objectKindLabel(object.kind)}: ${object.name}`,
      icon: objectIcon(object.kind),
      closable: true,
      kind: 'object',
      object,
      panel: resolvedPanel,
      panelNonce: 0,
    })
  } else if (existing.kind === 'object') {
    existing.panel = resolvedPanel
    existing.panelNonce += 1
  }
  queryState.activeId = id
}

async function copyObjectName(object: DatabaseObject): Promise<void> {
  await copyText(qualifiedName(object))
  toast.success('已复制限定名称')
}

function showNameDialog(
  mode: NameActionMode,
  target?: string | DatabaseObject
): void {
  nameDialog.mode = mode
  nameDialog.targetDatabase = typeof target === 'string' ? target : ''
  nameDialog.targetObject = typeof target === 'object' ? target : null
  nameDialog.targetSavedQuery = null
  nameDialog.targetQueryTabId = ''
  nameDialog.queryDatabase = ''
  nameDialog.querySql = ''
  nameDialog.initialValue =
    mode === 'rename-database'
      ? String(target ?? '')
      : mode === 'rename-object' && typeof target === 'object'
        ? target.name
        : ''
  nameDialog.loading = false
  nameDialog.open = true
}

async function submitNameAction(name: string): Promise<void> {
  nameDialog.loading = true
  try {
    let successMessage = '操作已完成'
    if (nameDialog.mode === 'save-query') {
      const tab = queryState.tabs.find(
        candidate =>
          candidate.kind === 'query' &&
          candidate.id === nameDialog.targetQueryTabId
      )
      if (!tab || tab.kind !== 'query')
        throw new Error('要保存的查询标签已关闭')
      const saved = createSavedQuery(nameDialog.queryDatabase, name, tab.sql)
      tab.savedQueryId = saved.id
      tab.label = saved.name
      tab.icon = 'lucide:file-code-2'
      tab.database = saved.database
      persistQueries()
      successMessage = `查询“${saved.name}”已保存`
    } else if (nameDialog.mode === 'create-saved-query') {
      const saved = createSavedQuery(
        nameDialog.queryDatabase,
        name,
        nameDialog.querySql || 'SELECT 1;'
      )
      persistQueries()
      await openSavedQuery(saved)
      successMessage = `查询“${saved.name}”已创建`
    } else if (
      nameDialog.mode === 'rename-saved-query' &&
      nameDialog.targetSavedQuery
    ) {
      const saved = updateSavedQuery(nameDialog.targetSavedQuery.id, { name })
      if (!saved) throw new Error('查询不存在或已被删除')
      for (const tab of queryState.tabs) {
        if (tab.kind === 'query' && tab.savedQueryId === saved.id)
          tab.label = saved.name
      }
      persistQueries()
      successMessage = `查询已重命名为“${saved.name}”`
    } else {
      if (!sessionId.value) throw new Error('数据库尚未连接')
      if (nameDialog.mode === 'create-database') {
        await database.createDatabase(sessionId.value, name)
        successMessage = `数据库“${name}”已创建`
      } else if (nameDialog.mode === 'rename-database') {
        await database.renameDatabase(
          sessionId.value,
          nameDialog.targetDatabase,
          name
        )
        successMessage = `数据库已重命名为“${name}”`
      } else if (nameDialog.targetObject) {
        await database.renameObject(
          sessionId.value,
          nameDialog.targetObject,
          name
        )
        closeObjectTab(nameDialog.targetObject)
        successMessage = `${objectKindLabel(nameDialog.targetObject.kind)}已重命名为“${name}”`
      }
      await refreshAll()
    }
    toast.success(successMessage)
    nameDialog.open = false
  } catch (error) {
    toast.error({
      title: '操作失败',
      description: database.errorMessage(error),
    })
  } finally {
    nameDialog.loading = false
  }
}

function requestDeleteDatabase(name: string): void {
  deleteDialog.database = name
  deleteDialog.object = null
  deleteDialog.savedQuery = null
  deleteDialog.open = true
}

function requestDeleteObject(object: DatabaseObject): void {
  deleteDialog.database = ''
  deleteDialog.object = object
  deleteDialog.savedQuery = null
  deleteDialog.open = true
}

function requestDeleteSavedQuery(query: SavedDatabaseQuery): void {
  deleteDialog.database = ''
  deleteDialog.object = null
  deleteDialog.savedQuery = query
  deleteDialog.open = true
}

async function confirmDelete(): Promise<void> {
  const targetSavedQuery = deleteDialog.savedQuery
  if (targetSavedQuery) {
    removeSavedQuery(targetSavedQuery.id)
    for (const tab of queryState.tabs) {
      if (tab.kind !== 'query' || tab.savedQueryId !== targetSavedQuery.id)
        continue
      tab.savedQueryId = null
      tab.icon = 'lucide:square-terminal'
      tab.label = `${targetSavedQuery.name}（草稿）`
    }
    persistQueries()
    deleteDialog.open = false
    deleteDialog.savedQuery = null
    toast.success(
      `已删除查询“${targetSavedQuery.name}”，打开的内容已保留为草稿`
    )
    return
  }
  if (!sessionId.value) return
  const targetObject = deleteDialog.object
  const targetDatabase = deleteDialog.database
  deleteDialog.open = false
  try {
    let successMessage = ''
    if (targetObject) {
      await database.dropObject(sessionId.value, targetObject)
      closeObjectTab(targetObject)
      successMessage = `${objectKindLabel(targetObject.kind)}“${targetObject.name}”已删除`
    } else {
      await database.dropDatabase(sessionId.value, targetDatabase)
      successMessage = `数据库“${targetDatabase}”已删除`
    }
    await refreshAll()
    toast.success(successMessage)
  } catch (error) {
    toast.error({
      title: '删除失败',
      description: database.errorMessage(error),
    })
  }
}

async function runQuery(sqlOverride?: string): Promise<void> {
  const sql = (
    sqlOverride ??
    editor.value?.runnableSql() ??
    activeSql.value
  ).trim()
  if (!connected.value || !sql || queryLoading.value) return
  const queryDatabase = activeQuery.value?.database
  if (
    databaseKind.value === 'mysql' &&
    queryDatabase &&
    queryDatabase !== session.value?.database
  )
    await changeDatabase(queryDatabase)
  if (props.connection) {
    addQueryHistory({
      connectionId: props.connection.id,
      database: databaseName.value,
      sql,
    })
    historyEntries.value = listQueryHistory(props.connection.id)
  }
  await executeSql(sql)
}

function showHistory(event: MouseEvent): void {
  if (props.connection)
    historyEntries.value = listQueryHistory(props.connection.id)
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  historyMenu.x = rect.right
  historyMenu.y = rect.bottom + 5
  historyMenu.open = true
}

function handleHistoryAction(id: string): void {
  if (id === 'clear') {
    clearQueryHistory(props.connection?.id)
    historyEntries.value = []
    return
  }
  const entry = historyEntries.value.find(
    candidate => `history:${candidate.id}` === id
  )
  if (entry) openQuery(entry.sql)
}

async function changeDatabase(value: string): Promise<void> {
  if (!value || value === session.value?.database) return
  for (const tab of [...queryState.tabs])
    if (tab.kind === 'object' || tab.kind === 'table-designer') closeTab(tab.id)
  await switchDatabase(value)
}

watch(
  () => props.connection?.id,
  id => {
    historyEntries.value = id ? listQueryHistory(id) : []
  }
)
</script>

<template>
  <div
    v-if="!connection"
    class="pane flex-1 items-center justify-center"
  >
    <div class="flex flex-col items-center gap-3 text-center">
      <div
        class="border-line bg-card text-txt-3 grid size-14 place-items-center rounded-2xl border"
      >
        <AppIcon
          name="lucide:database"
          :size="26"
        />
      </div>
      <p class="text-txt-2 text-sm">还没有打开数据库</p>
      <p class="text-txt-4 max-w-70 text-xs">
        从左侧选一个数据库连接，或新建一个
      </p>
      <AppButton
        class="mt-1"
        @click="openConnectionWindow('database')"
        ><AppIcon
          name="lucide:plus"
          :size="13"
        /><span>新建数据库连接</span></AppButton
      >
    </div>
  </div>

  <div
    v-else
    class="pane flex-1 flex-row"
  >
    <DatabaseObjectTree
      v-show="!agentOpen || agentSplit"
      :database-name="databaseName"
      :database-kind="databaseKind"
      :active-database="session?.database ?? ''"
      :database-names="databaseKind === 'mysql' ? databases : []"
      :objects="objects"
      :saved-queries="savedQueries"
      :selected-saved-query-id="selectedSavedQueryId"
      :columns-by-object="columnsByObject"
      :inspecting-keys="inspectingKeys"
      :loading="objectsLoading"
      :error="objectsError"
      @refresh="refreshAll"
      @inspect="inspectObject"
      @open="openObject"
      @query="createObjectQuery"
      @copy="copyObjectName"
      @select-database="changeDatabase"
      @create-database="showNameDialog('create-database')"
      @create-object="createObjectTemplate"
      @new-query="newQueryForSchema"
      @create-saved-query="
        targetDatabase =>
          showQueryNameDialog('create-saved-query', targetDatabase)
      "
      @open-saved-query="openSavedQuery"
      @duplicate-saved-query="duplicateSavedQuery"
      @rename-saved-query="
        query =>
          showQueryNameDialog(
            'rename-saved-query',
            query.database,
            query.sql,
            query
          )
      "
      @remove-saved-query="requestDeleteSavedQuery"
      @rename-database="showNameDialog('rename-database', $event)"
      @remove-database="requestDeleteDatabase"
      @rename-object="showNameDialog('rename-object', $event)"
      @remove-object="requestDeleteObject"
    />

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        class="border-line-soft flex h-9 shrink-0 items-center gap-3 border-b px-3"
      >
        <button
          type="button"
          class="h-full border-b-2 text-[11px]"
          :class="
            !agentOpen
              ? 'border-accent text-txt'
              : 'text-txt-3 border-transparent'
          "
          @click="agentOpen = false"
        >
          Query
        </button>
        <button
          type="button"
          class="flex h-full items-center gap-1.5 border-b-2 text-[11px]"
          :class="
            agentOpen
              ? 'border-accent text-txt'
              : 'text-txt-3 border-transparent'
          "
          @click="agentOpen = true"
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
          title="AI Agent 分屏"
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
          class="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div
            class="border-line-soft flex h-10 shrink-0 items-end border-b px-2"
          >
            <TabBar
              v-model:active="queryState.activeId"
              :tabs="queryState.tabs"
              :context-items="queryTabActions.contextItems"
              addable
              @add="addQueryTab()"
              @close="queryTabActions.requestClose([$event])"
              @close-many="queryTabActions.requestClose"
              @context-action="queryTabActions.action"
              @reorder="reorderTabs"
            />
          </div>

          <div
            class="border-line-soft flex h-9 shrink-0 items-center gap-1.5 border-b px-2.5"
          >
            <IconButton
              v-if="activeQuery"
              :icon="queryLoading ? 'lucide:loader-circle' : 'lucide:play'"
              :size="12"
              :class="[
                'bg-accent-deep hover:bg-accent size-6 text-white hover:text-white',
                queryLoading && '[&_svg]:animate-spin',
              ]"
              title="执行选中内容或全部 SQL（Ctrl+Enter）"
              :disabled="!canRun"
              @click="runQuery()"
            />
            <IconButton
              :icon="connected ? 'lucide:unplug' : 'lucide:plug-zap'"
              :size="13"
              :title="connected ? '断开连接' : '重新连接'"
              :disabled="status === 'connecting'"
              @click="connected ? disconnect() : connect()"
            />
            <IconButton
              v-if="activeQuery"
              icon="lucide:history"
              :size="13"
              title="查询历史"
              @click="showHistory"
            />
            <IconButton
              v-if="activeQuery"
              :icon="
                activeQuery.savedQueryId ? 'lucide:cloud-check' : 'lucide:save'
              "
              :size="13"
              :title="
                activeQuery.savedQueryId
                  ? '立即保存查询（Ctrl+S）'
                  : '保存到 Queries（Ctrl+S）'
              "
              @click="saveActiveQuery"
            />
            <AppButton
              v-if="queryLoading"
              variant="danger"
              size="sm"
              class="h-6"
              title="取消当前查询"
              @click="cancelQuery"
              ><AppIcon
                name="lucide:square"
                :size="10"
              /><span>停止</span></AppButton
            >
            <span
              v-if="activeObject"
              class="text-txt-3 min-w-0 truncate text-[11px]"
              >{{ activeObject.object.schema }}.<span class="text-txt-2">{{
                activeObject.object.name
              }}</span></span
            >
            <span
              v-else-if="activeDesigner"
              class="text-txt-3 min-w-0 truncate text-[11px]"
              >{{ activeDesigner.schema }}.<span class="text-txt-2"
                >新建表</span
              ></span
            >
            <span
              v-else-if="activeQuery?.savedQueryId"
              class="text-cyan flex items-center gap-1 text-[9.5px]"
              ><AppIcon
                name="lucide:cloud-check"
                :size="10"
              />自动保存</span
            >
            <div class="flex-1" />
            <div
              v-if="connected && databaseOptions.length"
              class="w-40"
            >
              <AppSelect
                v-model="selectedDatabase"
                label="活动数据库"
                :options="databaseOptions"
                :disabled="databasesLoading || queryLoading"
                hide-label
                compact
                searchable
              />
            </div>
            <span
              class="text-txt-3 max-w-56 truncate text-[11px]"
              :title="
                session
                  ? `${session.endpoint}\n${session.serverVersion}`
                  : sessionId || connectionError
              "
              >{{
                connected
                  ? `${databaseKind} · ${session?.serverVersion || databaseName}`
                  : status === 'connecting'
                    ? 'Connecting…'
                    : 'Disconnected'
              }}</span
            >
          </div>

          <DatabaseConnectionState
            v-if="!connected"
            v-model:password="password"
            :status="status"
            :needs-password="needsPassword"
            @connect="connect"
          />
          <template v-else>
            <div
              v-show="Boolean(activeQuery)"
              class="query-workspace"
              :style="querySplitStyle"
            >
              <SqlEditor
                ref="editor"
                v-model="activeSql"
                :disabled="queryLoading"
                :suggestions="sqlSuggestions"
                @run="runQuery"
                @save="saveActiveQuery"
              />
              <DatabaseQueryResizeHandle v-model="queryEditorRatio" />
              <DatabaseQueryResults
                :execution="queryExecution"
                :loading="queryLoading"
                :error="queryError"
              />
            </div>
            <DatabaseTableView
              v-for="tab in relationTabs"
              v-show="queryState.activeId === tab.id"
              :key="tab.id"
              :session-id="sessionId"
              :object="tab.object"
              :initial-panel="tab.panel"
              :panel-nonce="tab.panelNonce"
              @query="openQuery"
            />
            <DatabaseRoutineView
              v-for="tab in routineTabs"
              v-show="queryState.activeId === tab.id"
              :key="tab.id"
              :session-id="sessionId"
              :database-kind="databaseKind"
              :object="tab.object"
              @query="openQuery"
            />
            <DatabaseTableDesigner
              v-for="tab in designerTabs"
              v-show="queryState.activeId === tab.id"
              :key="tab.id"
              :session-id="sessionId"
              :database-kind="databaseKind"
              :schema="tab.schema"
              :objects="objects"
              @query="openQuery"
              @created="
                (schema, name) => handleTableCreated(tab.id, schema, name)
              "
            />
          </template>
        </div>
        <AppResizeHandle
          v-if="agentOpen && agentSplit"
          v-model="agentWidth"
          pane-side="right"
          :min="agentMin"
          :max="agentMax"
          label="调整数据库 AI Agent 宽度"
        />
        <AiAgentPanel
          v-show="agentOpen"
          :target="agentTarget"
          :title="databaseName"
          :active="active !== false && agentOpen"
          :split="agentSplit"
          :style="agentSplit ? agentStyle : undefined"
          @split="toggleAgentSplit"
          @close="agentOpen = false"
        />
      </div>
    </div>

    <AppContextMenu
      :open="historyMenu.open"
      :x="historyMenu.x"
      :y="historyMenu.y"
      :items="historyItems"
      label="查询历史"
      @close="historyMenu.open = false"
      @select="handleHistoryAction"
    />
    <DatabaseObjectNameDialog
      :open="nameDialog.open"
      :title="nameDialogTitle"
      :description="nameDialogDescription"
      :initial-value="nameDialog.initialValue"
      :confirm-label="nameDialogConfirmLabel"
      :loading="nameDialog.loading"
      @close="nameDialog.open = false"
      @submit="submitNameAction"
    />
    <AppConfirmDialog
      :open="!!queryTabActions.state.pendingIds.length"
      title="关闭未保存的标签？"
      :description="queryTabActions.description.value"
      confirm-label="放弃草稿并关闭"
      danger
      @close="queryTabActions.cancel"
      @confirm="queryTabActions.confirm"
    />
    <AppConfirmDialog
      :open="deleteDialog.open"
      :title="deleteTitle"
      :description="deleteDescription"
      :confirm-label="deleteDialog.savedQuery ? '删除查询' : '确认删除'"
      danger
      @close="deleteDialog.open = false"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.query-workspace {
  display: grid;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
</style>
