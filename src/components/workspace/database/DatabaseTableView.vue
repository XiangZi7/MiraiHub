<script setup lang="ts">
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import { useI18n } from 'vue-i18n'

import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  nextTick,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import { useResizeObserver, useStorage } from '@vueuse/core'
import * as columnTagsApi from '@/api/column-tags'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppColumnResizeHandle from '@/components/ui/AppColumnResizeHandle.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import {
  columnTagsMessage,
  SAMPLE_VALUE_LIMIT,
  SAMPLE_VALUE_MAX_LENGTH,
  startColumnTagsReceiver,
  tagsVisible,
  toggleTagsVisible,
  useDatabaseColumnTags,
} from '@/composables/useDatabaseColumnTags'
import { useDatabaseColumnWidths } from '@/composables/useDatabaseColumnWidths'
import { toast } from '@/composables/useToast'
import type { ContextMenuItem } from '@/types/context-menu'
import type {
  CellValue,
  ColumnTagConfig,
  DatabaseObject,
  DatabaseKind,
  DatabaseRowPage,
  DatabaseTableDetail,
  RowFilter,
  RowFilterOperator,
  RowMutation,
  RowSort,
} from '@/types/database'
import { copyText as copyClipboardText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'
import { IS_TAURI } from '@/utils/window'
import DatabaseColumnTagDialog from './DatabaseColumnTagDialog.vue'
import DatabaseDataRow from './DatabaseDataRow.vue'
import DatabaseGridContextMenu from './DatabaseGridContextMenu.vue'
import DatabaseValueViewer from './DatabaseValueViewer.vue'
import {
  formatGridNumber,
  useGridDensity,
  useGridSelection,
} from '@/composables/useGridSelection'
import {
  formatGridSelection,
  isBinaryValue,
  isNumericType,
  type GridCopyFormat,
  type GridRange,
} from '@/utils/database-grid'
import DatabaseValueInput from '@/components/workspace/database/database-value-input.vue'
import DatabaseExportMenu from './DatabaseExportMenu.vue'
import type {
  DatabaseExportData,
  DatabaseExportLoader,
} from '@/types/database-export'

const { t } = useI18n()

type DetailPanel =
  'definition' | 'data' | 'columns' | 'indexes' | 'relations' | 'ddl'

const props = defineProps<{
  sessionId: string
  databaseKind?: DatabaseKind
  databaseName?: string
  object: DatabaseObject
  initialPanel?: 'data' | 'columns'
  panelNonce?: number
}>()

const emit = defineEmits<{
  query: [sql: string]
  /** 是否有未提交的单元格修改、删除标记或新增行，供标签页显示圆点和关闭确认。 */
  dirty: [dirty: boolean]
}>()

/**
 * 当前页数据整体替换、不做深层响应：几百行 × 几十列的单元格不必逐个包 Proxy，
 * 翻页时也只触发一次更新。修改一律走 edits / deletedRows，不直接改 rows。
 */
const page = shallowRef<DatabaseRowPage | null>(null)

const state = reactive({
  detail: null as DatabaseTableDetail | null,
  loading: false,
  pageLoading: false,
  countLoading: false,
  mutationLoading: false,
  error: '',
  activePanel: 'data' as DetailPanel,
  offset: 0,
  pageSize: '100',
  sort: null as RowSort | null,
  filters: [] as RowFilter[],
  exactCount: null as number | null,
})
const filterDraft = reactive({
  column: '',
  operator: 'contains' as RowFilterOperator,
  value: '',
})
const edits = reactive(new Map<string, string | null>())
const deletedRows = reactive(new Set<number>())
const insertedRows = reactive<Array<Record<string, string | null>>>([])
const confirmOpen = shallowRef(false)
// 确认弹窗里展示的待执行 SQL；预览失败时为空，不阻塞提交
const previewStatements = shallowRef<string[]>([])
const previewText = computed(() =>
  previewStatements.value.map(statement => `${statement};`).join('\n')
)

let loadRevision = 0
let pageRevision = 0

const exportData = computed<DatabaseExportData>(() => ({
  name: props.object.name,
  schema: props.object.schema,
  databaseKind: props.databaseKind ?? 'mysql',
  columns: state.detail?.columns ?? page.value?.columns ?? [],
  rows: page.value?.rows ?? [],
  detail: state.detail,
}))
/** 固定导出目标与筛选，每次最多读取 200 行；等待编码写入后再取下一批，关闭标签也不影响任务。 */
function loadAllExportRows(): DatabaseExportLoader {
  const data = { ...exportData.value, rows: [] as Array<Array<string | null>> }
  const sessionId = props.sessionId
  const databaseName = props.databaseName || props.object.schema
  const request = {
    schema: props.object.schema,
    table: props.object.name,
    filters: state.filters.map(filter => ({ ...filter })),
    sort: state.sort ? { ...state.sort } : undefined,
    limit: 200,
  }
  return async ({ signal, onProgress, onRows }) => {
    const owned = await database.forkSession(sessionId, databaseName)
    try {
      let offset = 0
      while (!signal.aborted) {
        const page = await database.fetchRows(owned.sessionId, {
          ...request,
          offset,
        })
        if (signal.aborted) throw new Error('Export cancelled')
        if (onRows) await onRows(page.rows)
        else data.rows.push(...page.rows)
        onProgress(offset + page.rows.length)
        if (!page.hasMore || !page.rows.length) return data
        offset += page.rows.length
      }
      throw new Error('Export cancelled')
    } finally {
      await database.disconnect(owned.sessionId)
    }
  }
}

const tablePanels = computed<
  Array<{ id: DetailPanel; label: string; icon: string }>
>(() => [
  { id: 'data', label: t('数据'), icon: 'lucide:table-2' },
  { id: 'columns', label: t('字段'), icon: 'lucide:columns-3' },
  { id: 'indexes', label: t('索引'), icon: 'lucide:list-tree' },
  { id: 'relations', label: t('外键'), icon: 'lucide:git-branch' },
  { id: 'ddl', label: 'DDL', icon: 'lucide:file-code-2' },
])
const viewPanels = computed<
  Array<{ id: DetailPanel; label: string; icon: string }>
>(() => [
  { id: 'definition', label: t('定义'), icon: 'lucide:file-code-2' },
  { id: 'data', label: t('数据预览'), icon: 'lucide:table-2' },
  { id: 'ddl', label: 'DDL', icon: 'lucide:braces' },
])

const pageSizeOptions = computed(() =>
  [50, 100, 200, 500].map(value => ({
    value: String(value),
    label: t('{value0} 行/页', { value0: value }),
  }))
)
const operatorOptions = computed<
  Array<{ value: RowFilterOperator; label: string }>
>(() => [
  { value: 'contains', label: t('包含') },
  { value: 'equals', label: t('等于') },
  { value: 'notEquals', label: t('不等于') },
  { value: 'startsWith', label: t('开头是') },
  { value: 'greaterThan', label: t('大于') },
  { value: 'lessThan', label: t('小于') },
  { value: 'isNull', label: t('为空') },
  { value: 'notNull', label: t('不为空') },
])

const filterColumnOptions = computed(() =>
  (state.detail?.columns ?? []).map(column => ({
    value: column.name,
    label: column.name,
    description: column.dataType,
  }))
)
const isView = computed(() => props.object.kind === 'view')
const panels = computed(() =>
  isView.value ? viewPanels.value : tablePanels.value
)
const gridColumns = computed(() =>
  page.value?.columns.length
    ? page.value.columns
    : (state.detail?.columns ?? []).map(column => ({
        name: column.name,
        dataType: column.dataType,
      }))
)
const columnComments = computed(
  () =>
    new Map(
      (state.detail?.columns ?? []).map(column => [
        column.name,
        column.comment?.trim() ?? '',
      ])
    )
)
// 列宽跟着这张表走，切换表或重开连接后仍然保留。
const columnScope = computed(() => `table:${props.object.identity}`)
const { resized, widthOf, beginResize, autoFit, keyboardResize, resetWidths } =
  useDatabaseColumnWidths(columnScope)
// 列的标签化显示规则也跟着这张表走。
const {
  tags: columnTagConfigs,
  lookups: columnTagLookups,
  hasAny: hasColumnTags,
  hasTags: columnHasTags,
  configOf: columnTagConfig,
  setTags: setColumnTags,
} = useDatabaseColumnTags(columnScope)
const columnMenu = reactive({ open: false, x: 0, y: 0, column: '' })
// 行操作放在右键菜单里，已有行的删除仍先暂存，再通过提交确认执行。
const rowMenu = reactive({ open: false, x: 0, y: 0, row: -1, inserted: false })
/** 浏览器预览时的页内标签设置浮层；桌面版改用 Rust 创建的原生子窗口。 */
const tagDialog = reactive({ open: false, column: '' })
/** 正在编辑的单元格。表格平时只渲染文本，点击后才挂输入框。 */
const editing = shallowRef<{ row: number; column: number } | null>(null)
const filterNeedsValue = computed(
  () => !['isNull', 'notNull'].includes(filterDraft.operator)
)
const { density, densityIcon, cycleDensity } = useGridDensity()
const DENSITY_HEIGHT = {
  compact: 'h-6',
  standard: 'h-7',
  comfortable: 'h-9',
} as const
const densityLabel = computed(
  () =>
    ({
      compact: t('紧凑'),
      standard: t('标准'),
      comfortable: t('宽松'),
    })[density.value]
)
/** 切页或清空改动时递增，值查看器里迟到的草稿不会写到新页面的同一位置。 */
const viewerGeneration = shallowRef(0)
const selection = useGridSelection({
  container: computed(() => scroller.value ?? null),
  rowCount: () => page.value?.rows.length ?? 0,
  columnCount: () => gridColumns.value.length,
  valueAt: (row, column) => displayValue(row, column),
  numericColumn: column => numericColumns.value[column] ?? false,
  revealRow: row => revealRow(row),
  copy: value => void copyText(value),
  edit: position => openCell(position.row, position.column),
  clearCells: range => setRangeNull(range),
})
const canInsert = computed(() => state.detail?.kind === 'table')
const canEditExisting = computed(
  () => canInsert.value && Boolean(state.detail?.primaryKey.length)
)
const pageNumber = computed(
  () => Math.floor(state.offset / Number(state.pageSize)) + 1
)
const estimatedCount = computed(
  () =>
    state.exactCount ?? state.detail?.rowEstimate ?? props.object.rowEstimate
)
const pendingMutationCount = computed(() => buildMutations().length)
const deleteCount = computed(() => deletedRows.size)

const columnMenuItems = computed<ContextMenuItem[]>(() => {
  const tagged = columnHasTags(columnMenu.column)
  return [
    {
      id: 'tags',
      label: tagged ? t('编辑标签…') : t('标签化显示…'),
      icon: 'lucide:tag',
      iconTone: 'violet',
    },
    ...(tagged
      ? [
          {
            id: 'clear-tags',
            label: t('取消标签化'),
            icon: 'lucide:tag-x',
          },
        ]
      : []),
    {
      id: 'copy-name',
      label: t('复制列名'),
      icon: 'lucide:copy',
      separatorBefore: true,
    },
  ]
})
const rowMenuItems = computed<ContextMenuItem[]>(() => {
  const busy = state.pageLoading || state.mutationLoading
  if (rowMenu.inserted)
    return [
      {
        id: 'remove-new',
        label: t('移除新增行'),
        icon: 'lucide:trash-2',
        danger: true,
        disabled: busy || !insertedRows[rowMenu.row],
      },
    ]
  const deleted = deletedRows.has(rowMenu.row)
  return [
    {
      id: 'toggle-delete',
      label: deleted ? t('撤销删除') : t('标记删除'),
      icon: deleted ? 'lucide:undo-2' : 'lucide:trash-2',
      danger: !deleted,
      disabled:
        busy || !canEditExisting.value || !page.value?.rows[rowMenu.row],
    },
  ]
})

const tagDialogInitial = computed<ColumnTagConfig | null>(() =>
  tagDialog.open ? columnTagConfig(tagDialog.column) : null
)
const tagDialogSamples = computed(() =>
  tagDialog.open ? sampleValuesOf(tagDialog.column) : []
)
/** 隐藏标签样式时不把规则交给行组件，整表按原值渲染。 */
const visibleTagConfigs = computed(() =>
  tagsVisible.value ? columnTagConfigs.value : null
)
const visibleTagLookups = computed(() =>
  tagsVisible.value ? columnTagLookups.value : null
)

function openColumnMenu(event: MouseEvent, column: string): void {
  rowMenu.open = false
  columnMenu.column = column
  columnMenu.x = event.clientX
  columnMenu.y = event.clientY
  columnMenu.open = true
}
function openRowMenu(event: MouseEvent, row: number, inserted = false): void {
  columnMenu.open = false
  rowMenu.row = row
  rowMenu.inserted = inserted
  rowMenu.x = event.clientX
  rowMenu.y = event.clientY
  rowMenu.open = true
}
function handleRowAction(id: string): void {
  if (rowMenuItems.value.find(item => item.id === id)?.disabled !== false)
    return
  if (id === 'remove-new') insertedRows.splice(rowMenu.row, 1)
  else if (id === 'toggle-delete') toggleDelete(rowMenu.row)
}
watch(
  [
    () => page.value,
    () => state.activePanel,
    () => state.pageLoading,
    () => state.mutationLoading,
  ],
  () => {
    rowMenu.open = false
    gridMenu.open = false
  }
)

async function handleColumnAction(id: string): Promise<void> {
  const column = columnMenu.column
  if (!column) return
  if (id === 'tags') {
    await openTagSettings(column)
  } else if (id === 'clear-tags') {
    setColumnTags(column, null)
    toast.success(columnTagsMessage(column, null))
  } else if (id === 'copy-name') {
    await copyText(column)
  }
}

/** 桌面版打开 Rust 创建的原生设置窗口，结果由主窗口统一接收；浏览器预览用页内浮层。 */
async function openTagSettings(column: string): Promise<void> {
  if (!IS_TAURI) {
    tagDialog.column = column
    tagDialog.open = true
    return
  }
  try {
    await columnTagsApi.openColumnTagsWindow({
      scope: columnScope.value,
      column,
      initial: columnTagConfig(column),
      sampleValues: sampleValuesOf(column),
    })
  } catch (error) {
    toast.error({
      title: t('无法打开标签设置窗口'),
      description: columnTagsApi.errorMessage(error),
    })
  }
}

function saveColumnTags(config: ColumnTagConfig | null): void {
  const column = tagDialog.column
  tagDialog.open = false
  if (!column) return
  toast.success(columnTagsMessage(column, setColumnTags(column, config)))
}

/** 当前页里某列出现过的非空短值，按出现顺序去重，供“从当前页取值”使用。 */
function sampleValuesOf(column: string): string[] {
  const index = gridColumns.value.findIndex(item => item.name === column)
  if (index < 0 || !page.value) return []
  const seen = new Set<string>()
  for (const row of page.value.rows) {
    const value = row[index]
    if (!value || value.length > SAMPLE_VALUE_MAX_LENGTH) continue
    seen.add(value)
    if (seen.size >= SAMPLE_VALUE_LIMIT) break
  }
  return [...seen]
}

function startEdit(rowIndex: number, columnIndex: number): void {
  if (!canEditExisting.value || deletedRows.has(rowIndex)) return
  selection.select({ row: rowIndex, column: columnIndex })
  editing.value = { row: rowIndex, column: columnIndex }
}

function commitEdit(
  rowIndex: number,
  columnIndex: number,
  value: string
): void {
  // 只接受仍处于编辑态的单元格：清空改动或换表时编辑器被卸载，不应再写回旧草稿
  const current = editing.value
  if (current?.row !== rowIndex || current.column !== columnIndex) return
  setCellValue(rowIndex, columnIndex, value)
  editing.value = null
}

function cancelEdit(): void {
  editing.value = null
}

/** Tab / Shift+Tab：编辑焦点移到相邻单元格，行尾折到下一行，跳过已标记删除的行。 */
function moveEdit(rowIndex: number, columnIndex: number, delta: 1 | -1): void {
  const columns = gridColumns.value.length
  const rows = page.value?.rows.length ?? 0
  let row = rowIndex
  let column = columnIndex + delta
  if (column >= columns) {
    row += 1
    column = 0
  } else if (column < 0) {
    row -= 1
    column = columns - 1
  }
  while (row >= 0 && row < rows && deletedRows.has(row)) row += delta
  editing.value = row >= 0 && row < rows && column >= 0 ? { row, column } : null
  if (editing.value) {
    selection.select(editing.value)
    revealRow(row)
  }
}

onMounted(startColumnTagsReceiver)

function clearChanges(): void {
  rowMenu.open = false
  edits.clear()
  deletedRows.clear()
  insertedRows.splice(0)
  editing.value = null
  selection.clear()
  viewerGeneration.value += 1
}

async function loadDetailAndRows(): Promise<void> {
  const revision = ++loadRevision
  state.loading = true
  state.error = ''
  state.detail = null
  page.value = null
  state.offset = 0
  state.sort = null
  state.filters = []
  state.exactCount = null
  clearChanges()
  if (
    isView.value &&
    !['definition', 'data', 'ddl'].includes(state.activePanel)
  )
    state.activePanel = 'data'

  try {
    const detail = await database.tableDetail(
      props.sessionId,
      props.object.schema,
      props.object.name,
      props.object.kind
    )
    if (revision !== loadRevision) return

    state.detail = detail
    filterDraft.column = detail.columns[0]?.name ?? ''
    await loadRows()
  } catch (error) {
    if (revision === loadRevision) {
      state.error = database.errorMessage(error)
      toast.error({ title: t('读取表结构失败'), description: state.error })
    }
  } finally {
    if (revision === loadRevision) state.loading = false
  }
}

async function loadRows(): Promise<void> {
  if (!props.sessionId) return
  const revision = ++pageRevision
  state.pageLoading = true
  state.error = ''
  try {
    const next = await database.fetchRows(props.sessionId, {
      schema: props.object.schema,
      table: props.object.name,
      offset: state.offset,
      limit: Number(state.pageSize),
      sort: state.sort ?? undefined,
      filters: state.filters,
    })
    if (revision === pageRevision) {
      page.value = next
      resetScroll()
    }
  } catch (error) {
    if (revision === pageRevision) {
      state.error = database.errorMessage(error)
      toast.error({ title: t('读取表数据失败'), description: state.error })
    }
  } finally {
    if (revision === pageRevision) state.pageLoading = false
  }
}

function applyFilter(): void {
  if (!filterDraft.column) return
  const filter: RowFilter = {
    column: filterDraft.column,
    operator: filterDraft.operator,
    value: filterNeedsValue.value ? filterDraft.value : '',
  }
  guardChanges(() => {
    state.filters = [filter]
    state.offset = 0
    clearChanges()
    void loadRows()
  })
}

function clearFilter(): void {
  if (!state.filters.length && !filterDraft.value) return
  guardChanges(() => {
    state.filters = []
    filterDraft.value = ''
    state.offset = 0
    clearChanges()
    void loadRows()
  })
}

function changePage(direction: -1 | 1): void {
  const next = Math.max(0, state.offset + direction * Number(state.pageSize))
  if (next === state.offset) return
  guardChanges(() => {
    state.offset = next
    clearChanges()
    void loadRows()
  })
}

function toggleSort(column: string): void {
  guardChanges(() => {
    state.sort =
      state.sort?.column === column
        ? state.sort.descending
          ? null
          : { column, descending: true }
        : { column, descending: false }
    state.offset = 0
    clearChanges()
    void loadRows()
  })
}

/** 分页大小经由确认守卫切换，取消时下拉框保持原值。 */
const pageSizeModel = computed({
  get: () => state.pageSize,
  set: (value: string) => {
    if (value === state.pageSize) return
    guardChanges(() => {
      state.pageSize = value
      state.offset = 0
      clearChanges()
      void loadRows()
    })
  },
})

function refreshObject(): void {
  guardChanges(() => void loadDetailAndRows())
}

/* ---------- 未提交改动保护 ---------- */

const hasChanges = computed(
  () => pendingMutationCount.value > 0 || insertedRows.length > 0
)
watch(hasChanges, value => emit('dirty', value), { immediate: true })

/** 会丢掉改动的操作先挂起，等用户在确认框里选择提交、放弃或取消。 */
const guardOpen = shallowRef(false)
let guardedAction: (() => void) | null = null
/** 从守卫里选择“提交并继续”时，提交成功后再执行被挂起的操作。 */
let afterCommit: (() => void) | null = null

function guardChanges(action: () => void): void {
  if (!hasChanges.value) {
    action()
    return
  }
  guardedAction = action
  guardOpen.value = true
}

function closeGuard(): void {
  guardOpen.value = false
  guardedAction = null
}

function discardAndContinue(): void {
  const action = guardedAction
  closeGuard()
  discardChanges()
  action?.()
}

function commitAndContinue(): void {
  const action = guardedAction
  closeGuard()
  // 只有空白新增行时没有可提交的语句，直接丢掉空行继续
  if (!pendingMutationCount.value) {
    clearChanges()
    action?.()
    return
  }
  afterCommit = action
  requestSave()
}

/** 放弃时保留一份快照（连同当时的页数据与查询条件），可以撤销一次。 */
interface DiscardedChanges {
  page: DatabaseRowPage | null
  offset: number
  pageSize: string
  sort: RowSort | null
  filters: RowFilter[]
  edits: Array<[string, string | null]>
  deleted: number[]
  inserted: Array<Record<string, string | null>>
}
const discarded = shallowRef<DiscardedChanges | null>(null)

function discardChanges(): void {
  if (!hasChanges.value) return
  discarded.value = {
    page: page.value,
    offset: state.offset,
    pageSize: state.pageSize,
    sort: state.sort ? { ...state.sort } : null,
    filters: state.filters.map(filter => ({ ...filter })),
    edits: [...edits],
    deleted: [...deletedRows],
    inserted: insertedRows.map(row => ({ ...row })),
  }
  clearChanges()
  toast.info(t('已放弃未提交改动，可点击工具栏“恢复改动”撤销'))
}

/** 恢复到放弃前的页面与改动；作废进行中的读取，避免新页覆盖回来的旧行。 */
function restoreDiscarded(): void {
  const snapshot = discarded.value
  if (!snapshot || hasChanges.value) return
  pageRevision += 1
  state.pageLoading = false
  page.value = snapshot.page
  state.offset = snapshot.offset
  state.pageSize = snapshot.pageSize
  state.sort = snapshot.sort
  state.filters = snapshot.filters
  clearChanges()
  for (const [key, value] of snapshot.edits) edits.set(key, value)
  for (const row of snapshot.deleted) deletedRows.add(row)
  insertedRows.push(...snapshot.inserted)
  discarded.value = null
  resetScroll()
}

/* ---------- 行虚拟滚动 ---------- */

/** 超过这个行数才启用窗口化，小页面保持整表渲染、列宽完全稳定。 */
const VIRTUAL_THRESHOLD = 120
const OVERSCAN = 10
const scroller = useTemplateRef<HTMLElement>('scroller')
const scrollTop = shallowRef(0)
const viewportHeight = shallowRef(600)
/** 行高按实际渲染测量，默认值对应 h-7 单元格加 1px 边框。 */
const rowHeight = shallowRef(29)
let scrollFrame = 0

useResizeObserver(scroller, entries => {
  const height = entries[0]?.contentRect.height
  if (height) viewportHeight.value = height
})

/** 滚动事件按帧合并，快速拖动滚动条时每帧只重算一次窗口。 */
function handleScroll(): void {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    scrollTop.value = scroller.value?.scrollTop ?? 0
  })
}
onBeforeUnmount(() => cancelAnimationFrame(scrollFrame))

function resetScroll(): void {
  if (scroller.value) scroller.value.scrollTop = 0
  scrollTop.value = 0
}

const rowWindow = computed(() => {
  const total = page.value?.rows.length ?? 0
  if (total <= VIRTUAL_THRESHOLD)
    return { start: 0, end: total, top: 0, bottom: 0 }
  const height = rowHeight.value
  const start = Math.max(0, Math.floor(scrollTop.value / height) - OVERSCAN)
  const end = Math.min(
    total,
    Math.ceil((scrollTop.value + viewportHeight.value) / height) + OVERSCAN
  )
  return {
    start,
    end,
    top: start * height,
    bottom: (total - end) * height,
  }
})
/** 窗口内的行带着真实行索引，编辑、删除标记和右键菜单都按真实索引寻址。 */
const visibleRows = computed(() => {
  const rows = page.value?.rows ?? []
  const { start, end } = rowWindow.value
  return rows.slice(start, end).map((row, offset) => ({
    row,
    index: start + offset,
  }))
})

watch(
  [visibleRows, density],
  () => {
    const row = scroller.value?.querySelector<HTMLElement>(
      'tr[data-row-index]'
    )
    const height = row?.getBoundingClientRect().height
    if (height && Math.abs(height - rowHeight.value) > 0.5)
      rowHeight.value = height
  },
  { flush: 'post' }
)

/** 键盘移动编辑焦点到窗口外的行时，先把那一行滚进可视区。 */
function revealRow(rowIndex: number): void {
  const element = scroller.value
  if (!element) return
  const height = rowHeight.value
  const header = element.querySelector('thead')?.offsetHeight ?? 0
  const top = rowIndex * height
  if (top < element.scrollTop) element.scrollTop = top
  else if (top + height > element.scrollTop + element.clientHeight - header)
    element.scrollTop = top + height - element.clientHeight + header
  scrollTop.value = element.scrollTop
}

async function calculateCount(): Promise<void> {
  state.countLoading = true
  state.error = ''
  try {
    state.exactCount = await database.countRows(
      props.sessionId,
      props.object.schema,
      props.object.name
    )
  } catch (error) {
    toast.error({
      title: t('统计行数失败'),
      description: database.errorMessage(error),
    })
  } finally {
    state.countLoading = false
  }
}

function cellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`
}

function setCellValue(
  rowIndex: number,
  columnIndex: number,
  value: string | null
): void {
  const original = page.value?.rows[rowIndex]?.[columnIndex] ?? null
  const key = cellKey(rowIndex, columnIndex)
  if (value === original) edits.delete(key)
  else edits.set(key, value)
}

/** 新行字段直接写入响应式记录，使提交计数随第一次输入更新。 */
function setInsertedValue(
  rowIndex: number,
  column: string,
  value: string | null
): void {
  const row = insertedRows[rowIndex]
  if (row) row[column] = value
}

/** 使用可追踪的属性存在判断，未填写字段仍交给数据库默认值。 */
function insertedValue(rowIndex: number, column: string): string | null {
  const row = insertedRows[rowIndex]
  return row && column in row ? (row[column] ?? null) : null
}

function toggleDelete(rowIndex: number): void {
  if (deletedRows.has(rowIndex)) deletedRows.delete(rowIndex)
  else deletedRows.add(rowIndex)
}

function primaryKeys(row: Array<string | null>): CellValue[] {
  const detail = state.detail
  const current = page.value
  if (!detail || !current) return []
  return detail.primaryKey.map(column => {
    const index = gridColumns.value.findIndex(
      candidate => candidate.name === column
    )
    return { column, value: index >= 0 ? (row[index] ?? null) : null }
  })
}

/** 生成当前暂存变更；显式 NULL、空字符串与未填写字段保持区分。 */
function buildMutations(): RowMutation[] {
  const detail = state.detail
  const current = page.value
  if (!detail || !current) return []

  const mutations: RowMutation[] = []
  current.rows.forEach((row, rowIndex) => {
    if (deletedRows.has(rowIndex)) {
      mutations.push({ type: 'delete', keys: primaryKeys(row) })
      return
    }

    const changes: CellValue[] = []
    gridColumns.value.forEach((column, columnIndex) => {
      const key = cellKey(rowIndex, columnIndex)
      if (edits.has(key))
        changes.push({ column: column.name, value: edits.get(key) ?? null })
    })
    if (changes.length)
      mutations.push({ type: 'update', keys: primaryKeys(row), changes })
  })

  for (const row of insertedRows) {
    const values = detail.columns.flatMap((column): CellValue[] => {
      if (!(column.name in row)) return []
      const value = row[column.name] ?? null
      if (column.autoIncrement && (value === null || value === '')) return []
      return [{ column: column.name, value }]
    })
    if (values.length) mutations.push({ type: 'insert', values })
  }
  return mutations
}

/** 打开提交确认，并异步渲染将要执行的 SQL 供用户核对。 */
function cancelSave(): void {
  confirmOpen.value = false
  afterCommit = null
}

function requestSave(): void {
  if (!pendingMutationCount.value) return
  previewStatements.value = []
  confirmOpen.value = true
  const mutations = buildMutations()
  database
    .previewMutations(props.sessionId, {
      schema: props.object.schema,
      table: props.object.name,
      mutations,
    })
    .then(statements => {
      if (confirmOpen.value) previewStatements.value = statements
    })
    .catch(() => {
      // 预览只是辅助信息，失败时仍可直接提交
    })
}

async function commitChanges(): Promise<void> {
  const mutations = buildMutations()
  confirmOpen.value = false
  if (!mutations.length) return

  state.mutationLoading = true
  state.error = ''
  try {
    const result = await database.mutateRows(props.sessionId, {
      schema: props.object.schema,
      table: props.object.name,
      mutations,
    })
    clearChanges()
    discarded.value = null
    const next = afterCommit
    afterCommit = null
    if (next) next()
    else await loadRows()
    toast.success(
      t('已提交 {value0} 项改动，影响 {value1} 行（{value2} ms）', {
        value0: mutations.length,
        value1: result.rowsAffected,
        value2: result.elapsedMs,
      })
    )
  } catch (error) {
    afterCommit = null
    toast.error({
      title: t('提交数据改动失败'),
      description: database.errorMessage(error),
    })
  } finally {
    state.mutationLoading = false
  }
}

async function copyText(value: string): Promise<void> {
  await copyClipboardText(value)
  toast.success(t('已复制到剪贴板'))
}

/* ---------- 单元格选区、右键菜单与值查看器 ---------- */

const numericColumns = computed(() =>
  gridColumns.value.map(column => isNumericType(column.dataType))
)

/** 单元格当前显示的值，包含未提交的修改。 */
function displayValue(rowIndex: number, columnIndex: number): string | null {
  const key = cellKey(rowIndex, columnIndex)
  if (edits.has(key)) return edits.get(key) ?? null
  return page.value?.rows[rowIndex]?.[columnIndex] ?? null
}

function columnDetail(columnIndex: number) {
  const name = gridColumns.value[columnIndex]?.name
  return state.detail?.columns.find(column => column.name === name)
}

/** 编辑结束后焦点回到表格，方向键可以继续导航。 */
watch(
  editing,
  (value, previous) => {
    if (!value && previous && document.activeElement === document.body)
      scroller.value?.focus({ preventScroll: true })
  },
  { flush: 'post' }
)

/** 双击 / F2：可编辑时进入编辑，否则在值查看器中查看。 */
function openCell(rowIndex: number, columnIndex: number): void {
  if (
    canEditExisting.value &&
    !deletedRows.has(rowIndex) &&
    !isBinaryValue(
      displayValue(rowIndex, columnIndex),
      gridColumns.value[columnIndex]?.dataType
    )
  )
    startEdit(rowIndex, columnIndex)
  else {
    selection.select({ row: rowIndex, column: columnIndex })
    viewerOpen.value = true
  }
}

/** 选区内的单元格设为 NULL；跳过已删除行和不允许 NULL 的字段。 */
function setRangeNull(range: GridRange): void {
  if (!canEditExisting.value || state.mutationLoading) return
  let skipped = 0
  for (let row = range.top; row <= range.bottom; row += 1) {
    if (deletedRows.has(row)) continue
    for (let column = range.left; column <= range.right; column += 1) {
      if (columnDetail(column)?.nullable === false) {
        skipped += 1
        continue
      }
      setCellValue(row, column, null)
    }
  }
  if (skipped)
    toast.info(
      t('{value0} 个单元格的字段不允许为 NULL，已跳过', { value0: skipped })
    )
}

const gridMenu = reactive({ open: false, x: 0, y: 0 })
const menuValue = computed(() => {
  const cell = selection.anchor.value
  return cell ? displayValue(cell.row, cell.column) : null
})
const menuRangeDeleted = computed(() => {
  const range = selection.range.value
  if (!range) return false
  for (let row = range.top; row <= range.bottom; row += 1)
    if (!deletedRows.has(row)) return false
  return true
})
const menuCanFilter = computed(() => {
  const cell = selection.anchor.value
  return Boolean(
    cell &&
    !isBinaryValue(menuValue.value, gridColumns.value[cell.column]?.dataType)
  )
})

function openGridMenu(event: MouseEvent, rowIndex: number): void {
  columnMenu.open = false
  rowMenu.open = false
  // 选区已在 pointerdown 时更新；行号上右键且行不在选区内时选中整行
  if (!selection.rowSelection(rowIndex))
    selection.select({ row: rowIndex, column: 0 })
  gridMenu.x = event.clientX
  gridMenu.y = event.clientY
  gridMenu.open = true
}

function exportBase() {
  return {
    name: props.object.name,
    schema: props.object.schema ?? undefined,
    databaseKind: props.databaseKind ?? 'mysql',
    columns: gridColumns.value,
    rows: [],
  }
}

async function handleGridAction(id: string): Promise<void> {
  const range = selection.range.value
  const cell = selection.anchor.value
  gridMenu.open = false
  if (!range || !cell) return
  const column = gridColumns.value[cell.column]
  if (id === 'copy-value') await copyText(menuValue.value ?? 'NULL')
  else if (id === 'copy-row' || id.startsWith('copy:')) {
    const format = (id === 'copy-row' ? 'tsv' : id.slice(5)) as GridCopyFormat
    const target =
      id === 'copy-row'
        ? { ...range, left: 0, right: gridColumns.value.length - 1 }
        : range
    await copyText(
      formatGridSelection(
        format,
        exportBase(),
        target,
        displayValue,
        state.detail?.primaryKey ?? []
      )
    )
  } else if (id === 'view') viewerOpen.value = true
  else if ((id === 'filter-equal' || id === 'filter-exclude') && column) {
    if (!menuCanFilter.value) return
    const value = menuValue.value
    const equal = id === 'filter-equal'
    const filter: RowFilter = {
      column: column.name,
      operator:
        value === null
          ? equal
            ? 'isNull'
            : 'notNull'
          : equal
            ? 'equals'
            : 'notEquals',
      value: value ?? '',
    }
    guardChanges(() => {
      filterDraft.column = filter.column
      filterDraft.operator = filter.operator
      filterDraft.value = filter.value
      state.filters = [filter]
      state.offset = 0
      clearChanges()
      void loadRows()
    })
  } else if (id === 'set-null') setRangeNull(range)
  else if (id === 'clone') cloneRows(range)
  else if (id === 'delete' && canEditExisting.value) {
    const restore = menuRangeDeleted.value
    for (let row = range.top; row <= range.bottom; row += 1) {
      if (restore) deletedRows.delete(row)
      else deletedRows.add(row)
      if (editing.value?.row === row) editing.value = null
    }
  }
}

/** 把选中行当前显示的值复制成新增行，自增列留给数据库生成。 */
function cloneRows(range: GridRange): void {
  const detail = state.detail
  if (!detail || !canInsert.value) return
  for (let row = range.top; row <= range.bottom; row += 1) {
    const record: Record<string, string | null> = {}
    gridColumns.value.forEach((column, index) => {
      const info = detail.columns.find(item => item.name === column.name)
      if (!info || info.autoIncrement) return
      record[column.name] = displayValue(row, index)
    })
    insertedRows.push(record)
  }
  void nextTick(() => {
    const element = scroller.value
    if (element) element.scrollTop = element.scrollHeight
  })
}

const viewerOpen = useStorage('miraihub:database-value-viewer', false)
const viewerCell = computed(() => {
  const cell = selection.anchor.value
  if (!viewerOpen.value || !cell || !page.value?.rows[cell.row]) return null
  const column = gridColumns.value[cell.column]
  if (!column) return null
  return {
    key: `${viewerGeneration.value}:${cell.row}:${cell.column}`,
    name: column.name,
    dataType: column.dataType,
    value: displayValue(cell.row, cell.column),
    editable: canEditExisting.value && !deletedRows.has(cell.row),
    nullable: columnDetail(cell.column)?.nullable !== false,
  }
})

function saveViewerValue(value: string | null, key: string): void {
  const [generation, row, column] = key.split(':').map(Number)
  if (
    generation !== viewerGeneration.value ||
    row === undefined ||
    column === undefined
  )
    return
  if (!canEditExisting.value || deletedRows.has(row)) return
  if (editing.value?.row === row && editing.value.column === column)
    editing.value = null
  setCellValue(row, column, value)
}

watch(
  [() => props.sessionId, () => props.object.schema, () => props.object.name],
  () => {
    discarded.value = null
    afterCommit = null
    void loadDetailAndRows()
  },
  { immediate: true }
)

watch(
  () => props.panelNonce,
  () => {
    const panel = props.initialPanel
    if (panel) state.activePanel = panel
  },
  { immediate: true }
)
</script>

<template>
  <section class="bg-terminal flex min-h-0 flex-1 flex-col">
    <header
      class="border-line-soft flex min-h-10 min-w-0 shrink-0 flex-wrap items-center gap-1 border-b px-2.5 py-1"
    >
      <div class="scroll-none flex min-w-0 items-center gap-1 overflow-x-auto">
        <AppButton
          v-for="panel in panels"
          :key="panel.id"
          variant="bare"
          :class="
            cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors',
              state.activePanel === panel.id
                ? 'bg-raised text-txt'
                : 'text-txt-3 hover:bg-hover hover:text-txt-2'
            )
          "
          @click="state.activePanel = panel.id"
        >
          <AppIcon
            :name="panel.icon"
            :size="12"
          />
          {{ panel.label }}
          <span
            v-if="panel.id === 'columns' && state.detail"
            class="text-txt-4 text-[9px]"
            >{{ state.detail.columns.length }}</span
          >
        </AppButton>
      </div>
      <div class="flex-1" />
      <DatabaseExportMenu
        :data="exportData"
        :load-all="loadAllExportRows"
        :disabled="state.loading || state.pageLoading || state.mutationLoading"
      />
      <span
        v-if="!canEditExisting && state.detail?.kind === 'table'"
        class="text-amber mr-1 text-[10px]"
        :title="t('当前表没有主键，现有行无法安全定位')"
      >
        {{ t('无主键 · 只读行') }}
      </span>
      <IconButton
        v-if="hasColumnTags && state.activePanel === 'data'"
        :icon="tagsVisible ? 'lucide:tags' : 'lucide:eye-off'"
        :size="13"
        :class="tagsVisible ? 'text-violet' : undefined"
        :title="
          tagsVisible ? t('隐藏标签化样式，显示原值') : t('显示标签化样式')
        "
        :aria-pressed="tagsVisible"
        @click="toggleTagsVisible"
      />
      <IconButton
        v-if="resized && state.activePanel === 'data'"
        icon="lucide:unfold-horizontal"
        :size="13"
        :title="t('恢复自动列宽')"
        @click="resetWidths"
      />
      <IconButton
        icon="lucide:rotate-cw"
        :size="13"
        :title="t('刷新当前对象')"
        :disabled="state.loading || state.pageLoading"
        @click="refreshObject"
      />
      <slot name="toolbar" />
    </header>

    <AppSkeleton
      v-if="state.loading && !state.detail"
      variant="table"
      class="min-h-0 flex-1"
      :rows="10"
      :aria-label="t('读取表结构…')"
    />
    <div
      v-else-if="state.error && !state.detail"
      class="text-txt-4 grid min-h-0 flex-1 place-items-center text-center text-xs"
    >
      <div>
        <p>{{ t('表结构读取失败') }}</p>
        <AppButton
          class="mt-3"
          @click="loadDetailAndRows"
        >
          {{ t('重新加载') }}
        </AppButton>
      </div>
    </div>

    <div
      v-else-if="state.detail"
      class="flex min-h-0 flex-1"
    >
      <div class="flex min-w-0 flex-1 flex-col">
        <template v-if="state.activePanel === 'data'">
          <div
            class="border-line-soft flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1"
          >
            <div class="w-32">
              <AppSelect
                v-model="filterDraft.column"
                :label="t('筛选字段')"
                :options="filterColumnOptions"
                hide-label
                compact
                searchable
              />
            </div>
            <div class="w-24">
              <AppSelect
                v-model="filterDraft.operator"
                :label="t('筛选方式')"
                :options="operatorOptions"
                hide-label
                compact
              />
            </div>
            <AppInput
              v-if="filterNeedsValue"
              v-model="filterDraft.value"
              size="sm"
              class="min-w-28 flex-1"
              :placeholder="t('筛选值')"
              @keydown.enter="applyFilter"
            />
            <AppButton
              size="sm"
              @click="applyFilter"
            >
              <AppIcon
                name="lucide:filter"
                :size="11"
              />
              {{ t('筛选') }}
            </AppButton>
            <IconButton
              icon="lucide:list-filter-plus"
              :size="12"
              :title="t('清除筛选')"
              :disabled="!state.filters.length && !filterDraft.value"
              @click="clearFilter"
            />
            <span class="bg-line-soft mx-0.5 h-4 w-px" />
            <IconButton
              icon="lucide:panel-right"
              :size="12"
              :title="viewerOpen ? t('关闭值查看器') : t('打开值查看器')"
              :aria-pressed="viewerOpen"
              :class="viewerOpen && 'text-violet'"
              @click="viewerOpen = !viewerOpen"
            />
            <AppButton
              v-if="canInsert"
              size="sm"
              @click="insertedRows.push({})"
            >
              <AppIcon
                name="lucide:plus"
                :size="11"
              />
              {{ t('新增行') }}
            </AppButton>
            <AppButton
              size="sm"
              :disabled="!pendingMutationCount || state.mutationLoading"
              @click="requestSave"
            >
              <AppIcon
                name="lucide:save"
                :size="11"
              />
              {{ t('提交') }}
              <span v-if="pendingMutationCount"
                >({{ pendingMutationCount }})</span
              >
            </AppButton>
            <IconButton
              icon="lucide:undo-2"
              :size="12"
              :title="t('放弃未提交改动')"
              :disabled="!pendingMutationCount && !insertedRows.length"
              @click="discardChanges"
            />
            <AppButton
              v-if="discarded && !hasChanges"
              size="sm"
              :disabled="state.loading || state.pageLoading"
              :title="t('撤销刚才的放弃，恢复当时的页面和改动')"
              @click="restoreDiscarded"
            >
              <AppIcon
                name="lucide:history"
                :size="11"
              />
              {{ t('恢复改动') }}
            </AppButton>
          </div>

          <div class="flex min-h-0 flex-1">
          <div
            ref="scroller"
            class="scroll-thin focus-visible:ring-violet/35 relative min-h-0 min-w-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset"
            tabindex="0"
            role="grid"
            :aria-label="t('表数据')"
            :aria-multiselectable="true"
            @scroll.passive="handleScroll"
            @pointerdown="selection.handlePointerDown"
            @keydown="selection.handleKeydown"
          >
            <div
              v-if="state.pageLoading"
              class="progress-indeterminate"
              role="progressbar"
              :aria-label="t('读取表数据…')"
            />
            <div
              v-if="state.error && page && !state.pageLoading"
              role="alert"
              class="border-danger/30 bg-danger/10 sticky top-0 left-0 z-30 flex items-center gap-2 border-b px-3 py-1.5 text-[11px] backdrop-blur"
            >
              <AppIcon
                name="lucide:circle-alert"
                :size="12"
                class="text-danger shrink-0"
              />
              <span class="text-danger shrink-0 font-medium">{{
                t('读取表数据失败')
              }}</span>
              <span
                class="text-txt-3 min-w-0 truncate font-mono"
                :title="state.error"
                >{{ state.error }}</span
              >
              <span class="text-txt-4 shrink-0">
                · {{ t('显示的是上一次成功读取的数据') }}</span
              >
              <div class="flex-1" />
              <AppButton
                size="sm"
                class="h-5 shrink-0"
                @click="loadRows"
              >
                <AppIcon
                  name="lucide:rotate-cw"
                  :size="10"
                />
                {{ t('重试') }}
              </AppButton>
            </div>
            <table
              v-if="page"
              :class="
                cn(
                  'w-full border-collapse text-left font-mono text-[11px]',
                  resized && 'table-fixed',
                  (state.pageLoading || state.error) && 'stale-dim'
                )
              "
            >
              <colgroup v-if="resized">
                <col style="width: 36px" />
                <col
                  v-for="(column, columnIndex) in gridColumns"
                  :key="`${column.name}:${columnIndex}`"
                  :style="{ width: `${widthOf(column.name)}px` }"
                />
              </colgroup>
              <thead
                class="database-glass-header database-glass-header--sticky"
              >
                <tr class="text-txt-3">
                  <th
                    class="border-line-soft w-9 border-r border-b px-1.5 py-1.5 text-right font-medium"
                  >
                    #
                  </th>
                  <th
                    v-for="(column, columnIndex) in gridColumns"
                    :key="`${column.name}:${columnIndex}`"
                    :data-tooltip="
                      columnComments.get(column.name) ||
                      t('按 {value0} 排序', { value0: column.name })
                    "
                    :data-column="column.name"
                    :class="
                      cn(
                        'border-line-soft hover:bg-hover focus-visible:ring-violet/45 cursor-pointer border-r border-b px-2.5 py-1.5 font-medium outline-none select-none focus-visible:ring-1 focus-visible:ring-inset',
                        !resized && 'min-w-36',
                        numericColumns[columnIndex] && 'text-right'
                      )
                    "
                    tabindex="0"
                    :aria-sort="
                      state.sort?.column === column.name
                        ? state.sort.descending
                          ? 'descending'
                          : 'ascending'
                        : 'none'
                    "
                    @click="toggleSort(column.name)"
                    @keydown.enter.self.prevent="toggleSort(column.name)"
                    @keydown.space.self.prevent="toggleSort(column.name)"
                    @contextmenu.prevent="openColumnMenu($event, column.name)"
                  >
                    <span class="block truncate">
                      <span>{{ column.name }}</span>
                      <AppIcon
                        v-if="state.sort?.column === column.name"
                        :name="
                          state.sort?.descending
                            ? 'lucide:arrow-down'
                            : 'lucide:arrow-up'
                        "
                        :size="10"
                        class="text-violet ml-1 inline"
                      />
                      <AppIcon
                        v-if="columnHasTags(column.name)"
                        name="lucide:tag"
                        :size="10"
                        :class="
                          cn(
                            'ml-1 inline',
                            tagsVisible ? 'text-violet' : 'text-txt-4'
                          )
                        "
                        :aria-label="t('已启用标签化显示，右键可修改')"
                      />
                      <span class="text-txt-4 ml-1.5 text-[9px] font-normal">{{
                        column.dataType
                      }}</span>
                    </span>
                    <AppColumnResizeHandle
                      :label="t('调整“{value0}”列宽', { value0: column.name })"
                      @pointerdown="beginResize(column.name, $event)"
                      @dblclick="autoFit(column.name, $event)"
                      @keydown="keyboardResize(column.name, $event)"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-if="rowWindow.top"
                  aria-hidden="true"
                >
                  <td
                    :colspan="gridColumns.length + 1"
                    class="border-0 p-0"
                    :style="{ height: `${rowWindow.top}px` }"
                  />
                </tr>
                <DatabaseDataRow
                  v-for="{ row, index: rowIndex } in visibleRows"
                  :key="rowIndex"
                  :row="row"
                  :row-index="rowIndex"
                  :number="state.offset + rowIndex + 1"
                  :columns="gridColumns"
                  :can-edit="canEditExisting"
                  :deleted="deletedRows.has(rowIndex)"
                  :edits="edits"
                  :editing-column="
                    editing?.row === rowIndex ? editing.column : null
                  "
                  :resized="resized"
                  :tags="visibleTagConfigs"
                  :tag-lookups="visibleTagLookups"
                  :selection-left="selection.rowSelection(rowIndex)?.left ?? null"
                  :selection-right="
                    selection.rowSelection(rowIndex)?.right ?? null
                  "
                  :active-column="selection.activeColumn(rowIndex)"
                  :numeric="numericColumns"
                  :height-class="DENSITY_HEIGHT[density]"
                  @open="openCell(rowIndex, $event)"
                  @edit="startEdit(rowIndex, $event)"
                  @commit="
                    (column, value) => commitEdit(rowIndex, column, value)
                  "
                  @cancel="cancelEdit"
                  @move="(column, delta) => moveEdit(rowIndex, column, delta)"
                  @context="openGridMenu($event, rowIndex)"
                />
                <tr
                  v-if="rowWindow.bottom"
                  aria-hidden="true"
                >
                  <td
                    :colspan="gridColumns.length + 1"
                    class="border-0 p-0"
                    :style="{ height: `${rowWindow.bottom}px` }"
                  />
                </tr>

                <tr
                  v-for="(_, rowIndex) in insertedRows"
                  :key="`new:${rowIndex}`"
                  class="bg-accent/5 text-txt-2"
                  @contextmenu.prevent.stop="
                    openRowMenu($event, rowIndex, true)
                  "
                >
                  <td
                    class="border-line-soft text-accent border-r border-b px-1.5 py-1 text-right"
                  >
                    {{ t('NEW') }}
                  </td>
                  <td
                    v-for="column in state.detail.columns"
                    :key="column.name"
                    class="group/cell border-line-soft relative border-r border-b p-0 last:border-r-0"
                  >
                    <DatabaseValueInput
                      :model-value="insertedValue(rowIndex, column.name) ?? ''"
                      :data-type="column.dataType"
                      :placeholder="
                        column.autoIncrement
                          ? t('自动生成')
                          : insertedValue(rowIndex, column.name) === null
                            ? 'NULL'
                            : ''
                      "
                      @update:model-value="
                        setInsertedValue(rowIndex, column.name, $event)
                      "
                    />
                    <AppButton
                      v-if="column.nullable"
                      variant="bare"
                      class="bg-raised text-txt-4 hover:text-violet absolute top-1/2 hidden -translate-y-1/2 rounded px-1 text-[9px] group-focus-within/cell:block"
                      :class="
                        /date|time/i.test(column.dataType)
                          ? 'right-8'
                          : 'right-1'
                      "
                      :title="t('设为 NULL')"
                      @click="setInsertedValue(rowIndex, column.name, null)"
                      >NULL</AppButton
                    >
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="
                page && !page.rows.length && !insertedRows.length
              "
              class="text-txt-4 grid h-full place-items-center py-12 text-xs"
            >
              {{ t('当前条件下没有数据') }}
            </div>
          </div>
          <DatabaseValueViewer
            v-if="viewerOpen"
            :cell-key="viewerCell?.key ?? null"
            :column="viewerCell?.name"
            :data-type="viewerCell?.dataType"
            :value="viewerCell?.value ?? null"
            :editable="viewerCell?.editable"
            :nullable="viewerCell?.nullable"
            @save="saveViewerValue"
            @close="viewerOpen = false"
          />
          </div>

          <footer
            class="border-line-soft text-txt-3 flex h-8 shrink-0 items-center gap-1.5 border-t px-2.5 text-[10.5px]"
          >
            <IconButton
              icon="lucide:chevron-left"
              :size="12"
              :title="t('上一页')"
              :disabled="state.offset === 0 || state.pageLoading"
              @click="changePage(-1)"
            />
            <span>{{ t('database.page', { page: pageNumber }) }}</span>
            <IconButton
              icon="lucide:chevron-right"
              :size="12"
              :title="t('下一页')"
              :disabled="!page?.hasMore || state.pageLoading"
              @click="changePage(1)"
            />
            <div class="w-25">
              <AppSelect
                v-model="pageSizeModel"
                :label="t('分页大小')"
                :options="pageSizeOptions"
                hide-label
                compact
              />
            </div>
            <span class="text-txt-4 ml-1">
              {{ t('common.rows', { count: page?.rows.length ?? 0 }) }} ·
              {{ page?.elapsedMs ?? 0 }} ms
            </span>
            <AppButton
              variant="bare"
              class="text-txt-4 hover:bg-hover hover:text-txt-2 ml-1 rounded px-1.5 py-1"
              :disabled="state.countLoading"
              @click="calculateCount"
            >
              {{
                state.countLoading
                  ? t('统计中…')
                  : state.exactCount !== null
                    ? t('精确 {value0} 行', {
                        value0: state.exactCount.toLocaleString(),
                      })
                    : estimatedCount !== null && estimatedCount !== undefined
                      ? t('约 {value0} 行 · 点此精确统计', {
                          value0: estimatedCount.toLocaleString(),
                        })
                      : t('统计总行数')
              }}
            </AppButton>
            <span
              v-if="selection.stats.value"
              class="text-txt-3 ml-1 truncate tabular-nums"
              aria-live="polite"
            >
              {{ t('已选 {value0} 格', { value0: selection.stats.value.cells }) }}
              <template v-if="selection.stats.value.numbers">
                · {{ t('求和') }}
                {{ formatGridNumber(selection.stats.value.sum) }} ·
                {{ t('平均') }}
                {{ formatGridNumber(selection.stats.value.average) }}
              </template>
            </span>
            <div class="flex-1" />
            <IconButton
              :icon="densityIcon"
              :size="12"
              :title="t('行密度：{value0}', { value0: densityLabel })"
              @click="cycleDensity"
            />
            <AppButton
              v-if="page?.sql"
              variant="bare"
              class="text-txt-4 hover:bg-hover hover:text-txt-2 rounded px-1.5 py-1 font-mono"
              :title="t('复制本页实际 SQL')"
              @click="copyText(page.sql)"
            >
              SQL
            </AppButton>
            <IconButton
              v-if="page?.sql"
              icon="lucide:external-link"
              :size="11"
              :title="t('发送到查询编辑器')"
              @click="emit('query', page.sql)"
            />
          </footer>
        </template>

        <div
          v-else-if="state.activePanel === 'columns'"
          class="scroll-thin min-h-0 flex-1 overflow-auto"
        >
          <table class="w-full border-collapse text-left text-[11px]">
            <thead
              class="database-glass-header database-glass-header--sticky text-txt-3"
            >
              <tr>
                <th class="border-line-soft border-b px-3 py-2 font-medium">
                  {{ t('字段') }}
                </th>
                <th class="border-line-soft border-b px-3 py-2 font-medium">
                  {{ t('类型') }}
                </th>
                <th class="border-line-soft border-b px-3 py-2 font-medium">
                  {{ t('约束') }}
                </th>
                <th class="border-line-soft border-b px-3 py-2 font-medium">
                  {{ t('默认值') }}
                </th>
                <th class="border-line-soft border-b px-3 py-2 font-medium">
                  {{ t('备注') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="column in state.detail.columns"
                :key="column.name"
                class="hover:bg-hover"
              >
                <td
                  class="border-line-soft text-txt border-b px-3 py-2 font-mono"
                >
                  <AppIcon
                    v-if="column.primaryKey"
                    name="lucide:key-round"
                    :size="11"
                    class="text-amber mr-1.5 inline"
                  />{{ column.name }}
                </td>
                <td
                  class="border-line-soft text-blue border-b px-3 py-2 font-mono"
                >
                  {{ column.dataType }}
                </td>
                <td class="border-line-soft text-txt-3 border-b px-3 py-2">
                  {{ column.nullable ? 'NULL' : 'NOT NULL'
                  }}<span v-if="column.autoIncrement">
                    · {{ t('自动生成') }}</span
                  >
                </td>
                <td
                  class="border-line-soft text-txt-3 max-w-64 truncate border-b px-3 py-2 font-mono"
                  :title="column.defaultValue ?? ''"
                >
                  {{ column.defaultValue ?? '—' }}
                </td>
                <td
                  class="border-line-soft text-txt-3 max-w-64 truncate border-b px-3 py-2"
                  :title="column.comment ?? ''"
                >
                  {{ column.comment ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-else-if="state.activePanel === 'indexes'"
          class="scroll-thin min-h-0 flex-1 overflow-auto p-3"
        >
          <div
            v-if="!state.detail.indexes.length"
            class="text-txt-4 text-xs"
          >
            {{ t('没有索引') }}
          </div>
          <div
            v-for="index in state.detail.indexes"
            :key="index.name"
            class="border-line-soft bg-card mb-2 rounded-lg border p-3"
          >
            <div class="text-txt flex items-center gap-2 text-xs">
              <AppIcon
                :name="index.primary ? 'lucide:key-round' : 'lucide:list-tree'"
                :size="13"
                :class="index.primary ? 'text-amber' : 'text-violet'"
              />{{ index.name
              }}<span
                v-if="index.primary"
                class="badge"
                >PRIMARY</span
              ><span
                v-else-if="index.unique"
                class="badge"
                >UNIQUE</span
              >
            </div>
            <p class="text-txt-3 mt-1.5 font-mono text-[10.5px]">
              {{ index.columns.join(', ') }}
            </p>
          </div>
        </div>

        <div
          v-else-if="state.activePanel === 'relations'"
          class="scroll-thin min-h-0 flex-1 overflow-auto p-3"
        >
          <div
            v-if="!state.detail.foreignKeys.length"
            class="text-txt-4 text-xs"
          >
            {{ t('没有外键') }}
          </div>
          <div
            v-for="foreignKey in state.detail.foreignKeys"
            :key="foreignKey.name"
            class="border-line-soft bg-card mb-2 rounded-lg border p-3 text-[11px]"
          >
            <div class="text-txt flex items-center gap-2">
              <AppIcon
                name="lucide:git-branch"
                :size="13"
                class="text-violet"
              />{{ foreignKey.name }}
            </div>
            <p class="text-txt-3 mt-1.5 font-mono">
              ({{ foreignKey.columns.join(', ') }}) →
              {{ foreignKey.referencedSchema }}.{{
                foreignKey.referencedTable
              }}
              ({{ foreignKey.referencedColumns.join(', ') }})
            </p>
          </div>
        </div>

        <div
          v-else
          class="scroll-thin bg-terminal relative min-h-0 flex-1 overflow-auto p-4"
        >
          <AppButton
            size="sm"
            class="absolute top-3 right-3"
            @click="copyText(state.detail.ddl)"
            ><AppIcon
              name="lucide:copy"
              :size="11"
            />
            {{ t('复制 DDL') }}
          </AppButton>
          <pre
            class="text-term-fg pr-24 font-mono text-[11.5px] leading-5 whitespace-pre-wrap"
            >{{ state.detail.ddl || t('无法生成 DDL') }}</pre>
        </div>
      </div>

      <aside
        v-if="isView"
        class="border-line-soft bg-panel scroll-thin w-76 shrink-0 overflow-y-auto border-l p-3"
      >
        <h3 class="text-txt mb-2 text-[12px] font-medium">
          {{ t('视图信息') }}
        </h3>
        <dl
          class="border-line-soft bg-card grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-2 rounded-lg border p-3 text-[10.5px]"
        >
          <dt class="text-txt-4">{{ t('名称') }}</dt>
          <dd
            class="text-txt-2 truncate"
            :title="object.name"
          >
            {{ object.name }}
          </dd>
          <dt class="text-txt-4">{{ t('数据库') }}</dt>
          <dd class="text-txt-2 truncate">{{ object.schema }}</dd>
          <dt class="text-txt-4">{{ t('创建时间') }}</dt>
          <dd class="text-txt-3">{{ object.createdAt || '—' }}</dd>
          <dt class="text-txt-4">{{ t('更新时间') }}</dt>
          <dd class="text-txt-3">{{ object.updatedAt || '—' }}</dd>
          <dt class="text-txt-4">{{ t('注释') }}</dt>
          <dd class="text-txt-3 break-words">{{ object.comment || '—' }}</dd>
        </dl>

        <h3 class="text-txt mt-4 mb-2 text-[12px] font-medium">
          {{ t('字段信息') }}
        </h3>
        <div class="border-line-soft overflow-hidden rounded-lg border">
          <table class="w-full border-collapse text-left text-[10.5px]">
            <thead
              class="database-glass-header database-glass-header--card text-txt-3"
            >
              <tr>
                <th class="border-line-soft border-b px-2 py-1.5 font-medium">
                  {{ t('字段名') }}
                </th>
                <th class="border-line-soft border-b px-2 py-1.5 font-medium">
                  {{ t('类型') }}
                </th>
                <th class="border-line-soft border-b px-2 py-1.5 font-medium">
                  {{ t('可空') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="column in state.detail.columns"
                :key="`view:${column.name}`"
              >
                <td
                  class="border-line-soft text-txt-2 border-b px-2 py-1.5 font-mono"
                >
                  {{ column.name }}
                </td>
                <td
                  class="border-line-soft text-txt-3 border-b px-2 py-1.5 font-mono"
                >
                  {{ column.dataType }}
                </td>
                <td class="border-line-soft text-txt-3 border-b px-2 py-1.5">
                  {{ column.nullable ? t('是') : t('否') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </div>

    <AppConfirmDialog
      :open="confirmOpen"
      :title="t('提交数据改动？')"
      :description="
        t(
          '将以单个事务提交 {value0} 项改动{value1}。任一语句失败会整体回滚。',
          {
            value0: pendingMutationCount,
            value1: deleteCount
              ? t('，其中删除 {value0} 行', { value0: deleteCount })
              : '',
          }
        )
      "
      :confirm-label="t('提交改动')"
      :danger="deleteCount > 0"
      @close="cancelSave"
      @confirm="commitChanges"
    >
      <pre
        v-if="previewStatements.length"
        class="scroll-thin bg-terminal border-line-soft text-txt-2 mt-2.5 max-h-48 overflow-auto rounded-md border p-2 font-mono text-[10.5px] leading-4 whitespace-pre-wrap select-text"
        >{{ previewText }}</pre>
    </AppConfirmDialog>
    <AppConfirmDialog
      :open="guardOpen"
      :title="t('有未提交的改动')"
      :description="
        t(
          '当前页有 {value0} 项未提交改动，继续操作会丢失它们。可以先提交，或放弃后继续（放弃后可撤销一次）。',
          { value0: pendingMutationCount || insertedRows.length }
        )
      "
      :confirm-label="t('放弃并继续')"
      danger
      @close="closeGuard"
      @confirm="discardAndContinue"
    >
      <AppButton
        size="sm"
        class="mt-2.5"
        :disabled="state.mutationLoading"
        @click="commitAndContinue"
      >
        <AppIcon
          name="lucide:save"
          :size="11"
        />
        {{ t('提交并继续') }}
      </AppButton>
    </AppConfirmDialog>
    <DatabaseGridContextMenu
      :open="gridMenu.open"
      :x="gridMenu.x"
      :y="gridMenu.y"
      :can-filter="menuCanFilter"
      :can-edit="
        canEditExisting && !state.pageLoading && !state.mutationLoading
      "
      :can-insert="canInsert && !state.mutationLoading"
      :deleted="menuRangeDeleted"
      @close="gridMenu.open = false"
      @select="handleGridAction"
    />
    <AppContextMenu
      :open="rowMenu.open"
      :x="rowMenu.x"
      :y="rowMenu.y"
      :items="rowMenuItems"
      :label="t('数据行操作')"
      @close="rowMenu.open = false"
      @select="handleRowAction"
    />
    <AppContextMenu
      :open="columnMenu.open"
      :x="columnMenu.x"
      :y="columnMenu.y"
      :items="columnMenuItems"
      :label="columnMenu.column"
      @close="columnMenu.open = false"
      @select="handleColumnAction"
    />
    <DatabaseColumnTagDialog
      :open="tagDialog.open"
      :column="tagDialog.column"
      :initial="tagDialogInitial"
      :sample-values="tagDialogSamples"
      @close="tagDialog.open = false"
      @submit="saveColumnTags"
    />
  </section>
</template>
