import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { IS_TAURI } from '@/utils/window'

/** 把 Tauri 原生文件拖放事件限定到指定 DOM 区域，并返回可渲染的悬停状态。 */
export function useNativeFileDrop(
  target: Readonly<Ref<HTMLElement | null>>,
  onDrop: (paths: string[]) => void,
) {
  const isDragging = shallowRef(false)
  let unlisten: UnlistenFn | undefined
  let scaleFactor = 1

  function isInside(position: { x: number, y: number }): boolean {
    const element = target.value
    if (!element)
      return false
    const rect = element.getBoundingClientRect()
    return position.x >= rect.left && position.x <= rect.right
      && position.y >= rect.top && position.y <= rect.bottom
  }

  onMounted(async () => {
    if (!IS_TAURI)
      return

    scaleFactor = await getCurrentWindow().scaleFactor()
    unlisten = await getCurrentWebview().onDragDropEvent((event) => {
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
  })

  onBeforeUnmount(() => unlisten?.())

  return { isDragging }
}
