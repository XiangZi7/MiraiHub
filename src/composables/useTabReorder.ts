import { computed, onScopeDispose, shallowRef } from 'vue'
import { useEventListener, useRafFn } from '@vueuse/core'

interface ReorderableTab {
  id: string
}

type DropPosition = 'before' | 'after'

export interface TabDragEvent {
  id: string
  clientX: number
  clientY: number
}

interface TabReorderOptions<T extends ReorderableTab> {
  tabs: () => readonly T[]
  container: () => HTMLElement | null
  axis?: 'horizontal' | 'vertical'
  handle?: string
  onReorder: (fromIndex: number, toIndex: number) => void
  onDragMove?: (drag: TabDragEvent) => void
  onDrop?: (drag: TabDragEvent) => void
  onDragEnd?: () => void
}

interface DropTarget {
  id: string
  position: DropPosition
}

const DRAG_THRESHOLD_PX = 5

/**
 * 标签栏及纵向列表的指针拖拽排序。
 *
 * 与侧栏连接拖拽一样使用 Pointer Events，避免 HTML5 drag/drop 与
 * Tauri 原生文件拖放互相抢事件。排序状态仍由标签所属的父组件持有。
 */
export function useTabReorder<T extends ReorderableTab>(
  options: TabReorderOptions<T>
) {
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

  const vertical = options.axis === 'vertical'
  const autoScroll = useRafFn(
    ({ delta }) => {
      const container = options.container()
      if (!container) return
      const bounds = container.getBoundingClientRect()
      if (pointerX.value < bounds.left || pointerX.value > bounds.right) return
      const edge = Math.min(32, bounds.height / 4)
      const y = pointerY.value
      if (y < bounds.top || y > bounds.bottom) return
      const speed =
        y < bounds.top + edge
          ? -1 + (y - bounds.top) / edge
          : y > bounds.bottom - edge
            ? 1 - (bounds.bottom - y) / edge
            : 0
      const previous = container.scrollTop
      container.scrollTop += speed * Math.min(delta, 32) * 0.5
      if (container.scrollTop !== previous)
        updateTarget(dropTargetAtPoint(pointerX.value, y))
    },
    { immediate: false }
  )

  const dragStyle = computed(() => ({
    left: `${pointerX.value + 14}px`,
    top: `${pointerY.value + 14}px`,
  }))

  function directTargetAtPoint(
    x: number,
    y: number,
    container: HTMLElement
  ): DropTarget | null {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-reorderable-tab-id]')
    if (!element || !container.contains(element)) return null

    const id = element.dataset.reorderableTabId
    if (!id) return null
    const rect = element.getBoundingClientRect()
    const before = vertical
      ? y < rect.top + rect.height / 2
      : x < rect.left + rect.width / 2
    return { id, position: before ? 'before' : 'after' }
  }

  function nearestTargetAtPoint(
    x: number,
    y: number,
    container: HTMLElement
  ): DropTarget | null {
    const bounds = container.getBoundingClientRect()
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    )
      return null

    const elements = [
      ...container.querySelectorAll<HTMLElement>('[data-reorderable-tab-id]'),
    ]
    if (!elements.length) return null

    for (const element of elements) {
      const rect = element.getBoundingClientRect()
      if (
        vertical
          ? y < rect.top + rect.height / 2
          : x < rect.left + rect.width / 2
      )
        return {
          id: element.dataset.reorderableTabId ?? '',
          position: 'before',
        }
    }

    const last = elements[elements.length - 1]
    return last
      ? { id: last.dataset.reorderableTabId ?? '', position: 'after' }
      : null
  }

  function dropTargetAtPoint(x: number, y: number): DropTarget | null {
    const container = options.container()
    if (!container) return null
    return (
      directTargetAtPoint(x, y, container) ??
      nearestTargetAtPoint(x, y, container)
    )
  }

  function reset(): void {
    autoScroll.pause()
    const wasDragging = dragging.value
    activePointerId = -1
    sourceId = ''
    dragging.value = false
    draggedId.value = ''
    targetId.value = ''
    targetPosition.value = ''
    if (wasDragging) options.onDragEnd?.()
  }

  function start(event: PointerEvent, id: string): void {
    if (event.button !== 0 || !event.isPrimary) return
    if ((event.target as HTMLElement).closest('[data-tab-action]')) return
    // 显式指定手柄时允许按钮作为拖拽起点；其他复用方仍保留表单控件的原生交互。
    if (options.handle) {
      if (!(event.target as HTMLElement).closest(options.handle)) return
    } else if (
      (event.target as HTMLElement).closest(
        'input, textarea, select, button, label'
      )
    )
      return

    suppressedClickId = ''
    clearTimeout(suppressClickTimer)
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
      const distance = Math.hypot(
        event.clientX - startX,
        event.clientY - startY
      )
      if (distance < DRAG_THRESHOLD_PX) return
      dragging.value = true
      draggedId.value = sourceId
      if (vertical) autoScroll.resume()
    }

    event.preventDefault()
    options.onDragMove?.({
      id: sourceId,
      clientX: event.clientX,
      clientY: event.clientY,
    })
    updateTarget(dropTargetAtPoint(event.clientX, event.clientY))
  }

  function updateTarget(target: DropTarget | null): void {
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
    const target = wasDragging
      ? dropTargetAtPoint(event.clientX, event.clientY)
      : null

    if (wasDragging) {
      suppressedClickId = currentSourceId
      clearTimeout(suppressClickTimer)
      suppressClickTimer = setTimeout(() => {
        suppressedClickId = ''
      }, 0)
    }

    if (wasDragging)
      options.onDrop?.({
        id: currentSourceId,
        clientX: event.clientX,
        clientY: event.clientY,
      })
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
    if (dragging.value) {
      suppressedClickId = sourceId
      clearTimeout(suppressClickTimer)
    }
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

  useEventListener('pointermove', move, { passive: false })
  useEventListener('pointerup', finish)
  useEventListener('pointercancel', cancel)
  useEventListener('blur', () => cancel())
  useEventListener('keydown', event => {
    if (event.key === 'Escape') cancel()
  })
  onScopeDispose(() => {
    reset()
    clearTimeout(suppressClickTimer)
  })

  return {
    dragging,
    draggedId,
    targetId,
    targetPosition,
    dragStyle,
    start,
    cancel,
    consumeSuppressedClick,
    moveByKeyboard,
  }
}
