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
    x: number
    y: number
    index: number
    collapse: boolean
    files: SshRemoteFile[]
  } | null = null
  let target: HTMLElement | null = null
  let suppressClick = false

  /** 文件名区域启动传输手势，其他区域继续由列表负责框选。 */
  function start(event: PointerEvent): boolean {
    if (event.button !== 0 || !options.sessionId()) return false
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
      x: event.clientX,
      y: event.clientY,
      index,
      collapse: selected && !modified,
      files,
    }
    options.container.value?.focus({ preventScroll: true })
    return true
  }

  /** 达到阈值后显示拖动预览，并按坐标命中同会话的另一侧目录。 */
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
      options.container.value?.setPointerCapture(event.pointerId)
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
    const hit =
      document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-file-drop-target]') ?? null
    const next =
      hit &&
      hit.dataset.fileSessionId === options.sessionId() &&
      hit.dataset.fileDropTarget !== options.source() &&
      hit.dataset.fileDirectory
        ? hit
        : null
    if (target !== next) {
      target?.removeAttribute('data-file-drag-over')
      target = next
      target?.setAttribute('data-file-drag-over', 'true')
    }
    event.preventDefault()
    return true
  }

  /** 松开后向实际目标发送一批路径，下载和上传仍走现有传输队列。 */
  function finish(event: PointerEvent): boolean {
    if (!gesture || gesture.id !== event.pointerId) return false
    const current = gesture
    const destination = target
    const moved = preview.visible
    const detail: FilePaneDrop = {
      source: options.source(),
      sessionId: options.sessionId() ?? '',
      directory: destination?.dataset.fileDirectory ?? '',
      files: current.files.map(({ path, name, kind }) => ({
        path,
        name,
        kind,
      })),
    }
    cancel()
    if (moved && destination)
      destination.dispatchEvent(new CustomEvent('mirai-file-drop', { detail }))
    else if (!moved && current.collapse) options.select(current.index)
    return true
  }

  /** 取消拖拽并清除捕获和高亮，不触发文件传输。 */
  function cancel(): void {
    const id = gesture?.id
    gesture = null
    preview.visible = false
    target?.removeAttribute('data-file-drag-over')
    target = null
    if (id !== undefined && options.container.value?.hasPointerCapture(id))
      options.container.value.releasePointerCapture(id)
  }

  /** 拖动后的点击不能被当成打开文件或目录的双击。 */
  function consumeClick(event: MouseEvent): void {
    if (!suppressClick) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  onBeforeUnmount(cancel)
  return { preview, start, move, finish, cancel, consumeClick }
}
