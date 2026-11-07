import { computed, shallowRef, type Ref } from 'vue'
import { useStorage } from '@vueuse/core'

/**
 * 记住数据库表格的列宽。列宽按「作用域」分组保存：表浏览器用表名，
 * 查询结果用列名签名，因此重开同一张表或重跑同一条查询都能恢复宽度。
 *
 * 未调整过的表格不写入任何宽度，表格保持浏览器的内容自适应布局；
 * 用户第一次拖动时才把当前实际列宽固化下来并切换为 table-fixed。
 */
const STORAGE_KEY = 'miraihub:database-column-widths'
/** 超过此数量后淘汰最早写入的作用域，避免 localStorage 无限增长。 */
const MAX_SCOPES = 80

export const COLUMN_MIN_WIDTH = 56
export const COLUMN_MAX_WIDTH = 960
/** 无法测量时（例如列尚未渲染）的兜底宽度。 */
const COLUMN_FALLBACK_WIDTH = 160
/** autoFit 时在文本宽度上补的左右内边距与排序图标余量。 */
const AUTO_FIT_PADDING = 34

type ScopedWidths = Record<string, Record<string, number>>

const store = useStorage<ScopedWidths>(STORAGE_KEY, {})
/**
 * 拖动中的列宽只放在内存里，松手时再写回 store：
 * 否则每次 pointermove 都要复制整个 store 并 JSON 序列化写 localStorage。
 * 放在模块级，同一作用域的其他表格也能实时跟随。
 */
const draft = shallowRef<{
  scope: string
  widths: Record<string, number>
} | null>(null)

function clampWidth(value: number): number {
  return Math.min(
    COLUMN_MAX_WIDTH,
    Math.max(COLUMN_MIN_WIDTH, Math.round(value))
  )
}

/** 用列名签名作为作用域，让形状相同的结果集共用一套列宽。 */
export function columnsScope(prefix: string, names: string[]): string {
  if (!names.length) return ''
  let hash = 0
  for (const char of names.join('\0'))
    hash = (hash * 31 + char.codePointAt(0)!) | 0
  return `${prefix}:${names.length}:${(hash >>> 0).toString(36)}`
}

function write(scope: string, widths: Record<string, number>): void {
  const next: ScopedWidths = { ...store.value }
  if (Object.keys(widths).length) next[scope] = widths
  else delete next[scope]
  const scopes = Object.keys(next)
  for (const stale of scopes.slice(0, Math.max(0, scopes.length - MAX_SCOPES)))
    delete next[stale]
  store.value = next
}

/** 用 canvas 量一列里最宽的单元格文本，供双击自适应使用。 */
function measureColumnContent(
  table: HTMLTableElement,
  index: number
): number | null {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  const header = table.querySelectorAll('thead th')[index]
  if (!header) return null
  const style = getComputedStyle(header)
  const body = table.querySelector('tbody')
  const bodyStyle = body ? getComputedStyle(body) : style
  let widest = 0

  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  widest = context.measureText(header.textContent?.trim() ?? '').width
  context.font = `${bodyStyle.fontWeight} ${bodyStyle.fontSize} ${bodyStyle.fontFamily}`
  for (const row of table.querySelectorAll('tbody tr')) {
    const cell = row.children[index]
    if (!cell) continue
    widest = Math.max(
      widest,
      context.measureText(cell.textContent?.trim() ?? '').width
    )
  }
  return widest + AUTO_FIT_PADDING
}

export function useDatabaseColumnWidths(scope: Ref<string>) {
  const widths = computed<Record<string, number>>(() => {
    if (!scope.value) return {}
    if (draft.value?.scope === scope.value) return draft.value.widths
    return store.value[scope.value] || {}
  })
  /** 有任何一列被调整过时才切到 table-fixed + colgroup。 */
  const resized = computed(() => Object.keys(widths.value).length > 0)

  function widthOf(name: string): number {
    return widths.value[name] ?? COLUMN_FALLBACK_WIDTH
  }

  function setWidth(name: string, value: number): void {
    if (!scope.value) return
    write(scope.value, { ...widths.value, [name]: clampWidth(value) })
  }

  /** 量出所有列的当前实际宽度，供首次调整时固化，避免切到 fixed 后跳动。 */
  function measureCurrentWidths(
    table: HTMLTableElement
  ): Record<string, number> {
    const frozen: Record<string, number> = {}
    for (const cell of table.querySelectorAll<HTMLElement>('th[data-column]')) {
      const name = cell.dataset.column
      if (name) frozen[name] = clampWidth(cell.getBoundingClientRect().width)
    }
    return frozen
  }

  /** 首次调整前把所有列的当前实际宽度写下来。 */
  function freezeCurrentWidths(table: HTMLTableElement): void {
    if (resized.value || !scope.value) return
    write(scope.value, measureCurrentWidths(table))
  }

  function beginResize(name: string, event: PointerEvent): void {
    const grip = event.currentTarget as HTMLElement | null
    const table = grip?.closest('table')
    if (event.button !== 0 || !grip || !table || !scope.value) return

    // 表头本身可能绑定了排序，拖动不应触发它。
    event.preventDefault()
    event.stopPropagation()

    const { pointerId } = event
    const dragScope = scope.value
    // 首次拖动的固化宽度也先进草稿，与拖动结果一起在松手时写入。
    const base = resized.value
      ? { ...widths.value }
      : measureCurrentWidths(table)
    draft.value = { scope: dragScope, widths: base }
    const startX = event.clientX
    const startWidth =
      base[name] ??
      table
        .querySelector<HTMLElement>(`th[data-column="${CSS.escape(name)}"]`)
        ?.getBoundingClientRect().width ??
      COLUMN_FALLBACK_WIDTH
    let latestX = startX
    let frame = 0

    // 每帧只按最后一次指针位置更新草稿。
    const apply = (): void => {
      frame = 0
      draft.value = {
        scope: dragScope,
        widths: { ...base, [name]: clampWidth(startWidth + latestX - startX) },
      }
    }
    const move = (moved: PointerEvent): void => {
      if (moved.pointerId !== pointerId) return
      latestX = moved.clientX
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const stop = (ended: PointerEvent): void => {
      if (ended.pointerId !== pointerId) return
      if (frame) {
        cancelAnimationFrame(frame)
        apply()
      }
      if (draft.value?.scope === dragScope) write(dragScope, draft.value.widths)
      draft.value = null
      document.body.classList.remove('app-resizing-columns')
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', stop)
      grip.removeEventListener('pointercancel', stop)
      grip.removeEventListener('lostpointercapture', stop)
    }

    grip.setPointerCapture(pointerId)
    document.body.classList.add('app-resizing-columns')
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', stop)
    grip.addEventListener('pointercancel', stop)
    grip.addEventListener('lostpointercapture', stop)
  }

  /** 双击分隔线：把该列收放到刚好容纳内容的宽度。 */
  function autoFit(name: string, event: MouseEvent): void {
    const grip = event.currentTarget as HTMLElement | null
    const table = grip?.closest('table')
    if (!table || !scope.value) return
    event.stopPropagation()

    const headers = [...table.querySelectorAll<HTMLElement>('thead th')]
    const index = headers.findIndex(cell => cell.dataset.column === name)
    if (index < 0) return
    freezeCurrentWidths(table)
    const content = measureColumnContent(table, index)
    if (content !== null) setWidth(name, content)
  }

  function resetWidths(): void {
    if (scope.value) write(scope.value, {})
  }

  function keyboardResize(name: string, event: KeyboardEvent): void {
    const step = event.shiftKey ? 32 : 8
    const current = widthOf(name)
    const grip = event.currentTarget as HTMLElement | null
    const table = grip?.closest('table')
    let next = current

    if (event.key === 'ArrowLeft') next = current - step
    else if (event.key === 'ArrowRight') next = current + step
    else if (event.key === 'Home') next = COLUMN_MIN_WIDTH
    else if (event.key === 'End') next = COLUMN_MAX_WIDTH
    else return

    event.preventDefault()
    if (table) freezeCurrentWidths(table)
    setWidth(name, next)
  }

  return {
    resized,
    widths,
    widthOf,
    beginResize,
    autoFit,
    keyboardResize,
    resetWidths,
  }
}
