import { computed, shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import type {
  ConnectionGroupDropPosition,
  ConnectionGroupView,
} from '@/types/connection'

interface GroupDropTarget {
  id: string
  position: ConnectionGroupDropPosition
}

interface ConnectionGroupReorderOptions {
  container: () => HTMLElement | null
  onReorder: (
    id: string,
    targetId: string,
    position: ConnectionGroupDropPosition
  ) => void
}

const DRAG_THRESHOLD_PX = 5

/** 分组标题的纵向指针排序，与连接拖拽同样避开 HTML5 drag/drop。 */
export function useConnectionGroupReorder(
  options: ConnectionGroupReorderOptions
) {
  const dragging = shallowRef(false)
  const draggedGroupId = shallowRef('')
  const draggedLabel = shallowRef('')
  const targetGroupId = shallowRef('')
  const targetPosition = shallowRef<ConnectionGroupDropPosition>('before')
  const pointerX = shallowRef(0)
  const pointerY = shallowRef(0)

  let activePointerId = -1
  let startX = 0
  let startY = 0
  let source: ConnectionGroupView | null = null
  let suppressedClickId = ''
  let suppressClickTimer: ReturnType<typeof setTimeout> | undefined

  const dragStyle = computed(() => ({
    left: `${pointerX.value + 14}px`,
    top: `${pointerY.value + 14}px`,
  }))

  function dropTargetAtPoint(x: number, y: number): GroupDropTarget | null {
    const container = options.container()
    if (!container || !source) return null

    const bounds = container.getBoundingClientRect()
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    )
      return null

    const headers = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-reorderable-connection-group-id]'
      ),
    ].filter(
      element =>
        element.dataset.reorderableConnectionGroupId !== source?.id &&
        element.dataset.connectionGroupKind === source?.kind
    )
    if (!headers.length) return null

    const before = headers.find(element => {
      const rect = element.getBoundingClientRect()
      return y < rect.top + rect.height / 2
    })
    if (before)
      return {
        id: before.dataset.reorderableConnectionGroupId ?? '',
        position: 'before',
      }

    const last = headers.at(-1)!
    return {
      id: last.dataset.reorderableConnectionGroupId ?? '',
      position: 'after',
    }
  }

  function updateTarget(target: GroupDropTarget | null): void {
    targetGroupId.value = target?.id ?? ''
    targetPosition.value = target?.position ?? 'before'
  }

  function reset(): void {
    activePointerId = -1
    source = null
    dragging.value = false
    draggedGroupId.value = ''
    draggedLabel.value = ''
    targetGroupId.value = ''
    targetPosition.value = 'before'
  }

  function start(event: PointerEvent, group: ConnectionGroupView): void {
    if (event.button !== 0 || !event.isPrimary) return

    activePointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    pointerX.value = event.clientX
    pointerY.value = event.clientY
    source = group
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture?.(event.pointerId)
  }

  function move(event: PointerEvent): void {
    if (!source || event.pointerId !== activePointerId) return

    pointerX.value = event.clientX
    pointerY.value = event.clientY
    if (!dragging.value) {
      const distance = Math.hypot(
        event.clientX - startX,
        event.clientY - startY
      )
      if (distance < DRAG_THRESHOLD_PX) return

      dragging.value = true
      draggedGroupId.value = source.id
      draggedLabel.value = source.name
    }

    event.preventDefault()
    updateTarget(dropTargetAtPoint(event.clientX, event.clientY))
  }

  function finish(event: PointerEvent): void {
    if (!source || event.pointerId !== activePointerId) return

    const currentSource = source
    const wasDragging = dragging.value
    const target = wasDragging
      ? dropTargetAtPoint(event.clientX, event.clientY)
      : null

    if (wasDragging) {
      suppressedClickId = currentSource.id
      clearTimeout(suppressClickTimer)
      suppressClickTimer = setTimeout(() => {
        suppressedClickId = ''
      }, 0)
    }

    reset()
    if (target?.id)
      options.onReorder(currentSource.id, target.id, target.position)
  }

  function cancel(event?: PointerEvent): void {
    if (event && event.pointerId !== activePointerId) return
    reset()
  }

  function consumeSuppressedClick(groupId: string): boolean {
    if (suppressedClickId !== groupId) return false

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
    draggedGroupId,
    draggedLabel,
    targetGroupId,
    targetPosition,
    dragStyle,
    start,
    consumeSuppressedClick,
  }
}
