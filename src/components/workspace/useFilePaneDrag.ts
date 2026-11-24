import { onBeforeUnmount, reactive, type Ref } from 'vue'
import type { SshRemoteFile } from '@/types/ssh'

export interface FilePaneDrop {
  source: 'local' | 'remote'
  sessionId: string
  directory: string
  files: Pick<SshRemoteFile, 'path' | 'name' | 'kind'>[]
}

/** 内部双栏使用指针拖拽，避免 Windows 原生文件拖放拦截 HTML5 drag 事件。 */
export function useFilePaneDrag(options: {
  source: () => 'local' | 'remote'
  sessionId: () => string | undefined
  files: () => SshRemoteFile[]
  selection: () => string[]
  container: Ref<HTMLElement | null | undefined>
  select: (index: number, range?: boolean, toggle?: boolean) => void
}) {
  const preview = reactive({ visible: false, x: 0, y: 0, count: 0, name: '' })
  let gesture: {
    id: number
    sessionId: string
    x: number
    y: number
    index: number
    collapse: boolean
    files: SshRemoteFile[]
  } | null = null
  let listeners: AbortController | undefined
  let target: HTMLElement | null = null
  let suppressClick = false

  /** 文件名区域启动传输手势，其他区域继续由列表负责框选。 */
  function start(event: PointerEvent): boolean {
    if (event.button !== 0) return false
    suppressClick = false
    const sessionId = options.sessionId()
    if (!sessionId) return false
    const row = (event.target as Element)
      .closest<HTMLElement>('[data-file-drag-handle]')
      ?.closest<HTMLElement>('[data-file-index]')
    if (!row) return false
    cancel()
    const index = Number(row.dataset.fileIndex)
    const file = options.files()[index]
    if (!file) return false
    const modified = event.ctrlKey || event.metaKey || event.shiftKey
    const selected = options.selection().includes(file.path)
    if (modified || !selected)
      options.select(index, event.shiftKey, event.ctrlKey || event.metaKey)
    const paths = options.selection()
    // 父组件的 props 更新在下一帧生效；单选起拖时直接保留点击的文件。
    const files =
      modified || !selected
        ? [file]
        : options.files().filter(item => paths.includes(item.path))
    gesture = {
      id: event.pointerId,
      sessionId,
      x: event.clientX,
      y: event.clientY,
      index,
      collapse: selected && !modified,
      files,
    }
    // 同一个手势跨越两栏时，用窗口事件保持跟踪，避免离开列表后丢失指针。
    listeners = new AbortController()
    const eventOptions = { capture: true, signal: listeners.signal }
    window.addEventListener('pointermove', move, eventOptions)
    window.addEventListener('pointerup', finish, eventOptions)
    window.addEventListener('pointercancel', cancel, eventOptions)
    window.addEventListener('blur', cancel, { signal: listeners.signal })
    options.container.value?.focus({ preventScroll: true })
    return true
  }

  /** 命中其他 SSH 面板时可投到当前目录或子目录，本地栏和终端沿用会话匹配。 */
  function destinationAt(event: PointerEvent): HTMLElement | null {
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const hit = element?.closest<HTMLElement>('[data-file-drop-target]')
    const sessionId = gesture?.sessionId
    if (
      !sessionId ||
      sessionId !== options.sessionId() ||
      !hit?.dataset.fileSessionId
    )
      return null
    const source = options.source()
    const targetKind = hit.dataset.fileDropTarget
    if (hit.dataset.fileSessionId !== sessionId) {
      if (
        source !== 'remote' ||
        targetKind !== 'remote' ||
        !hit.dataset.fileDirectory
      )
        return null
      return (
        element?.closest<HTMLElement>('[data-remote-drop-directory]') ?? hit
      )
    }
    if (targetKind === 'terminal')
      return hit.dataset.fileTerminalSource === source ? hit : null
    return targetKind !== source && hit.dataset.fileDirectory ? hit : null
  }

  /** 达到阈值后显示拖动预览，并高亮当前命中的目录或终端。 */
  function move(event: PointerEvent): boolean {
    if (!gesture || gesture.id !== event.pointerId) return false
    if (!event.buttons) {
      cancel()
      return true
    }
    if (
      !preview.visible &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6
    )
      return true
    if (!preview.visible) {
      preview.visible = true
      suppressClick = true
      const selected = options
        .files()
        .filter(file => options.selection().includes(file.path))
      if (selected.some(file => file.path === gesture!.files[0]?.path))
        gesture.files = selected
    }
    preview.x = event.clientX + 14
    preview.y = event.clientY + 14
    preview.count = gesture.files.length
    preview.name = gesture.files[0]?.name ?? ''
    const next = destinationAt(event)
    if (target !== next) {
      target?.removeAttribute('data-file-drag-over')
      target = next
      target?.setAttribute('data-file-drag-over', 'true')
    }
    event.preventDefault()
    return true
  }

  /** 松开时重新命中目标，将选中的路径交给文件面板或终端。 */
  function finish(event: PointerEvent): boolean {
    if (!gesture || gesture.id !== event.pointerId) return false
    const current = gesture
    const moved = preview.visible
    const destination = moved ? destinationAt(event) : null
    const detail: FilePaneDrop = {
      source: options.source(),
      sessionId: current.sessionId,
      directory:
        destination?.dataset.remoteDropDirectory ??
        destination?.dataset.fileDirectory ??
        '',
      files: current.files.map(({ path, name, kind }) => ({
        path,
        name,
        kind,
      })),
    }
    cancel()
    if (moved && destination)
      destination.dispatchEvent(
        new CustomEvent('mirai-file-drop', { detail, bubbles: true })
      )
    else if (!moved && current.collapse) options.select(current.index)
    return true
  }

  /** 取消拖拽并注销本次手势监听，清除文件预览和目标高亮。 */
  function cancel(): void {
    listeners?.abort()
    listeners = undefined
    gesture = null
    preview.visible = false
    target?.removeAttribute('data-file-drag-over')
    target = null
  }

  /** 拖动后的点击不能被当成打开文件或目录的双击。 */
  function consumeClick(event: MouseEvent): void {
    if (!suppressClick) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  onBeforeUnmount(cancel)
  return { preview, start, cancel, consumeClick }
}
