export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  title: string
  description?: string
  duration?: number
}

export interface ToastItem extends Required<Omit<ToastOptions, 'description'>> {
  id: string
  description: string
  tone: ToastTone
}

export type ToastInput = string | ToastOptions

export interface NotificationItem extends ToastItem {
  createdAt: number
  read: boolean
}
