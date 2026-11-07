import { computed, nextTick, shallowRef, type Ref } from 'vue'
import { useEventListener, useStorage } from '@vueuse/core'
import { gridTsv, type GridRange } from '@/utils/database-grid'

export interface GridPosition {
  row: number
  column: number
}

export type GridDensity = 'compact' | 'standard' | 'comfortable'

const DENSITIES: readonly GridDensity[] = [
  'compact',
  'standard',
  'comfortable',
]
const density = useStorage<GridDensity>(
  'miraihub:database-grid-density',
  'standard'
)
const DENSITY_ICONS: Record<GridDensity, string> = {
  compact: 'lucide:rows-4',
  standard: 'lucide:rows-3',
  comfortable: 'lucide:rows-2',
}

/** 网格密度全局共用一份设置，表数据与查询结果保持一致。 */
export function useGridDensity() {
  return {
    density,
    densityIcon: computed(() => DENSITY_ICONS[density.value]),
    cycleDensity(): void {
      const index = DENSITIES.indexOf(density.value)
      density.value = DENSITIES[(index + 1) % DENSITIES.length] ?? 'standard'
    },
  }
}

const IGNORED_TARGETS =
  'input,textarea,select,button,th,[contenteditable="true"],[role="dialog"]'

/**
 * 表格单元格选区：鼠标点选/拖选、键盘导航和选区统计。
 *
 * 事件都委托在滚动容器上，靠 `tr[data-row-index]`、`td[data-col]`、`td[data-row-header]`
 * 定位单元格，行组件不需要逐格绑定监听。锚点是活动单元格，head 是框选的另一端。
 */
export function useGridSelection(options: {
  container: Readonly<Ref<HTMLElement | null>>
  rowCount: () => number
  columnCount: () => number
  valueAt: (row: number, column: number) => string | null
  numericColumn: (column: number) => boolean
  /** 把行滚进可视区；虚拟滚动的表格需要先算出位置，该行才会被渲染。 */
  revealRow?: (row: number) => void
  copy: (text: string) => void
  edit?: (position: GridPosition) => void
  clearCells?: (range: GridRange) => void
}) {
  const anchor = shallowRef<GridPosition | null>(null)
  const head = shallowRef<GridPosition | null>(null)
  let dragging: 'cell' | 'row' | null = null

  const range = computed<GridRange | null>(() => {
    if (!anchor.value || !head.value) return null
    return {
      top: Math.min(anchor.value.row, head.value.row),
      bottom: Math.max(anchor.value.row, head.value.row),
      left: Math.min(anchor.value.column, head.value.column),
      right: Math.max(anchor.value.column, head.value.column),
    }
  })

  /** 只有落在选区内的行拿到非空值，选区变化时其他行不会重绘。 */
  function rowSelection(row: number): GridRange | null {
    const current = range.value
    return current && row >= current.top && row <= current.bottom
      ? current
      : null
  }

  function activeColumn(row: number): number | null {
    return anchor.value?.row === row ? anchor.value.column : null
  }

  function contains(position: GridPosition): boolean {
    const current = range.value
    return Boolean(
      current &&
      position.row >= current.top &&
      position.row <= current.bottom &&
      position.column >= current.left &&
      position.column <= current.right
    )
  }

  function reveal(position: GridPosition): void {
    options.revealRow?.(position.row)
    void nextTick(() => {
      options.container.value
        ?.querySelector(
          `tr[data-row-index="${position.row}"] td[data-col="${position.column}"]`
        )
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }

  function select(position: GridPosition, scroll = false): void {
    anchor.value = position
    head.value = position
    if (scroll) reveal(position)
  }

  function extendTo(position: GridPosition, scroll = false): void {
    if (!anchor.value) anchor.value = position
    head.value = position
    if (scroll) reveal(position)
  }

  function selectAll(): void {
    const rows = options.rowCount()
    const columns = options.columnCount()
    if (!rows || !columns) return
    anchor.value = { row: 0, column: 0 }
    head.value = { row: rows - 1, column: columns - 1 }
  }

  function clear(): void {
    anchor.value = null
    head.value = null
    dragging = null
  }

  function positionOf(target: EventTarget | null): {
    row: number
    column: number | null
  } | null {
    if (!(target instanceof Element)) return null
    const rowElement = target.closest<HTMLElement>('tr[data-row-index]')
    const cell = target.closest<HTMLElement>('td[data-col],td[data-row-header]')
    if (!rowElement || !cell) return null
    const row = Number(rowElement.dataset.rowIndex)
    return {
      row,
      column: cell.dataset.col === undefined ? null : Number(cell.dataset.col),
    }
  }

  /** 右键或双击时取鼠标所在的单元格；点在行号上时列为 null。 */
  function cellAt(target: EventTarget | null): GridPosition | null {
    const position = positionOf(target)
    return position?.column === null || !position
      ? null
      : { row: position.row, column: position.column }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 2) return
    const target = event.target
    if (target instanceof Element && target.closest(IGNORED_TARGETS)) return
    const position = positionOf(target)
    if (!position) return
    const last = options.columnCount() - 1
    if (position.column === null) {
      // 点行号选整行，拖动可选多行
      if (event.button === 2 && rowSelection(position.row)) return
      if (event.shiftKey && anchor.value)
        extendTo({ row: position.row, column: last })
      else {
        anchor.value = { row: position.row, column: 0 }
        head.value = { row: position.row, column: last }
      }
      if (event.button === 0) dragging = 'row'
      return
    }
    const cell = { row: position.row, column: position.column }
    if (event.button === 2) {
      if (!contains(cell)) select(cell)
      return
    }
    if (event.shiftKey && anchor.value) extendTo(cell)
    else select(cell)
    dragging = 'cell'
  }

  useEventListener(window, 'pointermove', (event: PointerEvent) => {
    if (!dragging) return
    const element = options.container.value
    if (element) {
      const rect = element.getBoundingClientRect()
      const edge = 28
      if (event.clientY < rect.top + edge * 2) element.scrollTop -= edge / 2
      else if (event.clientY > rect.bottom - edge) element.scrollTop += edge / 2
      if (event.clientX < rect.left + edge) element.scrollLeft -= edge
      else if (event.clientX > rect.right - edge) element.scrollLeft += edge
    }
    const position = positionOf(
      document.elementFromPoint(event.clientX, event.clientY)
    )
    if (!position) return
    if (dragging === 'row')
      head.value = {
        row: position.row,
        column: options.columnCount() - 1,
      }
    else if (position.column !== null)
      head.value = { row: position.row, column: position.column }
  })
  useEventListener(window, 'pointerup', () => {
    dragging = null
  })

  function copySelection(): void {
    const current = range.value
    if (!current) return
    const rows: Array<Array<string | null>> = []
    for (let row = current.top; row <= current.bottom; row += 1) {
      const cells: Array<string | null> = []
      for (let column = current.left; column <= current.right; column += 1)
        cells.push(options.valueAt(row, column))
      rows.push(cells)
    }
    options.copy(gridTsv(rows))
  }

  function visibleRowCount(): number {
    const element = options.container.value
    const height = element
      ?.querySelector('tr[data-row-index]')
      ?.getBoundingClientRect().height
    return element && height
      ? Math.max(1, Math.floor(element.clientHeight / height) - 1)
      : 20
  }

  function handleKeydown(event: KeyboardEvent): void {
    const target = event.target
    if (target instanceof Element && target.closest(IGNORED_TARGETS)) return
    const rows = options.rowCount()
    const columns = options.columnCount()
    if (!rows || !columns) return
    const control = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (control && key === 'a') {
      event.preventDefault()
      selectAll()
      return
    }
    if (control && key === 'c') {
      if (!range.value) return
      event.preventDefault()
      copySelection()
      return
    }
    const current = anchor.value
    const moving = event.shiftKey ? (head.value ?? current) : current
    if (!current || !moving) {
      if (key.startsWith('arrow') || key === 'home') {
        event.preventDefault()
        select({ row: 0, column: 0 }, true)
      }
      return
    }

    const lastRow = rows - 1
    const lastColumn = columns - 1
    let { row, column } = moving
    switch (event.key) {
      case 'ArrowUp':
        row = control ? 0 : row - 1
        break
      case 'ArrowDown':
        row = control ? lastRow : row + 1
        break
      case 'ArrowLeft':
        column = control ? 0 : column - 1
        break
      case 'ArrowRight':
        column = control ? lastColumn : column + 1
        break
      case 'PageUp':
        row -= visibleRowCount()
        break
      case 'PageDown':
        row += visibleRowCount()
        break
      case 'Home':
        column = 0
        if (control) row = 0
        break
      case 'End':
        column = lastColumn
        if (control) row = lastRow
        break
      case 'Enter': {
        event.preventDefault()
        select(
          {
            row: Math.min(
              lastRow,
              Math.max(0, current.row + (event.shiftKey ? -1 : 1))
            ),
            column: current.column,
          },
          true
        )
        return
      }
      case 'Tab': {
        const delta = event.shiftKey ? -1 : 1
        const index = current.row * columns + current.column + delta
        // 走到网格两端时放行，键盘用户才能离开表格
        if (index < 0 || index >= rows * columns) return
        event.preventDefault()
        select(
          { row: Math.floor(index / columns), column: index % columns },
          true
        )
        return
      }
      case 'F2':
        event.preventDefault()
        options.edit?.(current)
        return
      case 'Delete':
        if (range.value && options.clearCells) {
          event.preventDefault()
          options.clearCells(range.value)
        }
        return
      case 'Escape':
        select(current)
        return
      default:
        return
    }
    event.preventDefault()
    const next = {
      row: Math.min(lastRow, Math.max(0, row)),
      column: Math.min(lastColumn, Math.max(0, column)),
    }
    if (event.shiftKey) extendTo(next, true)
    else select(next, true)
  }

  /** 多选时的统计；只有数值列参与求和和平均。 */
  const stats = computed(() => {
    const current = range.value
    if (!current) return null
    const cells =
      (current.bottom - current.top + 1) * (current.right - current.left + 1)
    if (cells < 2) return null
    let numbers = 0
    let sum = 0
    for (let column = current.left; column <= current.right; column += 1) {
      if (!options.numericColumn(column)) continue
      for (let row = current.top; row <= current.bottom; row += 1) {
        const value = options.valueAt(row, column)
        if (value === null || value.trim() === '') continue
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) continue
        numbers += 1
        sum += parsed
      }
    }
    return {
      cells,
      numbers,
      sum,
      average: numbers ? sum / numbers : 0,
    }
  })

  return {
    anchor,
    range,
    stats,
    rowSelection,
    activeColumn,
    cellAt,
    select,
    clear,
    reveal,
    handlePointerDown,
    handleKeydown,
  }
}

/** 统计数字的显示格式：保留有限小数，避免浮点尾数占满状态栏。 */
export function formatGridNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
}
