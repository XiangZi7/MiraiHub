import { readFileSync, writeFileSync } from 'node:fs'
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const write = (p, s) => writeFileSync(p, s)
const hmr = n => `\nif (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(${n}, import.meta.hot))\n`
let s = read('src/composables/useToast.ts')
const types = s.slice(s.indexOf('export type ToastTone'), s.indexOf('interface ToastTimer'))
const notification = 'export interface NotificationItem extends ToastItem { createdAt: number, read: boolean }'
write('src/types/notification.ts', types.replace('type ToastInput', 'export type ToastInput') + notification + '\n')
s = s.replace('computed, readonly, reactive', 'computed, onScopeDispose, reactive')
s = s.replace(types, "import type { ToastTone, ToastInput, ToastItem, NotificationItem } from '@/types/notification'\n")
s = s.replace(notification, '')
s = "import { acceptHMRUpdate, defineStore } from 'pinia'\n" + s
s = s.replace('const items = reactive', "export const useNotificationsStore = defineStore('notifications', () => {\nconst items = reactive")
const bottom = s.indexOf('interface ToastFunction')
s = s.slice(0, bottom) + `onScopeDispose(clear)\nreturn { items, notifications, show, dismiss, clear, pause, resume, unreadCount: computed(() => notifications.filter(item => !item.read).length), markAllRead: () => { for (const item of notifications) item.read = true }, clearNotifications: () => { notifications.splice(0) } }\n})\n` + hmr('useNotificationsStore')
write('src/stores/notifications.ts', s)
write('src/composables/useToast.ts', `import { readonly } from 'vue'
import { storeToRefs } from 'pinia'
import { pinia } from '@/stores'
import { useNotificationsStore } from '@/stores/notifications'
import type { ToastInput } from '@/types/notification'
export type { ToastTone, ToastOptions, ToastItem, NotificationItem } from '@/types/notification'

/** 工具函数只在被调用时取 store，不在模块加载阶段创建状态或计时器。 */
export const toast = Object.assign((input: ToastInput) => useNotificationsStore(pinia).show('info', input), {
  success: (input: ToastInput) => useNotificationsStore(pinia).show('success', input),
  error: (input: ToastInput) => useNotificationsStore(pinia).show('error', input),
  warning: (input: ToastInput) => useNotificationsStore(pinia).show('warning', input),
  info: (input: ToastInput) => useNotificationsStore(pinia).show('info', input),
  dismiss: (id: string) => useNotificationsStore(pinia).dismiss(id),
  clear: () => useNotificationsStore(pinia).clear(),
})
export function useToast() {
  const store = useNotificationsStore()
  return { toasts: readonly(store.items), dismiss: store.dismiss, pause: store.pause, resume: store.resume }
}
export function useNotifications() {
  const store = useNotificationsStore()
  const { unreadCount } = storeToRefs(store)
  return { notifications: readonly(store.notifications), unreadCount, markAllRead: store.markAllRead, clearNotifications: store.clearNotifications }
}
`)

s = read('src/composables/useStartupCommandPresets.ts')
s = s.replace('readonly, shallowRef', 'onScopeDispose, shallowRef')
s = "import { acceptHMRUpdate, defineStore } from 'pinia'\n" + s
s = s.replace('const presets =', "export const useCommandPresetsStore = defineStore('command-presets', () => {\nconst presets =")
s = s.replace('store.subscribe(() => void refresh())', 'onScopeDispose(store.subscribe(() => void refresh()))')
s = s.replace('export function useStartupCommandPresets() {\n  return {\n    presets: readonly(presets),', 'return {\n    presets,')
s = s.replace(/\n}\s*$/, '\n})\n')
write('src/stores/command-presets.ts', s + hmr('useCommandPresetsStore'))
write('src/composables/useStartupCommandPresets.ts', `import { storeToRefs } from 'pinia'\nimport { useCommandPresetsStore } from '@/stores/command-presets'\nexport function useStartupCommandPresets() {\n  const store = useCommandPresetsStore()\n  const { presets } = storeToRefs(store)\n  return { presets, refresh: store.refresh, save: store.save, remove: store.remove }\n}\n`)

// 已保存 SQL 属于共享 store；按连接过滤和工作区草稿序列化继续由 composable 负责。
s = read('src/composables/useSavedDatabaseQueries.ts')
const storeStart = s.indexOf('function isSavedQuery')
const storeEnd = s.indexOf('function nextId()')
let storeCode = s.slice(storeStart, storeEnd)
storeCode = storeCode.replace('const state = reactive', "export const useSavedQueriesStore = defineStore('saved-queries', () => {\nconst state = reactive")
storeCode += `onScopeDispose(() => {\n  if (persistenceTimer) clearTimeout(persistenceTimer)\n  persistQueries()\n  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', persistQueries)\n})\nreturn { items: state.items, persistQueries }\n})\n`
write('src/stores/saved-queries.ts', `import { onScopeDispose, reactive, watch } from 'vue'\nimport { acceptHMRUpdate, defineStore } from 'pinia'\nimport type { SavedDatabaseQuery } from '@/types/database-query'\nconst QUERY_STORAGE_KEY = 'miraihub.database-saved-queries.v1'\nconst MAX_QUERIES = 500\n` + storeCode + hmr('useSavedQueriesStore'))
s = s.slice(0, storeStart) + s.slice(storeEnd)
s = s.replace('computed, reactive, readonly, watch', 'computed, readonly')
s = s.replace('const QUERY_STORAGE_KEY = "miraihub.database-saved-queries.v1";\n', '').replace('const MAX_QUERIES = 500;\n', '')
s = "import { useSavedQueriesStore } from '@/stores/saved-queries'\n" + s
s = s.replace('export function useSavedDatabaseQueries(connectionId: string) {', 'export function useSavedDatabaseQueries(connectionId: string) {\n  const state = useSavedQueriesStore()\n  const { persistQueries } = state')
write('src/composables/useSavedDatabaseQueries.ts', s)
