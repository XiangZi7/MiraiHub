import { onScopeDispose, reactive, watch } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import type { SavedDatabaseQuery } from '@/types/database-query'
const QUERY_STORAGE_KEY = 'miraihub.database-saved-queries.v1'
const MAX_QUERIES = 500
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

export const useSavedQueriesStore = defineStore('saved-queries', () => {
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

onScopeDispose(() => {
  if (persistenceTimer) clearTimeout(persistenceTimer)
  persistQueries()
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', persistQueries)
})
return { items: state.items, persistQueries }
})

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useSavedQueriesStore, import.meta.hot))
