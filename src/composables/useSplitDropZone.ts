import { onScopeDispose, reactive, toRefs } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { SplitDirection } from './useSplitPanes'
import { splitDirectionAtPoint } from '@/utils/split-drop'

/** 小于这个位移就当普通点击，避免手抖把单击变成拖拽 */
const DRAG_THRESHOLD_PX = 5

interface SplitDropZoneOptions {
  /** 投放范围。分屏按钮在工具条上，所以这里要给整个分屏组而不是终端输出区 */
  container: () => HTMLElement | null
  /** 拖到某个方向后松手 */
  onDrop: (direction: SplitDirection) => void
}

/**
 * 分屏按钮的「点击即分屏，拖拽选方向」手势。
 *
 * 用 Pointer Events 而非 HTML5 drag：与标签排序（useTabReorder）一致，
 * 避免和 Tauri 的原生文件拖放互相抢事件。
 */
export function useSplitDropZone(options: SplitDropZoneOptions) {
  const state = reactive({
    dragging: false,
    /** 当前高亮的投放方向，指针移出容器时为 null */
    direction: null as SplitDirection | null,
  })

  let activePointerId = -1
  let startX = 0
  let startY = 0
  let armed = false
  let suppressedClick = false
  let suppressTimer: ReturnType<typeof setTimeout> | undefined

  function directionAtPoint(x: number, y: number): SplitDirection | null {
    const container = options.container()
    if (!container) return null

    return splitDirectionAtPoint(x, y, container.getBoundingClientRect())
  }

  function reset(): void {
    armed = false
    activePointerId = -1
    state.dragging = false
    state.direction = null
  }

  function start(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return

    suppressedClick = false
    clearTimeout(suppressTimer)
    activePointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    armed = true
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  function move(event: PointerEvent): void {
    if (!armed || event.pointerId !== activePointerId) return

    if (!state.dragging) {
      const distance = Math.hypot(
        event.clientX - startX,
        event.clientY - startY
      )
      if (distance < DRAG_THRESHOLD_PX) return
      state.dragging = true
    }

    event.preventDefault()
    state.direction = directionAtPoint(event.clientX, event.clientY)
  }

  function finish(event: PointerEvent): void {
    if (!armed || event.pointerId !== activePointerId) return

    const wasDragging = state.dragging
    const direction = wasDragging
      ? directionAtPoint(event.clientX, event.clientY)
      : null

    if (wasDragging) {
      // 拖拽结束后浏览器仍会在按钮上补一次 click，抑制掉以免分屏两次
      suppressedClick = true
      clearTimeout(suppressTimer)
      suppressTimer = setTimeout(() => {
        suppressedClick = false
      }, 0)
    }
    reset()

    // 拖到容器外松手视为放弃，不分屏
    if (wasDragging && direction) options.onDrop(direction)
  }

  function cancel(event?: PointerEvent): void {
    if (event && event.pointerId !== activePointerId) return
    if (state.dragging) {
      suppressedClick = true
      clearTimeout(suppressTimer)
    }
    reset()
  }

  /** 供按钮的 click 处理器询问这次点击是否该忽略 */
  function consumeSuppressedClick(): boolean {
    if (!suppressedClick) return false
    suppressedClick = false
    clearTimeout(suppressTimer)
    return true
  }

  // 省略监听目标，由 VueUse 默认挂到 window：
  // 直接把 window 当实参传，在无 DOM 的单元测试里光求值就会抛错。
  useEventListener('pointermove', move, { passive: false })
  useEventListener('pointerup', finish)
  useEventListener('pointercancel', cancel)
  useEventListener('blur', () => cancel())
  useEventListener('keydown', event => {
    if (event.key === 'Escape') cancel()
  })
  onScopeDispose(() => {
    reset()
    clearTimeout(suppressTimer)
  })

  return { ...toRefs(state), start, consumeSuppressedClick }
}
