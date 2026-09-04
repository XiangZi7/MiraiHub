import { readonly, reactive } from 'vue'

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

type ToastInput = string | ToastOptions

interface ToastTimer {
  handle: ReturnType<typeof setTimeout>
  remaining: number
  startedAt: number
}

const DEFAULT_DURATIONS: Record<ToastTone, number> = {
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 6500,
}

const MAX_VISIBLE_TOASTS = 5
const items = reactive<ToastItem[]>([])
const timers = new Map<string, ToastTimer>()
let nextId = 0

function dismiss(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer.handle)
    timers.delete(id)
  }

  const index = items.findIndex(item => item.id === id)
  if (index !== -1)
    items.splice(index, 1)
}

function startTimer(id: string, duration: number): void {
  if (duration <= 0)
    return

  const timer: ToastTimer = {
    handle: setTimeout(() => dismiss(id), duration),
    remaining: duration,
    startedAt: Date.now(),
  }
  timers.set(id, timer)
}

function pause(id: string): void {
  const timer = timers.get(id)
  if (!timer)
    return

  clearTimeout(timer.handle)
  timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt))
  timers.delete(id)
  timers.set(id, timer)
}

function resume(id: string): void {
  const timer = timers.get(id)
  if (!timer)
    return

  if (timer.remaining <= 0) {
    dismiss(id)
    return
  }

  timer.startedAt = Date.now()
  timer.handle = setTimeout(() => dismiss(id), timer.remaining)
}

function show(tone: ToastTone, input: ToastInput): string {
  const options = typeof input === 'string' ? { title: input } : input
  const title = options.title.trim()
  if (!title)
    return ''

  const description = options.description?.trim() ?? ''
  const duplicate = items.find(item => item.tone === tone && item.title === title && item.description === description)
  if (duplicate)
    dismiss(duplicate.id)

  while (items.length >= MAX_VISIBLE_TOASTS)
    dismiss(items[0].id)

  const id = `toast-${Date.now()}-${nextId++}`
  const duration = options.duration ?? DEFAULT_DURATIONS[tone]
  items.push({ id, tone, title, description, duration })
  startTimer(id, duration)
  return id
}

function clear(): void {
  for (const item of [...items])
    dismiss(item.id)
}

interface ToastFunction {
  (input: ToastInput): string
  success: (input: ToastInput) => string
  error: (input: ToastInput) => string
  warning: (input: ToastInput) => string
  info: (input: ToastInput) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const toast = Object.assign(
  (input: ToastInput) => show('info', input),
  {
    success: (input: ToastInput) => show('success', input),
    error: (input: ToastInput) => show('error', input),
    warning: (input: ToastInput) => show('warning', input),
    info: (input: ToastInput) => show('info', input),
    dismiss,
    clear,
  },
) as ToastFunction

export function useToast() {
  return {
    toasts: readonly(items),
    dismiss,
    pause,
    resume,
  }
}
