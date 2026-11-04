import {
  computed,
  onBeforeUnmount,
  reactive,
  toRefs,
  watch,
  type Ref,
} from 'vue'
import type { SshRemoteFile } from '@/types/ssh'

/** 文件列表的多选与框选；按固定行高计算命中，滚动后仍能选择未挂载的虚拟行。 */
export function useRemoteFileSelection(
  files: Ref<SshRemoteFile[]>,
  selected: Ref<string[]>,
  focused: Ref<string>,
  container: Ref<HTMLElement | null | undefined>,
  update: (paths: string[], focus: string) => void,
  rowHeight: number
) {
  // 响应式状态
  const state = reactive({
    // Shift 连续选择的起点
    anchor: '',
    // 拖动超过阈值后显示的选择框，坐标相对于滚动内容
    box: null as {
      left: number
      top: number
      width: number
      height: number
    } | null,
  })
  const { box } = toRefs(state)
  const selectedSet = computed(() => new Set(selected.value))
  let drag: {
    pointerId: number
    startX: number
    startY: number
    clientX: number
    clientY: number
    base: string[]
    additive: boolean
    moved: boolean
  } | null = null
  let frame = 0

  // 单击、Ctrl/Cmd 切换和 Shift 范围选择共用同一入口，键盘导航也沿用锚点。
  function select(index: number, range = false, toggle = false): void {
    const file = files.value[index]
    if (!file) return
    if (range) {
      const anchor = files.value.findIndex(
        item => item.path === (state.anchor || focused.value)
      )
      const start = anchor < 0 ? index : anchor
      const paths = files.value
        .slice(Math.min(start, index), Math.max(start, index) + 1)
        .map(item => item.path)
      update(
        toggle ? [...new Set([...selected.value, ...paths])] : paths,
        file.path
      )
    } else {
      state.anchor = file.path
      update(
        toggle
          ? selectedSet.value.has(file.path)
            ? selected.value.filter(path => path !== file.path)
            : [...selected.value, file.path]
          : [file.path],
        file.path
      )
    }
  }

  // 鼠标按下时选择行并捕获指针；右键交由文件菜单保留已有多选集合。
  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !container.value) return
    stopDrag()
    const element = container.value
    const rect = element.getBoundingClientRect()
    // 原生滚动条不参与框选，保留拖动滚动条浏览目录的行为。
    if (
      event.clientX - rect.left >= element.clientWidth ||
      event.clientY - rect.top >= element.clientHeight
    )
      return
    const base = [...selected.value]
    const row = (event.target as Element).closest<HTMLElement>(
      '[data-file-index]'
    )
    if (row)
      select(
        Number(row.dataset.fileIndex),
        event.shiftKey,
        event.ctrlKey || event.metaKey
      )
    else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) update([], '')
    element.focus({ preventScroll: true })
    if (event.shiftKey) return
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX - rect.left + element.scrollLeft,
      startY: event.clientY - rect.top + element.scrollTop,
      clientX: event.clientX,
      clientY: event.clientY,
      base,
      additive: event.ctrlKey || event.metaKey,
      moved: false,
    }
  }

  // 根据滚动位置命中所有行，并在鼠标接近列表上下边缘时持续滚动。
  function updateDrag(): void {
    if (!drag || !container.value || !drag.moved) return
    const element = container.value
    const rect = element.getBoundingClientRect()
    const edge = 24
    if (drag.clientY < rect.top + edge)
      element.scrollTop -= Math.min(18, (rect.top + edge - drag.clientY) / 2)
    else if (drag.clientY > rect.bottom - edge)
      element.scrollTop += Math.min(18, (drag.clientY - rect.bottom + edge) / 2)
    const x =
      Math.max(0, Math.min(element.clientWidth, drag.clientX - rect.left)) +
      element.scrollLeft
    const y =
      Math.max(0, Math.min(element.clientHeight, drag.clientY - rect.top)) +
      element.scrollTop
    const left = Math.min(drag.startX, x)
    const top = Math.min(drag.startY, y)
    state.box = {
      left,
      top,
      width: Math.abs(x - drag.startX),
      height: Math.abs(y - drag.startY),
    }
    const first = Math.max(0, Math.floor(top / rowHeight))
    const last = Math.min(
      files.value.length - 1,
      Math.ceil((top + state.box.height) / rowHeight) - 1
    )
    const paths = files.value.slice(first, last + 1).map(file => file.path)
    const selection = drag.additive
      ? [...new Set([...drag.base, ...paths])]
      : paths
    update(selection, paths.at(-1) || selection.at(-1) || '')
    frame = requestAnimationFrame(updateDrag)
  }

  // 移动超过四像素才进入框选，避免普通单击产生选择框。
  function pointerMove(event: PointerEvent): void {
    // 未开始捕获前若在列表外松开鼠标，重新进入列表时先清理旧手势。
    if (event.buttons === 0) {
      stopDrag()
      return
    }
    if (!drag || drag.pointerId !== event.pointerId || !container.value) return
    drag.clientX = event.clientX
    drag.clientY = event.clientY
    const rect = container.value.getBoundingClientRect()
    if (
      !drag.moved &&
      Math.hypot(
        event.clientX - rect.left + container.value.scrollLeft - drag.startX,
        event.clientY - rect.top + container.value.scrollTop - drag.startY
      ) >= 4
    ) {
      drag.moved = true
      // 超过阈值后才捕获指针，让普通单击和原生双击仍落在文件行上。
      container.value.setPointerCapture(event.pointerId)
      updateDrag()
    }
  }

  // 松开、取消指针或离开当前目录时释放捕获和滚动动画。
  function stopDrag(): void {
    cancelAnimationFrame(frame)
    const pointerId = drag?.pointerId
    drag = null
    state.box = null
    if (
      pointerId !== undefined &&
      container.value?.hasPointerCapture(pointerId)
    )
      container.value.releasePointerCapture(pointerId)
  }
  // 目录刷新或筛选变化后撤销旧框选，避免旧行坐标选中新的文件。
  watch(files, () => {
    state.anchor = ''
    stopDrag()
  })
  onBeforeUnmount(stopDrag)
  return { box, selectedSet, select, pointerDown, pointerMove, stopDrag }
}
