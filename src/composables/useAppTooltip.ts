import { nextTick, onBeforeUnmount, onMounted, reactive, readonly } from 'vue'
import type { CSSProperties, Ref } from 'vue'
import { useEventListener, useResizeObserver, useTimeoutFn } from '@vueuse/core'
import { startNativeTooltipBridge } from '@/utils/native-tooltip-bridge'
import { tooltipPosition } from '@/utils/tooltip-position'

/** 触发区超过这个宽度就跟随光标：再宽的行居中会把气泡甩到离光标很远的地方。 */
const ANCHOR_MAX_WIDTH = 160

/** 每个窗口只挂一个气泡，通过事件委托接管已有 title 与显式 data-tooltip。 */
export function useAppTooltip(
  bubble: Ref<HTMLElement | null>,
  tooltipId: string
) {
  // 响应式状态
  const state = reactive({
    // 当前提示文案。
    content: '',
    // 标签页的结构化连接字段，普通文字提示保持为空。
    details: [] as { label: string; value: string }[],
    // 气泡是否打开。
    open: false,
    // 完成测量后才显示。
    positioned: false,
    // 根据窗口边缘调整后的方向。
    side: 'bottom' as 'top' | 'bottom',
    // 气泡坐标及尺寸限制。
    style: {} as CSSProperties,
  })
  let active: Element | null = null
  let dismissed: Element | null = null
  let mode: 'pointer' | 'focus' = 'pointer'
  let pointer = { x: 0, y: 0 }
  let frame = 0
  let stopBridge: (() => void) | undefined

  function contentOf(element: Element): string {
    return (
      element.getAttribute('data-tooltip') ??
      element.getAttribute('data-native-tooltip') ??
      ''
    ).trim()
  }

  /** 读取标签提供的字段表，只接受文本键值，避免异常属性破坏全局提示。 */
  function detailsOf(element: Element): { label: string; value: string }[] {
    try {
      const rows: unknown = JSON.parse(
        element.getAttribute('data-tooltip-details') || '[]'
      )
      return Array.isArray(rows)
        ? rows
            .filter(
              (row): row is { label: string; value: string } =>
                row &&
                typeof row.label === 'string' &&
                typeof row.value === 'string'
            )
            .slice(0, 12)
        : []
    } catch {
      return []
    }
  }

  function targetOf(target: EventTarget | null): Element | null {
    const element =
      target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null
    if (!element || bubble.value?.contains(element)) return null
    const trigger = element.closest(
      '[data-tooltip], [data-native-tooltip], [title]'
    )
    return trigger && contentOf(trigger) ? trigger : null
  }

  function describe(element: Element, attach: boolean): void {
    const ids = (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(id => id && id !== tooltipId)
    if (attach) ids.push(tooltipId)
    if (ids.length) element.setAttribute('aria-describedby', ids.join(' '))
    else element.removeAttribute('aria-describedby')
  }

  function windowScale(): number {
    return (
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--preview-zoom'
        )
      ) || 1
    )
  }

  function updatePosition(): void {
    if (!state.open || !active?.isConnected || !bubble.value) return
    const rect = active.getBoundingClientRect()
    const scale = windowScale()
    /**
     * 窄控件（图标按钮、标签页）锚到自身下方居中，箭头才对得准，
     * 位置也不会随光标微动而漂移；
     * 宽触发区（表格行、长列表项）居中会把气泡甩到离光标很远的行中央，仍跟随光标。
     * 键盘焦点没有光标可用，一律锚元素。
     */
    const anchored = mode === 'focus' || rect.width <= ANCHOR_MAX_WIDTH
    const result = tooltipPosition(
      anchored
        ? { x: (rect.left + rect.right) / 2, y: rect.bottom, top: rect.top }
        : pointer,
      bubble.value.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight, scale }
    )
    state.side = result.side
    state.style = {
      left: `${result.left}px`,
      top: `${result.top}px`,
      maxWidth: `${Math.min(320, (window.innerWidth - 16) / scale)}px`,
      '--tooltip-arrow-x': `${result.arrowX}px`,
    }
    state.positioned = true
  }

  function queuePosition(): void {
    if (frame || !state.open) return
    frame = requestAnimationFrame(() => {
      frame = 0
      updatePosition()
    })
  }

  async function show(): Promise<void> {
    if (!active?.isConnected || !state.content) return
    state.style = {
      ...state.style,
      maxWidth: `${Math.min(320, (window.innerWidth - 16) / windowScale())}px`,
    }
    state.open = true
    state.positioned = false
    describe(active, true)
    await nextTick()
    updatePosition()
  }

  const {
    start: startShow,
    stop: stopShow,
    isPending,
  } = useTimeoutFn(show, 350, { immediate: false })
  const {
    start: startHide,
    stop: stopHide,
    isPending: hidePending,
  } = useTimeoutFn(hide, 120, {
    immediate: false,
  })

  /** 隐藏气泡时清空字段表和可访问关联，避免下一个普通提示残留连接信息。 */
  function hide(): void {
    stopShow()
    stopHide()
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (active) describe(active, false)
    active = null
    state.open = false
    state.positioned = false
    state.content = ''
    state.details = []
  }

  /** 鼠标或键盘进入控件后读取提示文本与连接字段，沿用统一的延迟显示和定位。 */
  function activate(
    element: Element | null,
    source: 'pointer' | 'focus'
  ): void {
    if (element && dismissed === element) return
    dismissed = null
    if (!element) {
      if (source === 'pointer' && state.open) {
        stopShow()
        if (!hidePending.value) startHide()
      } else hide()
      return
    }
    stopHide()
    if (active !== element) {
      hide()
      active = element
    }
    mode = source
    state.content = contentOf(element)
    state.details = detailsOf(element)
    if (state.open) queuePosition()
    else if (source === 'focus') void show()
    else if (!isPending.value) startShow()
  }

  function pointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') return
    if (event.target instanceof Node && bubble.value?.contains(event.target)) {
      stopHide()
      return
    }
    pointer = { x: event.clientX, y: event.clientY }
    activate(targetOf(event.target), 'pointer')
  }

  function dismiss(event?: Event): void {
    dismissed = active ?? targetOf(event?.target ?? null)
    hide()
  }

  useEventListener(document, ['pointerover', 'pointermove'], pointerMove, {
    passive: true,
  })
  useEventListener(document, 'pointerout', event => {
    const next = event.relatedTarget
    if (next instanceof Node && bubble.value?.contains(next)) {
      stopHide()
      return
    }
    if (dismissed && (!(next instanceof Node) || !dismissed.contains(next)))
      dismissed = null
    if (active && next instanceof Node && active.contains(next)) return
    stopShow()
    startHide()
  })
  useEventListener(document, 'focusin', event =>
    activate(targetOf(event.target), 'focus')
  )
  useEventListener(document, 'focusout', event => {
    if (
      mode === 'focus' &&
      !(
        event.relatedTarget instanceof Node &&
        bubble.value?.contains(event.relatedTarget)
      )
    )
      hide()
  })
  useEventListener(document, ['pointerdown', 'contextmenu'], dismiss, {
    capture: true,
  })
  useEventListener(
    document,
    'keydown',
    event => {
      if (
        ['Escape', 'Tab', 'Enter', ' '].includes(event.key) ||
        event.key.startsWith('Arrow')
      )
        dismiss(event)
    },
    { capture: true }
  )
  useEventListener(window, ['resize', 'blur'], () => hide())
  useEventListener(
    window,
    'scroll',
    event => {
      if (!(
        event.target instanceof Node && bubble.value?.contains(event.target)
      ))
        hide()
    },
    { capture: true, passive: true }
  )
  useResizeObserver(bubble, queuePosition)

  onMounted(() => {
    stopBridge = startNativeTooltipBridge(document.body, () => {
      if (!active) return
      const content = contentOf(active)
      if (!active.isConnected || !content) hide()
      else {
        state.content = content
        state.details = detailsOf(active)
        queuePosition()
      }
    })
  })
  onBeforeUnmount(() => {
    hide()
    stopBridge?.()
  })

  return { state: readonly(state), enter: stopHide, leave: startHide }
}
