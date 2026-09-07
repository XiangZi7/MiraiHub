import { DEFAULT_SETTINGS } from '@/types/settings'

const MIDPOINT = 50

/**
 * 外观滑杆以 50 为主题原始效果，避免升级后改变已有主题的透明度。
 */
export function normalizeWindowBackgroundOpacity(value: unknown): string {
  const opacity = Number(value)
  if (
    value == null ||
    (typeof value === 'string' && !value.trim()) ||
    !Number.isFinite(opacity)
  )
    return DEFAULT_SETTINGS.windowBackgroundOpacity
  return String(Math.min(100, Math.max(0, Math.round(opacity))))
}

/** 把滑杆两侧映射成“淡出主题底色”和“补入不透明底色”两个独立比例。 */
export function applyWindowBackgroundOpacity(
  value: unknown,
  root: HTMLElement = document.documentElement
): void {
  const opacity = Number(normalizeWindowBackgroundOpacity(value))
  const fade = Math.max(0, (MIDPOINT - opacity) * 2)
  const fill = Math.max(0, (opacity - MIDPOINT) * 2)
  root.style.setProperty('--window-background-fade', `${fade}%`)
  root.style.setProperty('--window-background-fill', `${fill}%`)
}
