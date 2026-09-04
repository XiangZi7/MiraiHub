<script setup lang="ts">
import { computed, reactive, shallowRef, toRef, watch } from "vue";
import * as database from "@/api/database";
import { addQueryHistory, clearQueryHistory, listQueryHistory } from "@/api/database-history";
import AppConfirmDialog from "@/components/ui/AppConfirmDialog.vue";
import AppContextMenu from "@/components/ui/AppContextMenu.vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import AppSelect from "@/components/ui/AppSelect.vue";
import type { TabItem } from "@/components/ui/TabBar.vue";
import IconButton from "@/components/ui/IconButton.vue";
import TabBar from "@/components/ui/TabBar.vue";
import { databaseObjectKey, useDatabaseSession } from "@/composables/useDatabaseSession";
import type { SavedConnection } from "@/types/connection";
import { isDatabaseConnection } from "@/types/connection";
import type { ContextMenuItem } from "@/types/context-menu";
import type {
  DatabaseHistoryEntry,
  DatabaseKind,
  DatabaseObject,
  DatabaseObjectKind,
} from "@/types/database";
import type { SshSessionStatus } from "@/types/ssh";
import { openConnectionWindow } from "@/utils/window";
import DatabaseConnectionState from "./database/DatabaseConnectionState.vue";
import DatabaseObjectNameDialog from "./database/DatabaseObjectNameDialog.vue";
import DatabaseObjectTree from "./database/DatabaseObjectTree.vue";
import DatabaseQueryResults from "./database/DatabaseQueryResults.vue";
import DatabaseRoutineView from "./database/DatabaseRoutineView.vue";
import DatabaseTableView from "./database/DatabaseTableView.vue";
import SqlEditor from "./database/SqlEditor.vue";

interface QueryTab extends TabItem {
  kind: "query";
  sql: string;
}

interface ObjectTab extends TabItem {
  kind: "object";
  object: DatabaseObject;
  panel: "data" | "columns";
  panelNonce: number;
}

type WorkspaceTab = QueryTab | ObjectTab;
type NameActionMode = "create-database" | "rename-database" | "rename-object";

interface SqlEditorExpose {
  runnableSql: () => string;
}

const props = defineProps<{
  connection?: SavedConnection;
}>();

const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string];
}>();

const connection = toRef(props, "connection");
const password = shallowRef("");
const editor = shallowRef<SqlEditorExpose | null>(null);
const queryState = reactive({
  tabs: [{ id: "query-1", label: "Query 1", icon: "lucide:square-terminal", closable: true, kind: "query", sql: "SELECT 1;" }] as WorkspaceTab[],
  activeId: "query-1",
});
const historyEntries = shallowRef<DatabaseHistoryEntry[]>([]);
const historyMenu = reactive({ open: false, x: 0, y: 0 });
const actionState = reactive({ message: "", error: "" });
const nameDialog = reactive({
  open: false,
  mode: "create-database" as NameActionMode,
  targetDatabase: "",
  targetObject: null as DatabaseObject | null,
  initialValue: "",
  loading: false,
  error: "",
});
const deleteDialog = reactive({
  open: false,
  database: "",
  object: null as DatabaseObject | null,
});

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
  onStatus: (nextStatus, nextSessionId) => emit("status", nextStatus, nextSessionId),
});

const databaseKind = computed<DatabaseKind>(() =>
  props.connection && isDatabaseConnection(props.connection) ? props.connection.kind : "mysql",
);
const databaseName = computed(() => {
  if (session.value?.database) return session.value.database;
  const target = props.connection;
  if (!target || !isDatabaseConnection(target)) return "未选择连接";
  return target.settings.database || target.name;
});
const databaseOptions = computed(() => databases.value.map((name) => ({ value: name, label: name })));
const selectedDatabase = computed({
  get: () => session.value?.database ?? "",
  set: (value: string) => void changeDatabase(value),
});
const activeTab = computed(() => queryState.tabs.find((tab) => tab.id === queryState.activeId));
const activeQuery = computed(() => activeTab.value?.kind === "query" ? activeTab.value : undefined);
const activeObject = computed(() => activeTab.value?.kind === "object" ? activeTab.value : undefined);
const activeRelation = computed(() => {
  const tab = activeObject.value;
  return tab && (tab.object.kind === "table" || tab.object.kind === "view") ? tab : undefined;
});
const activeRoutine = computed(() => {
  const tab = activeObject.value;
  return tab && (tab.object.kind === "procedure" || tab.object.kind === "function") ? tab : undefined;
});
const activeSql = computed({
  get: () => activeQuery.value?.sql ?? "",
  set: (value: string) => {
    if (activeQuery.value) activeQuery.value.sql = value;
  },
});
const canRun = computed(() => connected.value && Boolean(activeSql.value.trim()) && !queryLoading.value);
const sqlSuggestions = computed(() => {
  const values: string[] = [];
  for (const object of objects.value) {
    values.push(object.name, `${object.schema}.${object.name}`);
    for (const column of columnsByObject.value[databaseObjectKey(object)] ?? []) values.push(column.name);
  }
  return [...new Set(values)];
});
const historyItems = computed<ContextMenuItem[]>(() => {
  const items = historyEntries.value.slice(0, 20).map((entry, index): ContextMenuItem => ({
    id: `history:${entry.id}`,
    label: entry.sql.replace(/\s+/gu, " ").trim().slice(0, 72),
    icon: "lucide:history",
    shortcut: new Date(entry.executedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    groupLabel: index === 0 ? "最近执行" : undefined,
  }));
  if (!items.length) items.push({ id: "empty", label: "还没有查询历史", icon: "lucide:inbox", disabled: true });
  items.push({ id: "clear", label: "清空当前连接历史", icon: "lucide:trash-2", danger: true, separatorBefore: true, disabled: !historyEntries.value.length });
  return items;
});
const nameDialogTitle = computed(() => {
  if (nameDialog.mode === "create-database") return "新建数据库";
  if (nameDialog.mode === "rename-database") return "重命名数据库";
  return `重命名${nameDialog.targetObject ? objectKindLabel(nameDialog.targetObject.kind) : "对象"}`;
});
const nameDialogDescription = computed(() => {
  if (nameDialog.mode === "create-database") return `${props.connection?.name ?? "数据库连接"} · 创建后会自动刷新对象树`;
  if (nameDialog.mode === "rename-database" && databaseKind.value === "mysql") return "MySQL 不支持原生 RENAME DATABASE；应用会拒绝危险的模拟迁移并给出说明。";
  return nameDialog.targetDatabase || `${nameDialog.targetObject?.schema}.${nameDialog.targetObject?.name}`;
});
const deleteTitle = computed(() => deleteDialog.object ? `删除${objectKindLabel(deleteDialog.object.kind)}？` : "删除数据库？");
const deleteDescription = computed(() => {
  if (deleteDialog.object) return `将永久删除 ${qualifiedName(deleteDialog.object)}。此操作无法撤销，请确认已有备份。`;
  return `将永久删除数据库“${deleteDialog.database}”及其中的全部对象和数据。当前活动数据库不能删除。`;
});

function refreshForConnection(connectionId: string): void {
  if (props.connection?.id === connectionId) void refreshAll();
}

async function newQueryForConnection(connectionId: string, targetDatabase: string): Promise<void> {
  if (props.connection?.id !== connectionId) return;
  await newQueryForSchema(targetDatabase || undefined);
}

defineExpose({ refreshForConnection, newQueryForConnection });

async function refreshAll(): Promise<void> {
  await Promise.all([refreshDatabases(), refreshObjects()]);
}

function addQueryTab(sql = ""): QueryTab {
  const index = queryState.tabs.filter((tab) => tab.kind === "query").length + 1;
  const id = `query-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tab: QueryTab = { id, label: `Query ${index}`, icon: "lucide:square-terminal", closable: true, kind: "query", sql };
  queryState.tabs.push(tab);
  queryState.activeId = id;
  return tab;
}

function closeTab(id: string): void {
  const index = queryState.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  queryState.tabs.splice(index, 1);
  if (!queryState.tabs.length) {
    addQueryTab();
    return;
  }
  if (queryState.activeId === id) queryState.activeId = (queryState.tabs[index] ?? queryState.tabs[index - 1]).id;
}

function closeObjectTab(object: DatabaseObject): void {
  const id = objectTabId(object);
  if (queryState.tabs.some((tab) => tab.id === id)) closeTab(id);
}

function quoteIdentifier(identifier: string): string {
  return databaseKind.value === "mysql"
    ? `\`${identifier.replaceAll("`", "``")}\``
    : `"${identifier.replaceAll('"', '""')}"`;
}

function qualifiedName(object: Pick<DatabaseObject, "schema" | "name">): string {
  return `${quoteIdentifier(object.schema)}.${quoteIdentifier(object.name)}`;
}

function objectTabId(object: DatabaseObject): string {
  return `object:${encodeURIComponent(databaseObjectKey(object))}`;
}

function objectKindLabel(kind: DatabaseObjectKind): string {
  if (kind === "table") return "表";
  if (kind === "view") return "视图";
  if (kind === "procedure") return "存储过程";
  return "函数";
}

function objectIcon(kind: DatabaseObjectKind): string {
  if (kind === "table") return "lucide:table-2";
  if (kind === "view") return "lucide:eye";
  if (kind === "procedure") return "lucide:workflow";
  return "lucide:braces";
}

function openQuery(sql: string): void {
  const tab = activeQuery.value ?? addQueryTab();
  tab.sql = sql;
  queryState.activeId = tab.id;
}

function createObjectQuery(object: DatabaseObject): void {
  const name = qualifiedName(object);
  if (object.kind === "procedure") openQuery(`CALL ${name}(/* 参数 */);`);
  else if (object.kind === "function") openQuery(`SELECT ${name}(/* 参数 */);`);
  else openQuery(`SELECT *\nFROM ${name}\nLIMIT 100;`);
}

async function newQueryForSchema(schema?: string): Promise<void> {
  if (schema && databaseKind.value === "mysql" && schema !== session.value?.database) await changeDatabase(schema);
  addQueryTab();
}

function createObjectTemplate(schema: string, kind: DatabaseObjectKind): void {
  const placeholder = kind === "table" ? "new_table" : kind === "view" ? "new_view" : kind === "procedure" ? "new_procedure" : "new_function";
  const name = `${quoteIdentifier(schema)}.${quoteIdentifier(placeholder)}`;
  if (kind === "table") {
    const primary = databaseKind.value === "mysql" ? "BIGINT PRIMARY KEY AUTO_INCREMENT" : "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY";
    openQuery(`CREATE TABLE ${name} (\n  id ${primary},\n  name VARCHAR(255) NOT NULL,\n  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP\n);`);
  } else if (kind === "view") {
    openQuery(`CREATE VIEW ${name} AS\nSELECT 1 AS example;`);
  } else if (kind === "procedure" && databaseKind.value === "mysql") {
    openQuery(`CREATE PROCEDURE ${name}()\nSELECT 1 AS result;`);
  } else if (kind === "function" && databaseKind.value === "mysql") {
    openQuery(`CREATE FUNCTION ${name}()\nRETURNS INTEGER\nDETERMINISTIC\nRETURN 1;`);
  } else if (kind === "procedure") {
    openQuery(`CREATE PROCEDURE ${name}()\nLANGUAGE SQL\nAS $$\n  SELECT 1;\n$$;`);
  } else {
    openQuery(`CREATE FUNCTION ${name}()\nRETURNS INTEGER\nLANGUAGE SQL\nAS $$\n  SELECT 1;\n$$;`);
  }
}

function openObject(object: DatabaseObject, panel: "data" | "columns" = "data"): void {
  const resolvedPanel = object.kind === "view" && panel === "columns" ? "data" : panel;
  const id = objectTabId(object);
  const existing = queryState.tabs.find((tab) => tab.id === id);
  if (!existing) {
    queryState.tabs.push({
      id,
      label: object.kind === "table" ? object.name : `${objectKindLabel(object.kind)}: ${object.name}`,
      icon: objectIcon(object.kind),
      closable: true,
      kind: "object",
      object,
      panel: resolvedPanel,
      panelNonce: 0,
    });
  } else if (existing.kind === "object") {
    existing.panel = resolvedPanel;
    existing.panelNonce += 1;
  }
  queryState.activeId = id;
}

async function copyObjectName(object: DatabaseObject): Promise<void> {
  await navigator.clipboard.writeText(qualifiedName(object));
  actionState.message = "已复制限定名称";
  actionState.error = "";
}

function showNameDialog(mode: NameActionMode, target?: string | DatabaseObject): void {
  nameDialog.mode = mode;
  nameDialog.targetDatabase = typeof target === "string" ? target : "";
  nameDialog.targetObject = typeof target === "object" ? target : null;
  nameDialog.initialValue = mode === "rename-database" ? String(target ?? "") : mode === "rename-object" && typeof target === "object" ? target.name : "";
  nameDialog.error = "";
  nameDialog.loading = false;
  nameDialog.open = true;
}

async function submitNameAction(name: string): Promise<void> {
  if (!sessionId.value) return;
  nameDialog.loading = true;
  nameDialog.error = "";
  try {
    if (nameDialog.mode === "create-database") {
      await database.createDatabase(sessionId.value, name);
      actionState.message = `数据库“${name}”已创建`;
    } else if (nameDialog.mode === "rename-database") {
      await database.renameDatabase(sessionId.value, nameDialog.targetDatabase, name);
      actionState.message = `数据库已重命名为“${name}”`;
    } else if (nameDialog.targetObject) {
      await database.renameObject(sessionId.value, nameDialog.targetObject, name);
      closeObjectTab(nameDialog.targetObject);
      actionState.message = `${objectKindLabel(nameDialog.targetObject.kind)}已重命名为“${name}”`;
    }
    actionState.error = "";
    nameDialog.open = false;
    await refreshAll();
  } catch (error) {
    nameDialog.error = database.errorMessage(error);
  } finally {
    nameDialog.loading = false;
  }
}

function requestDeleteDatabase(name: string): void {
  deleteDialog.database = name;
  deleteDialog.object = null;
  deleteDialog.open = true;
}

function requestDeleteObject(object: DatabaseObject): void {
  deleteDialog.database = "";
  deleteDialog.object = object;
  deleteDialog.open = true;
}

async function confirmDelete(): Promise<void> {
  if (!sessionId.value) return;
  const targetObject = deleteDialog.object;
  const targetDatabase = deleteDialog.database;
  deleteDialog.open = false;
  actionState.error = "";
  try {
    if (targetObject) {
      await database.dropObject(sessionId.value, targetObject);
      closeObjectTab(targetObject);
      actionState.message = `${objectKindLabel(targetObject.kind)}“${targetObject.name}”已删除`;
    } else {
      await database.dropDatabase(sessionId.value, targetDatabase);
      actionState.message = `数据库“${targetDatabase}”已删除`;
    }
    await refreshAll();
  } catch (error) {
    actionState.error = database.errorMessage(error);
    actionState.message = "";
  }
}

async function runQuery(sqlOverride?: string): Promise<void> {
  const sql = (sqlOverride ?? editor.value?.runnableSql() ?? activeSql.value).trim();
  if (!connected.value || !sql || queryLoading.value) return;
  if (props.connection) {
    addQueryHistory({ connectionId: props.connection.id, database: databaseName.value, sql });
    historyEntries.value = listQueryHistory(props.connection.id);
  }
  await executeSql(sql);
}

function showHistory(event: MouseEvent): void {
  if (props.connection) historyEntries.value = listQueryHistory(props.connection.id);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  historyMenu.x = rect.right;
  historyMenu.y = rect.bottom + 5;
  historyMenu.open = true;
}

function handleHistoryAction(id: string): void {
  if (id === "clear") {
    clearQueryHistory(props.connection?.id);
    historyEntries.value = [];
    return;
  }
  const entry = historyEntries.value.find((candidate) => `history:${candidate.id}` === id);
  if (entry) openQuery(entry.sql);
}

async function changeDatabase(value: string): Promise<void> {
  if (!value || value === session.value?.database) return;
  for (const tab of [...queryState.tabs]) if (tab.kind === "object") closeTab(tab.id);
  await switchDatabase(value);
}

watch(() => props.connection?.id, (id) => {
  historyEntries.value = id ? listQueryHistory(id) : [];
  actionState.message = "";
  actionState.error = "";
});
</script>

<template>
  <div v-if="!connection" class="pane flex-1 items-center justify-center">
    <div class="flex flex-col items-center gap-3 text-center">
      <div class="grid size-14 place-items-center rounded-2xl border border-line bg-card text-txt-3"><AppIcon name="lucide:database" :size="26" /></div>
      <p class="text-sm text-txt-2">还没有打开数据库</p>
      <p class="max-w-70 text-xs text-txt-4">从左侧选一个数据库连接，或新建一个</p>
      <button type="button" class="btn mt-1" @click="openConnectionWindow('database')"><AppIcon name="lucide:plus" :size="13" /><span>新建数据库连接</span></button>
    </div>
  </div>

  <div v-else class="pane flex-1 flex-row">
    <DatabaseObjectTree
      :database-name="databaseName"
      :database-kind="databaseKind"
      :active-database="session?.database ?? ''"
      :database-names="databaseKind === 'mysql' ? databases : []"
      :objects="objects"
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
      @rename-database="showNameDialog('rename-database', $event)"
      @remove-database="requestDeleteDatabase"
      @rename-object="showNameDialog('rename-object', $event)"
      @remove-object="requestDeleteObject"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-10 shrink-0 items-end border-b border-line-soft px-2">
        <TabBar v-model:active="queryState.activeId" :tabs="queryState.tabs" addable @add="addQueryTab()" @close="closeTab" />
      </div>

      <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-line-soft px-2.5">
        <button v-if="activeQuery" type="button" class="grid size-6 place-items-center rounded bg-accent-deep text-black transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-35" title="执行选中内容或全部 SQL（Ctrl+Enter）" :disabled="!canRun" @click="runQuery()">
          <AppIcon :name="queryLoading ? 'lucide:loader-circle' : 'lucide:play'" :size="12" :class="queryLoading && 'animate-spin'" />
        </button>
        <IconButton :icon="connected ? 'lucide:unplug' : 'lucide:plug-zap'" :size="13" :title="connected ? '断开连接' : '重新连接'" :disabled="status === 'connecting'" @click="connected ? disconnect() : connect()" />
        <button v-if="activeQuery" type="button" class="icon-btn" title="查询历史" @click="showHistory"><AppIcon name="lucide:history" :size="13" /></button>
        <button v-if="queryLoading" type="button" class="flex h-6 cursor-pointer items-center gap-1 rounded border border-danger/30 bg-danger/8 px-2 text-[10.5px] text-danger transition-colors hover:bg-danger/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-danger" title="取消当前查询" @click="cancelQuery"><AppIcon name="lucide:square" :size="10" /><span>停止</span></button>
        <span v-if="activeObject" class="min-w-0 truncate text-[11px] text-txt-3">{{ activeObject.object.schema }}.<span class="text-txt-2">{{ activeObject.object.name }}</span></span>
        <span v-if="actionState.message" class="ml-2 min-w-0 truncate text-[10.5px] text-accent" role="status">{{ actionState.message }}</span>
        <span v-else-if="actionState.error" class="ml-2 min-w-0 truncate text-[10.5px] text-danger" role="alert" :title="actionState.error">{{ actionState.error }}</span>
        <div class="flex-1" />
        <div v-if="connected && databaseOptions.length" class="w-40"><AppSelect v-model="selectedDatabase" label="活动数据库" :options="databaseOptions" :disabled="databasesLoading || queryLoading" hide-label compact searchable /></div>
        <span class="max-w-56 truncate text-[11px] text-txt-3" :title="session ? `${session.endpoint}\n${session.serverVersion}` : sessionId || connectionError">{{ connected ? `${databaseKind} · ${session?.serverVersion || databaseName}` : status === 'connecting' ? 'Connecting…' : 'Disconnected' }}</span>
      </div>

      <DatabaseConnectionState v-if="!connected" v-model:password="password" :status="status" :error="connectionError" :needs-password="needsPassword" @connect="connect" />
      <template v-else-if="activeQuery">
        <SqlEditor ref="editor" v-model="activeSql" :disabled="queryLoading" :suggestions="sqlSuggestions" @run="runQuery" />
        <DatabaseQueryResults :execution="queryExecution" :loading="queryLoading" :error="queryError" />
      </template>
      <DatabaseTableView v-else-if="activeRelation" :session-id="sessionId" :object="activeRelation.object" :initial-panel="activeRelation.panel" :panel-nonce="activeRelation.panelNonce" @query="openQuery" />
      <DatabaseRoutineView v-else-if="activeRoutine" :session-id="sessionId" :database-kind="databaseKind" :object="activeRoutine.object" @query="openQuery" />
    </div>

    <AppContextMenu :open="historyMenu.open" :x="historyMenu.x" :y="historyMenu.y" :items="historyItems" label="查询历史" @close="historyMenu.open = false" @select="handleHistoryAction" />
    <DatabaseObjectNameDialog
      :open="nameDialog.open"
      :title="nameDialogTitle"
      :description="nameDialogDescription"
      :initial-value="nameDialog.initialValue"
      :confirm-label="nameDialog.mode === 'create-database' ? '创建数据库' : '保存名称'"
      :loading="nameDialog.loading"
      :error="nameDialog.error"
      @close="nameDialog.open = false"
      @submit="submitNameAction"
    />
    <AppConfirmDialog :open="deleteDialog.open" :title="deleteTitle" :description="deleteDescription" confirm-label="确认删除" danger @close="deleteDialog.open = false" @confirm="confirmDelete" />
  </div>
</template>
