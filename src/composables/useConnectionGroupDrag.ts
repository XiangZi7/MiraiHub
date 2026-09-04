import { computed, shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import type {
  ConnectionGroupKind,
  ConnectionGroupView,
  SavedConnection,
} from '@/types/connection'
import { groupKindOf } from '@/types/connection'

interface DragPayload {
  connectionId: string
  label: string
  sourceGroupId: string
  groupKind: ConnectionGroupKind
}

interface ConnectionGroupDragOptions {
  groups: () => readonly ConnectionGroupView[]
  onDrop: (connectionId: string, group: ConnectionGroupView) => void
}

const DRAG_THRESHOLD_PX = 5

/**
 * 侧栏连接的指针拖拽。
 *
 * 不使用浏览器 HTML5 drag/drop，避免与 Tauri 原生文件拖放争用事件。
 */
export function useConnectionGroupDrag(options: ConnectionGroupDragOptions) {
  const dragging = shallowRef(false)
  const draggedConnectionId = shallowRef('')
  const draggedLabel = shallowRef('')
  const targetGroupId = shallowRef('')
  const pointerX = shallowRef(0)
  const pointerY = shallowRef(0)

  let activePointerId = -1
  let startX = 0
  let startY = 0
  let payload: DragPayload | null = null
  let suppressedClickId = ''
  let suppressClickTimer: ReturnType<typeof setTimeout> | undefined

  const dragStyle = computed(() => ({
    left: `${pointerX.value + 14}px`,
    top: `${pointerY.value + 14}px`,
  }))

  function groupAtPoint(x: number, y: number): ConnectionGroupView | undefined {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-connection-group-id]')
    const groupId = element?.dataset.connectionGroupId

    if (!groupId) return undefined

    return options
      .groups()
      .find(
        (group) => group.id === groupId && group.kind === payload?.groupKind,
      )
  }

  function reset(): void {
    activePointerId = -1
    payload = null
    dragging.value = false
    draggedConnectionId.value = ''
    draggedLabel.value = ''
    targetGroupId.value = ''
  }

  function start(
    event: PointerEvent,
    connection: SavedConnection,
    sourceGroup: ConnectionGroupView,
  ): void {
    if (event.button !== 0 || !event.isPrimary) return
    activePointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    pointerX.value = event.clientX
    pointerY.value = event.clientY
    payload = {
      connectionId: connection.id,
      label: connection.name,
      sourceGroupId: sourceGroup.id,
      groupKind: groupKindOf(connection.kind),
    }

    const target = event.currentTarget as HTMLElement
    target.setPointerCapture?.(event.pointerId)
  }

  function move(event: PointerEvent): void {
    if (!payload || event.pointerId !== activePointerId) return

    pointerX.value = event.clientX
    pointerY.value = event.clientY

    if (!dragging.value) {
      const distance = Math.hypot(
        event.clientX - startX,
        event.clientY - startY,
      )
      if (distance < DRAG_THRESHOLD_PX) return

      dragging.value = true
      draggedConnectionId.value = payload.connectionId
      draggedLabel.value = payload.label
    }

    event.preventDefault()
    const group = groupAtPoint(event.clientX, event.clientY)
    targetGroupId.value =
      group && group.id !== payload.sourceGroupId ? group.id : ''
  }

  function finish(event: PointerEvent): void {
    if (!payload || event.pointerId !== activePointerId) return

    const currentPayload = payload
    const wasDragging = dragging.value
    const group = wasDragging
      ? groupAtPoint(event.clientX, event.clientY)
      : undefined

    if (wasDragging) {
      suppressedClickId = currentPayload.connectionId
      clearTimeout(suppressClickTimer)
      suppressClickTimer = setTimeout(() => {
        suppressedClickId = ''
      }, 0)
    }

    reset()

    if (group && group.id !== currentPayload.sourceGroupId)
      options.onDrop(currentPayload.connectionId, group)
  }

  function cancel(event?: PointerEvent): void {
    if (event && event.pointerId !== activePointerId) return
    reset()
  }

  function consumeSuppressedClick(connectionId: string): boolean {
    if (suppressedClickId !== connectionId) return false

    suppressedClickId = ''
    clearTimeout(suppressClickTimer)
    return true
  }

  useEventListener(window, 'pointermove', move, { passive: false })
  useEventListener(window, 'pointerup', finish)
  useEventListener(window, 'pointercancel', cancel)
  useEventListener(window, 'blur', () => cancel())

  return {
    dragging,
    draggedConnectionId,
    draggedLabel,
    targetGroupId,
    dragStyle,
    start,
    consumeSuppressedClick,
  }
}
