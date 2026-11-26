import { nextTick, shallowRef, useTemplateRef } from 'vue'

const MAX_CHARACTERS = 512 * 1024
const MAX_LINES = 4000

/** 单行大输出与密集短行分别限长，保留输入中原有的换行与 Unicode 字符。 */
function tailStart(text: string): number {
  let start = Math.max(0, text.length - MAX_CHARACTERS)
  const first = text.charCodeAt(start)
  if (start && first >= 0xdc00 && first <= 0xdfff) start++
  let cursor = text.endsWith('\n') ? text.length - 1 : text.length
  for (let lines = 0; lines < MAX_LINES; lines++) {
    if (cursor <= start) return start
    cursor = text.lastIndexOf('\n', cursor - 1)
    if (cursor < start) return start
  }
  return cursor + 1
}

/** 测量裁去文本的实际高度，自动折行时也能保留阅读位置。 */
function removedHeight(viewport: HTMLElement, count: number): number {
  const node = viewport.firstChild
  if (!count || node?.nodeType !== 3) return 0
  const range = viewport.ownerDocument.createRange()
  range.setStart(node, 0)
  range.collapse(true)
  const top = range.getBoundingClientRect().top
  range.setStart(node, Math.min(count, node.textContent?.length ?? 0))
  range.collapse(true)
  return Math.max(0, range.getBoundingClientRect().top - top)
}

/** 管理单个日志窗口的有界文本、批量绘制和跟随末尾的阅读位置。 */
export function useContainerLogOutput() {
  const viewport = useTemplateRef<HTMLElement>('logViewport')
  const content = shallowRef('')
  const truncated = shallowRef(false)
  let following = true
  let programmedTop = -1
  let readingTop: number | undefined
  let revision = 0
  let pending = ''
  let pendingTrimmed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  /** 实际滚动才改变跟随状态，程序绘制后的定位不会覆盖用户选择。 */
  function onScroll(): void {
    const view = viewport.value
    if (!view || Math.abs(view.scrollTop - programmedTop) < 1) return
    programmedTop = -1
    readingTop = undefined
    following = view.scrollHeight - view.scrollTop - view.clientHeight <= 24
  }

  /** 快照替换旧文本，后续流片段追加。DOM 绘制后滚动到末尾或恢复原来的阅读位置。 */
  function render(text: string, replace: boolean, dropped = false): void {
    const previous = content.value
    const combined = replace ? text : previous + text
    const cut = tailStart(combined)
    const next = combined.slice(cut)
    const view = viewport.value
    if (view && !following) {
      let removed = cut
      if (replace) {
        const newline = next.indexOf('\n')
        removed =
          newline < 0
            ? 0
            : Math.max(0, previous.indexOf(next.slice(0, newline + 1)))
      }
      readingTop = Math.max(
        0,
        (readingTop ?? view.scrollTop) - removedHeight(view, removed)
      )
    }
    content.value = next
    truncated.value = dropped || cut > 0 || (!replace && truncated.value)
    const current = ++revision
    void nextTick(() => {
      const view = viewport.value
      if (current !== revision || !view) return
      const bottom = Math.max(0, view.scrollHeight - view.clientHeight)
      if (following) view.scrollTop = bottom
      else if (readingTop !== undefined) {
        view.scrollTop = Math.min(bottom, readingTop)
        if (bottom >= readingTop) readingTop = undefined
      }
      programmedTop = view.scrollTop
    })
  }

  /** 提交已收到的片段，手动停止和流结束时也保留最后一批。 */
  function flush(): void {
    clearTimeout(timer)
    timer = undefined
    if (pending) render(pending, pendingTrimmed, pendingTrimmed)
    pending = ''
    pendingTrimmed = false
  }

  /** 每一条新流都从自己的历史开头替换快照，其余输出每 40ms 至多绘制一次。 */
  function write(text: string, replace: boolean): void {
    if (replace) {
      flush()
      render(text, true)
      return
    }
    pending += text
    if (pending.length > MAX_CHARACTERS) {
      pending = pending.slice(-MAX_CHARACTERS)
      if (pending.charCodeAt(0) >= 0xdc00 && pending.charCodeAt(0) <= 0xdfff)
        pending = pending.slice(1)
      pendingTrimmed = true
    }
    timer ??= setTimeout(flush, 40)
  }

  /** 释放旧容器的批量渲染与定位回调，新页面从末尾开始阅读。 */
  function clear(): void {
    clearTimeout(timer)
    timer = undefined
    pending = ''
    pendingTrimmed = false
    ++revision
    following = true
    programmedTop = -1
    readingTop = undefined
    content.value = ''
    truncated.value = false
  }
  return { content, truncated, write, flush, clear, onScroll }
}
