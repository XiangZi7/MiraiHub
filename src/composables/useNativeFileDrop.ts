import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { IS_TAURI } from '@/utils/window'

/** 把 Tauri 原生文件拖放事件限定到指定 DOM 区域，并返回可渲染的悬停状态。 */
export function useNativeFileDrop(
  target: Readonly<Ref<HTMLElement | null>>,
  onDrop: (paths: string[]) => void
) {
  const isDragging = shallowRef(false)
  const unlisteners: UnlistenFn[] = []
  let disposed = false
  let scaleFactor = 1

  function isInside(position: { x: number; y: number }): boolean {
    const element = target.value
    if (!element) return false
    const rect = element.getBoundingClientRect()
    return (
      position.x >= rect.left &&
      position.x <= rect.right &&
      position.y >= rect.top &&
      position.y <= rect.bottom
    )
  }

  /** 注册完成时组件可能已卸载，此时立即注销，避免泄漏 Tauri 监听。 */
  function keep(unlisten: UnlistenFn): void {
    if (disposed) unlisten()
    else unlisteners.push(unlisten)
  }

  onMounted(async () => {
    if (!IS_TAURI) return

    const appWindow = getCurrentWindow()
    // 窗口拖到不同 DPI 的显示器时缩放会变，只读一次会让命中区域错位。
    void appWindow
      .onScaleChanged(({ payload }) => {
        scaleFactor = payload.scaleFactor
      })
      .then(keep)
      .catch(() => {})
    scaleFactor = await appWindow.scaleFactor()
    if (disposed) return
    keep(
      await getCurrentWebview().onDragDropEvent(event => {
        const payload = event.payload
        if (payload.type === 'leave') {
          isDragging.value = false
          return
        }

        const position = payload.position.toLogical(scaleFactor)
        const inside = isInside(position)
        isDragging.value = inside && payload.type !== 'drop'

        if (payload.type === 'drop' && inside && payload.paths.length)
          onDrop(payload.paths)
      })
    )
  })

  onBeforeUnmount(() => {
    disposed = true
    for (const unlisten of unlisteners.splice(0)) unlisten()
  })

  return { isDragging }
}
