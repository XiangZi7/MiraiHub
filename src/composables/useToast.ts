import { readonly } from 'vue'
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
