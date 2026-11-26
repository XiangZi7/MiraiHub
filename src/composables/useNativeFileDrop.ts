import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { IS_TAURI } from '@/utils/window'

/** 把 Tauri 原生文件拖放事件限定到指定 DOM 区域，并返回可渲染的悬停状态。 */
export function useNativeFileDrop(
  target: Readonly<Ref<HTMLElement | null>>,
  onDrop: (paths: string[]) => void
) {
  const isDragging = shallowRef(false)
  let unlisten: UnlistenFn | undefined
  let disposed = false

  onMounted(async () => {
    if (!IS_TAURI) return

    unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (disposed) return
      const element = target.value
      if (!element || payload.type === 'leave') {
        isDragging.value = false
        return
      }
      // 原生坐标是物理像素。按当前 WebView 的 DPI 和缩放命中最上层元素。
      const doc = element.ownerDocument
      const { x, y } = payload.position.toLogical(
        doc.defaultView?.devicePixelRatio || 1
      )
      const inside = element.contains(doc.elementFromPoint(x, y))
      isDragging.value = inside && payload.type !== 'drop'
      if (payload.type === 'drop' && inside && payload.paths.length)
        onDrop(payload.paths)
    })
    if (disposed) unlisten()
  })

  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
  })

  return { isDragging }
}
