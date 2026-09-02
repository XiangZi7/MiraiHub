import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * 是否运行在 Tauri 容器内。
 * 浏览器里直接预览（pnpm dev 开 localhost）时为 false，
 * 此时所有窗口操作降级为空操作，避免抛错。
 */
export const IS_TAURI: boolean
  = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function withWindow(action: (win: ReturnType<typeof getCurrentWindow>) => Promise<unknown>): void {
  if (!IS_TAURI)
    return

  void action(getCurrentWindow())
}

/** 最小化窗口 */
export function minimizeWindow(): void {
  withWindow(win => win.minimize())
}

/** 最大化 / 还原窗口 */
export function toggleMaximizeWindow(): void {
  withWindow(win => win.toggleMaximize())
}

/** 关闭窗口 */
export function closeWindow(): void {
  withWindow(win => win.close())
}
