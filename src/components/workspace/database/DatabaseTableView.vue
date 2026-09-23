<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, onMounted, reactive, shallowRef, watch } from 'vue'
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

const { t } = useI18n()

type DetailPanel =
  'definition' | 'data' | 'columns' | 'indexes' | 'relations' | 'ddl'

const props = defineProps<{
  sessionId: string
  object: DatabaseObject
  initialPanel?: 'data' | 'columns'
  panelNonce?: number
}>()

const emit = defineEmits<{
  query: [sql: string]
}>()

const state = reactive({
  detail: null as DatabaseTableDetail | null,
  page: null as DatabaseRowPage | null,
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

let loadRevision = 0
let pageRevision = 0

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
  state.page?.columns.length
    ? state.page.columns
    : (state.detail?.columns ?? []).map(column => ({
        name: column.name,
        dataType: column.dataType,
      }))
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
/** 浏览器预览时的页内标签设置浮层；桌面版改用 Rust 创建的原生子窗口。 */
const tagDialog = reactive({ open: false, column: '' })
/** 正在编辑的单元格。表格平时只渲染文本，点击后才挂输入框。 */
const editing = shallowRef<{ row: number; column: number } | null>(null)
const filterNeedsValue = computed(
  () => !['isNull', 'notNull'].includes(filterDraft.operator)
)
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
  columnMenu.column = column
  columnMenu.x = event.clientX
  columnMenu.y = event.clientY
  columnMenu.open = true
}

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
  if (index < 0 || !state.page) return []
  const seen = new Set<string>()
  for (const row of state.page.rows) {
    const value = row[index]
    if (!value || value.length > SAMPLE_VALUE_MAX_LENGTH) continue
    seen.add(value)
    if (seen.size >= SAMPLE_VALUE_LIMIT) break
  }
  return [...seen]
}

function startEdit(rowIndex: number, columnIndex: number): void {
  editing.value = { row: rowIndex, column: columnIndex }
}

function commitEdit(
  rowIndex: number,
  columnIndex: number,
  value: string
): void {
  setCellValue(rowIndex, columnIndex, value)
  const current = editing.value
  if (current?.row === rowIndex && current.column === columnIndex)
    editing.value = null
}

function cancelEdit(): void {
  editing.value = null
}

/** Tab / Shift+Tab：编辑焦点移到相邻单元格，行尾折到下一行，跳过已标记删除的行。 */
function moveEdit(rowIndex: number, columnIndex: number, delta: 1 | -1): void {
  const columns = gridColumns.value.length
  const rows = state.page?.rows.length ?? 0
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
}

onMounted(startColumnTagsReceiver)

function clearChanges(): void {
  edits.clear()
  deletedRows.clear()
  insertedRows.splice(0)
  editing.value = null
}

async function loadDetailAndRows(): Promise<void> {
  const revision = ++loadRevision
  state.loading = true
  state.error = ''
  state.detail = null
  state.page = null
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
    const page = await database.fetchRows(props.sessionId, {
      schema: props.object.schema,
      table: props.object.name,
      offset: state.offset,
      limit: Number(state.pageSize),
      sort: state.sort ?? undefined,
      filters: state.filters,
    })
    if (revision === pageRevision) state.page = page
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
  state.filters = [
    {
      column: filterDraft.column,
      operator: filterDraft.operator,
      value: filterNeedsValue.value ? filterDraft.value : '',
    },
  ]
  state.offset = 0
  clearChanges()
  void loadRows()
}

function clearFilter(): void {
  if (!state.filters.length && !filterDraft.value) return
  state.filters = []
  filterDraft.value = ''
  state.offset = 0
  clearChanges()
  void loadRows()
}

function changePage(direction: -1 | 1): void {
  const next = Math.max(0, state.offset + direction * Number(state.pageSize))
  if (next === state.offset) return
  state.offset = next
  clearChanges()
  void loadRows()
}

function toggleSort(column: string): void {
  state.sort =
    state.sort?.column === column
      ? state.sort.descending
        ? null
        : { column, descending: true }
      : { column, descending: false }
  state.offset = 0
  clearChanges()
  void loadRows()
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
  const original = state.page?.rows[rowIndex]?.[columnIndex] ?? null
  const key = cellKey(rowIndex, columnIndex)
  if (value === original) edits.delete(key)
  else edits.set(key, value)
}

function setInsertedValue(
  rowIndex: number,
  column: string,
  value: string | null
): void {
  const row = insertedRows[rowIndex]
  if (row) row[column] = value
}

function insertedValue(rowIndex: number, column: string): string | null {
  const row = insertedRows[rowIndex]
  return row && Object.hasOwn(row, column) ? (row[column] ?? null) : null
}

function toggleDelete(rowIndex: number): void {
  if (deletedRows.has(rowIndex)) deletedRows.delete(rowIndex)
  else deletedRows.add(rowIndex)
}

function primaryKeys(row: Array<string | null>): CellValue[] {
  const detail = state.detail
  const page = state.page
  if (!detail || !page) return []
  return detail.primaryKey.map(column => {
    const index = gridColumns.value.findIndex(
      candidate => candidate.name === column
    )
    return { column, value: index >= 0 ? (row[index] ?? null) : null }
  })
}

function buildMutations(): RowMutation[] {
  const detail = state.detail
  const page = state.page
  if (!detail || !page) return []

  const mutations: RowMutation[] = []
  page.rows.forEach((row, rowIndex) => {
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
      if (!Object.hasOwn(row, column.name)) return []
      const value = row[column.name] ?? null
      if (column.autoIncrement && (value === null || value === '')) return []
      return [{ column: column.name, value }]
    })
    if (values.length) mutations.push({ type: 'insert', values })
  }
  return mutations
}

function requestSave(): void {
  if (pendingMutationCount.value) confirmOpen.value = true
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
    await loadRows()
    toast.success(
      t('已提交 {value0} 项改动，影响 {value1} 行（{value2} ms）', {
        value0: mutations.length,
        value1: result.rowsAffected,
        value2: result.elapsedMs,
      })
    )
  } catch (error) {
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

watch(
  [() => props.sessionId, () => props.object.schema, () => props.object.name],
  () => void loadDetailAndRows(),
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

watch(
  () => state.pageSize,
  () => {
    state.offset = 0
    clearChanges()
    void loadRows()
  }
)
</script>

<template>
  <section class="bg-terminal flex min-h-0 flex-1 flex-col">
    <header
      class="border-line-soft flex h-10 shrink-0 items-center gap-1 border-b px-2.5"
    >
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
      <div class="flex-1" />
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
        @click="loadDetailAndRows"
      />
    </header>

    <div
      v-if="state.loading && !state.detail"
      class="text-txt-3 grid min-h-0 flex-1 place-items-center text-xs"
    >
      <span class="flex items-center gap-2"
        ><AppIcon
          name="lucide:loader-circle"
          :size="14"
          class="animate-spin"
        />
        {{ t('读取表结构…') }}
      </span>
    </div>
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
              @click="clearChanges"
            />
          </div>

          <div class="scroll-thin relative min-h-0 flex-1 overflow-auto">
            <div
              v-if="state.pageLoading"
              class="bg-violet/15 absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden"
            >
              <div class="bg-violet h-full w-1/3 animate-pulse" />
            </div>
            <table
              v-if="state.page"
              :class="
                cn(
                  'w-full border-collapse text-left font-mono text-[11px]',
                  resized && 'table-fixed'
                )
              "
            >
              <colgroup v-if="resized">
                <col style="width: 36px" />
                <col
                  v-if="canInsert"
                  style="width: 32px"
                />
                <col
                  v-for="(column, columnIndex) in gridColumns"
                  :key="`${column.name}:${columnIndex}`"
                  :style="{ width: `${widthOf(column.name)}px` }"
                />
              </colgroup>
              <thead class="database-glass-header database-glass-header--sticky">
                <tr class="text-txt-3">
                  <th
                    class="border-line-soft w-9 border-r border-b px-1.5 py-1.5 text-right font-medium"
                  >
                    #
                  </th>
                  <th
                    v-if="canInsert"
                    class="border-line-soft w-8 border-r border-b"
                  />
                  <th
                    v-for="(column, columnIndex) in gridColumns"
                    :key="`${column.name}:${columnIndex}`"
                    :data-column="column.name"
                    :class="
                      cn(
                        'border-line-soft hover:bg-hover cursor-pointer border-r border-b px-2.5 py-1.5 font-medium select-none',
                        !resized && 'min-w-36'
                      )
                    "
                    :title="t('按 {value0} 排序', { value0: column.name })"
                    @click="toggleSort(column.name)"
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
                        :title="t('已启用标签化显示，右键可修改')"
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
                <DatabaseDataRow
                  v-for="(row, rowIndex) in state.page.rows"
                  :key="rowIndex"
                  :row="row"
                  :row-index="rowIndex"
                  :number="state.offset + rowIndex + 1"
                  :columns="gridColumns"
                  :can-insert="canInsert"
                  :can-edit="canEditExisting"
                  :deleted="deletedRows.has(rowIndex)"
                  :edits="edits"
                  :editing-column="
                    editing?.row === rowIndex ? editing.column : null
                  "
                  :resized="resized"
                  :tags="visibleTagConfigs"
                  :tag-lookups="visibleTagLookups"
                  @edit="startEdit(rowIndex, $event)"
                  @commit="
                    (column, value) => commitEdit(rowIndex, column, value)
                  "
                  @cancel="cancelEdit"
                  @move="(column, delta) => moveEdit(rowIndex, column, delta)"
                  @toggle-delete="toggleDelete(rowIndex)"
                />

                <tr
                  v-for="(_, rowIndex) in insertedRows"
                  :key="`new:${rowIndex}`"
                  class="bg-accent/5 text-txt-2"
                >
                  <td
                    class="border-line-soft text-accent border-r border-b px-1.5 py-1 text-right"
                  >
                    {{ t('NEW') }}
                  </td>
                  <td
                    v-if="canInsert"
                    class="border-line-soft border-r border-b p-0.5 text-center"
                  >
                    <IconButton
                      icon="lucide:x"
                      :size="11"
                      class="text-txt-4 hover:text-danger size-6"
                      :title="t('移除新增行')"
                      @click="insertedRows.splice(rowIndex, 1)"
                    />
                  </td>
                  <td
                    v-for="column in state.detail.columns"
                    :key="column.name"
                    class="group/cell border-line-soft relative border-r border-b p-0 last:border-r-0"
                  >
                    <AppInput
                      :model-value="insertedValue(rowIndex, column.name) ?? ''"
                      variant="cell"
                      monospace
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
                      class="bg-raised text-txt-4 hover:text-violet absolute top-1/2 right-1 hidden -translate-y-1/2 rounded px-1 text-[9px] group-focus-within/cell:block"
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
                state.page && !state.page.rows.length && !insertedRows.length
              "
              class="text-txt-4 grid h-full place-items-center py-12 text-xs"
            >
              {{ t('当前条件下没有数据') }}
            </div>
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
              :disabled="!state.page?.hasMore || state.pageLoading"
              @click="changePage(1)"
            />
            <div class="w-25">
              <AppSelect
                v-model="state.pageSize"
                :label="t('分页大小')"
                :options="pageSizeOptions"
                hide-label
                compact
              />
            </div>
            <span class="text-txt-4 ml-1">
              {{ t('common.rows', { count: state.page?.rows.length ?? 0 }) }} ·
              {{ state.page?.elapsedMs ?? 0 }} ms
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
            <div class="flex-1" />
            <AppButton
              v-if="state.page?.sql"
              variant="bare"
              class="text-txt-4 hover:bg-hover hover:text-txt-2 rounded px-1.5 py-1 font-mono"
              :title="t('复制本页实际 SQL')"
              @click="copyText(state.page.sql)"
            >
              SQL
            </AppButton>
            <IconButton
              v-if="state.page?.sql"
              icon="lucide:external-link"
              :size="11"
              :title="t('发送到查询编辑器')"
              @click="emit('query', state.page.sql)"
            />
          </footer>
        </template>

        <div
          v-else-if="state.activePanel === 'columns'"
          class="scroll-thin min-h-0 flex-1 overflow-auto"
        >
          <table class="w-full border-collapse text-left text-[11px]">
            <thead class="database-glass-header database-glass-header--sticky text-txt-3">
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
          class="scroll-thin relative min-h-0 flex-1 overflow-auto bg-[#0d0f14] p-4"
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
            <thead class="database-glass-header database-glass-header--card text-txt-3">
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
      @close="confirmOpen = false"
      @confirm="commitChanges"
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
