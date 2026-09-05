import { settingsSnapshot } from '@/composables/useSettings'

let clearTimer: ReturnType<typeof setTimeout> | undefined
let lastCopied = ''

/**
 * 应用内复制统一走这里，才能配合「自动清空剪贴板」设置。
 */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  scheduleClipboardClear(text)
}

/**
 * 按设置在若干秒后清空剪贴板。
 *
 * 清空前会尽量核对剪贴板内容是否仍是我们写入的那份：
 * 用户在这期间复制了别的东西就不动它。读取权限不可用时按写入时间兜底清空。
 */
export function scheduleClipboardClear(text: string): void {
  if (clearTimer) clearTimeout(clearTimer)
  lastCopied = text

  const seconds = Number(settingsSnapshot().clipboardClearTimeout) || 0
  if (seconds <= 0) return

  clearTimer = setTimeout(async () => {
    clearTimer = undefined
    try {
      const current = await navigator.clipboard.readText().catch(() => null)
      if (current !== null && current !== lastCopied) return
      await navigator.clipboard.writeText('')
    } catch {
      // 窗口失焦时 WebView 可能拒绝访问剪贴板，忽略即可
    }
  }, seconds * 1000)
}
