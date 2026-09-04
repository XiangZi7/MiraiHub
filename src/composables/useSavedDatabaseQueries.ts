import { computed, reactive, readonly, watch } from "vue";
import type {
  PersistedDatabaseQueryTab,
  PersistedDatabaseQueryWorkspace,
  SavedDatabaseQuery,
} from "@/types/database-query";

const QUERY_STORAGE_KEY = "miraihub.database-saved-queries.v1";
const WORKSPACE_STORAGE_PREFIX = "miraihub.database-query-workspace.v1";
const MAX_QUERIES = 500;
const MAX_TABS = 40;

function isSavedQuery(value: unknown): value is SavedDatabaseQuery {
  if (!value || typeof value !== "object") return false;
  const query = value as Partial<SavedDatabaseQuery>;
  return typeof query.id === "string"
    && typeof query.connectionId === "string"
    && typeof query.database === "string"
    && typeof query.name === "string"
    && typeof query.sql === "string"
    && typeof query.createdAt === "number"
    && typeof query.updatedAt === "number";
}

function readQueries(): SavedDatabaseQuery[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(QUERY_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(isSavedQuery).slice(0, MAX_QUERIES) : [];
  } catch {
    return [];
  }
}

const state = reactive({ items: readQueries() });
let persistenceTimer: ReturnType<typeof setTimeout> | undefined;

function persistQueries(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(QUERY_STORAGE_KEY, JSON.stringify(state.items.slice(0, MAX_QUERIES)));
  } catch {
    // 存储空间或隐私设置不可用时仍保留当前运行内的数据。
  }
}

watch(
  () => state.items,
  () => {
    if (persistenceTimer) clearTimeout(persistenceTimer);
    persistenceTimer = setTimeout(persistQueries, 180);
  },
  { deep: true },
);

if (typeof window !== "undefined") window.addEventListener("beforeunload", persistQueries);

function nextId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `saved-query-${crypto.randomUUID()}`
    : `saved-query-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isPersistedTab(value: unknown): value is PersistedDatabaseQueryTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Partial<PersistedDatabaseQueryTab>;
  return typeof tab.id === "string"
    && typeof tab.label === "string"
    && typeof tab.sql === "string"
    && typeof tab.database === "string"
    && (typeof tab.savedQueryId === "string" || tab.savedQueryId === null);
}

export function useSavedDatabaseQueries(connectionId: string) {
  const queries = computed(() => state.items
    .filter(query => query.connectionId === connectionId)
    .sort((a, b) => b.updatedAt - a.updatedAt));

  function uniqueName(database: string, requested: string, ignoreId = ""): string {
    const base = requested.trim().slice(0, 120) || "未命名查询";
    const used = new Set(state.items
      .filter(query => query.connectionId === connectionId && query.database === database && query.id !== ignoreId)
      .map(query => query.name.toLocaleLowerCase()));
    if (!used.has(base.toLocaleLowerCase())) return base;
    let suffix = 2;
    while (used.has(`${base} (${suffix})`.toLocaleLowerCase())) suffix += 1;
    return `${base} (${suffix})`;
  }

  function createQuery(database: string, name: string, sql = ""): SavedDatabaseQuery {
    const now = Date.now();
    const query: SavedDatabaseQuery = {
      id: nextId(),
      connectionId,
      database,
      name: uniqueName(database, name),
      sql,
      createdAt: now,
      updatedAt: now,
    };
    state.items.unshift(query);
    return query;
  }

  function updateQuery(id: string, patch: Partial<Pick<SavedDatabaseQuery, "name" | "sql" | "database">>): SavedDatabaseQuery | undefined {
    const query = state.items.find(item => item.id === id && item.connectionId === connectionId);
    if (!query) return undefined;
    if (patch.database !== undefined) query.database = patch.database;
    if (patch.name !== undefined) query.name = uniqueName(query.database, patch.name, id);
    if (patch.sql !== undefined) query.sql = patch.sql;
    query.updatedAt = Date.now();
    return query;
  }

  function removeQuery(id: string): void {
    const index = state.items.findIndex(query => query.id === id && query.connectionId === connectionId);
    if (index >= 0) state.items.splice(index, 1);
  }

  function workspaceKey(): string {
    return `${WORKSPACE_STORAGE_PREFIX}:${encodeURIComponent(connectionId)}`;
  }

  function loadWorkspace(): PersistedDatabaseQueryWorkspace {
    if (typeof localStorage === "undefined") return { activeId: "", tabs: [] };
    try {
      const value = JSON.parse(localStorage.getItem(workspaceKey()) ?? "null") as Partial<PersistedDatabaseQueryWorkspace> | null;
      if (!value || !Array.isArray(value.tabs)) return { activeId: "", tabs: [] };
      return {
        activeId: typeof value.activeId === "string" ? value.activeId : "",
        tabs: value.tabs.filter(isPersistedTab).slice(0, MAX_TABS),
      };
    } catch {
      return { activeId: "", tabs: [] };
    }
  }

  function saveWorkspace(workspace: PersistedDatabaseQueryWorkspace): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(workspaceKey(), JSON.stringify({
        activeId: workspace.activeId,
        tabs: workspace.tabs.slice(0, MAX_TABS),
      }));
    } catch {
      // 工作区草稿只做尽力保存，不影响 SQL 编辑器继续工作。
    }
  }

  return {
    queries: readonly(queries),
    createQuery,
    updateQuery,
    removeQuery,
    loadWorkspace,
    saveWorkspace,
    persistQueries,
  };
}
