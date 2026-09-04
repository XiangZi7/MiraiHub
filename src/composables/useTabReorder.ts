import { computed, shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'

interface ReorderableTab {
  id: string
}

type DropPosition = 'before' | 'after'

interface TabReorderOptions<T extends ReorderableTab> {
  tabs: () => readonly T[]
  container: () => HTMLElement | null
  onReorder: (fromIndex: number, toIndex: number) => void
}

interface DropTarget {
  id: string
  position: DropPosition
}

const DRAG_THRESHOLD_PX = 5

/**
 * 标签栏的指针拖拽排序。
 *
 * 与侧栏连接拖拽一样使用 Pointer Events，避免 HTML5 drag/drop 与
 * Tauri 原生文件拖放互相抢事件。排序状态仍由标签所属的父组件持有。
 */
export function useTabReorder<T extends ReorderableTab>(options: TabReorderOptions<T>) {
  const dragging = shallowRef(false)
  const draggedId = shallowRef('')
  const targetId = shallowRef('')
  const targetPosition = shallowRef<DropPosition | ''>('')
  const pointerX = shallowRef(0)
  const pointerY = shallowRef(0)

  let activePointerId = -1
  let startX = 0
  let startY = 0
  let sourceId = ''
  let suppressedClickId = ''
  let suppressClickTimer: ReturnType<typeof setTimeout> | undefined

  const dragStyle = computed(() => ({
    left: `${pointerX.value + 14}px`,
    top: `${pointerY.value + 14}px`,
  }))

  function directTargetAtPoint(x: number, y: number, container: HTMLElement): DropTarget | null {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorderable-tab-id]')
    if (!element || !container.contains(element)) return null

    const id = element.dataset.reorderableTabId
    if (!id) return null
    const rect = element.getBoundingClientRect()
    return { id, position: x < rect.left + rect.width / 2 ? 'before' : 'after' }
  }

  function nearestTargetAtPoint(x: number, y: number, container: HTMLElement): DropTarget | null {
    const bounds = container.getBoundingClientRect()
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null

    const elements = [...container.querySelectorAll<HTMLElement>('[data-reorderable-tab-id]')]
    if (!elements.length) return null

    for (const element of elements) {
      const rect = element.getBoundingClientRect()
      if (x < rect.left + rect.width / 2)
        return { id: element.dataset.reorderableTabId ?? '', position: 'before' }
    }

    const last = elements[elements.length - 1]
    return last ? { id: last.dataset.reorderableTabId ?? '', position: 'after' } : null
  }

  function dropTargetAtPoint(x: number, y: number): DropTarget | null {
    const container = options.container()
    if (!container) return null
    return directTargetAtPoint(x, y, container) ?? nearestTargetAtPoint(x, y, container)
  }

  function reset(): void {
    activePointerId = -1
    sourceId = ''
    dragging.value = false
    draggedId.value = ''
    targetId.value = ''
    targetPosition.value = ''
  }

  function start(event: PointerEvent, id: string): void {
    if (event.button !== 0 || !event.isPrimary) return
    if ((event.target as HTMLElement).closest('[data-tab-action]')) return

    activePointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    pointerX.value = event.clientX
    pointerY.value = event.clientY
    sourceId = id
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  function move(event: PointerEvent): void {
    if (!sourceId || event.pointerId !== activePointerId) return

    pointerX.value = event.clientX
    pointerY.value = event.clientY

    if (!dragging.value) {
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY)
      if (distance < DRAG_THRESHOLD_PX) return
      dragging.value = true
      draggedId.value = sourceId
    }

    event.preventDefault()
    const target = dropTargetAtPoint(event.clientX, event.clientY)
    if (!target || target.id === sourceId) {
      targetId.value = ''
      targetPosition.value = ''
      return
    }
    targetId.value = target.id
    targetPosition.value = target.position
  }

  function finish(event: PointerEvent): void {
    if (!sourceId || event.pointerId !== activePointerId) return

    const currentSourceId = sourceId
    const wasDragging = dragging.value
    const target = wasDragging ? dropTargetAtPoint(event.clientX, event.clientY) : null

    if (wasDragging) {
      suppressedClickId = currentSourceId
      clearTimeout(suppressClickTimer)
      suppressClickTimer = setTimeout(() => {
        suppressedClickId = ''
      }, 0)
    }

    reset()
    if (!target || target.id === currentSourceId) return

    const tabs = options.tabs()
    const fromIndex = tabs.findIndex(tab => tab.id === currentSourceId)
    const targetIndex = tabs.findIndex(tab => tab.id === target.id)
    if (fromIndex < 0 || targetIndex < 0) return

    let toIndex = targetIndex + (target.position === 'after' ? 1 : 0)
    if (fromIndex < toIndex) toIndex -= 1
    if (fromIndex !== toIndex) options.onReorder(fromIndex, toIndex)
  }

  function cancel(event?: PointerEvent): void {
    if (event && event.pointerId !== activePointerId) return
    reset()
  }

  function consumeSuppressedClick(id: string): boolean {
    if (suppressedClickId !== id) return false
    suppressedClickId = ''
    clearTimeout(suppressClickTimer)
    return true
  }

  function moveByKeyboard(id: string, direction: -1 | 1): void {
    const fromIndex = options.tabs().findIndex(tab => tab.id === id)
    const toIndex = fromIndex + direction
    if (fromIndex < 0 || toIndex < 0 || toIndex >= options.tabs().length) return
    options.onReorder(fromIndex, toIndex)
  }

  useEventListener(window, 'pointermove', move, { passive: false })
  useEventListener(window, 'pointerup', finish)
  useEventListener(window, 'pointercancel', cancel)
  useEventListener(window, 'blur', () => cancel())

  return {
    dragging,
    draggedId,
    targetId,
    targetPosition,
    dragStyle,
    start,
    consumeSuppressedClick,
    moveByKeyboard,
  }
}
