import { readonly } from 'vue'
import { storeToRefs } from 'pinia'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { pinia } from '@/stores'
import { useNotificationsStore } from '@/stores/notifications'
import { IS_TAURI } from '@/utils/window'
import type { ToastInput, ToastTone } from '@/types/notification'
export type {
  ToastTone,
  ToastOptions,
  ToastItem,
  NotificationItem,
} from '@/types/notification'

const MAIN_WINDOW_LABEL = 'main'
const TOAST_EVENT = 'miraihub:toast'

interface ToastMessage {
  tone: ToastTone
  input: ToastInput
}

function isToastInput(value: unknown): value is ToastInput {
  if (typeof value === 'string') return true
  if (!value || typeof value !== 'object') return false

  const input = value as Record<string, unknown>
  return (
    typeof input.title === 'string' &&
    (input.description === undefined ||
      typeof input.description === 'string') &&
    (input.duration === undefined ||
      (typeof input.duration === 'number' && Number.isFinite(input.duration)))
  )
}

function isToastMessage(value: unknown): value is ToastMessage {
  if (!value || typeof value !== 'object') return false

  const message = value as Partial<ToastMessage>
  return (
    ['success', 'error', 'warning', 'info'].includes(String(message.tone)) &&
    isToastInput(message.input)
  )
}

function showLocalToast(tone: ToastTone, input: ToastInput): string {
  return useNotificationsStore(pinia).show(tone, input)
}

function showToast(tone: ToastTone, input: ToastInput): string {
  if (IS_TAURI && getCurrentWindow().label !== MAIN_WINDOW_LABEL) {
    void emitTo(MAIN_WINDOW_LABEL, TOAST_EVENT, { tone, input }).catch(
      error => {
        console.warn('转发通知到主窗口失败：', error)
      }
    )
    return ''
  }

  return showLocalToast(tone, input)
}

let receiverReady: Promise<void> | undefined

/** 主窗口接收原生子窗口通知，确保 Toast 和通知中心只有一份状态。 */
export function startMainToastReceiver(): Promise<void> {
  if (!IS_TAURI || getCurrentWindow().label !== MAIN_WINDOW_LABEL)
    return Promise.resolve()

  receiverReady ??= listen<unknown>(TOAST_EVENT, event => {
    if (!isToastMessage(event.payload)) return
    showLocalToast(event.payload.tone, event.payload.input)
  })
    .then(() => undefined)
    .catch(error => {
      receiverReady = undefined
      console.warn('订阅子窗口通知失败：', error)
    })

  return receiverReady
}

/** 工具函数只在被调用时取 store，不在模块加载阶段创建状态或计时器。 */
export const toast = Object.assign(
  (input: ToastInput) => showToast('info', input),
  {
    success: (input: ToastInput) => showToast('success', input),
    error: (input: ToastInput) => showToast('error', input),
    warning: (input: ToastInput) => showToast('warning', input),
    info: (input: ToastInput) => showToast('info', input),
    dismiss: (id: string) => useNotificationsStore(pinia).dismiss(id),
    clear: () => useNotificationsStore(pinia).clear(),
  }
)
export function useToast() {
  const store = useNotificationsStore()
  return {
    toasts: readonly(store.items),
    dismiss: store.dismiss,
    pause: store.pause,
    resume: store.resume,
  }
}
export function useNotifications() {
  const store = useNotificationsStore()
  const { unreadCount } = storeToRefs(store)
  return {
    notifications: readonly(store.notifications),
    unreadCount,
    markAllRead: store.markAllRead,
    clearNotifications: store.clearNotifications,
  }
}
