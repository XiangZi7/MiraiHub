<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { toast } from '@/composables/useToast'
import type {
  CellValue,
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

type DetailPanel = 'definition' | 'data' | 'columns' | 'indexes' | 'relations' | 'ddl'

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

const tablePanels: Array<{ id: DetailPanel, label: string, icon: string }> = [
  { id: 'data', label: '数据', icon: 'lucide:table-2' },
  { id: 'columns', label: '字段', icon: 'lucide:columns-3' },
  { id: 'indexes', label: '索引', icon: 'lucide:list-key' },
  { id: 'relations', label: '外键', icon: 'lucide:git-branch' },
  { id: 'ddl', label: 'DDL', icon: 'lucide:file-code-2' },
]
const viewPanels: Array<{ id: DetailPanel, label: string, icon: string }> = [
  { id: 'definition', label: '定义', icon: 'lucide:file-code-2' },
  { id: 'data', label: '数据预览', icon: 'lucide:table-2' },
  { id: 'ddl', label: 'DDL', icon: 'lucide:braces' },
]

const pageSizeOptions = [50, 100, 200, 500].map(value => ({
  value: String(value),
  label: `${value} 行/页`,
}))
const operatorOptions: Array<{ value: RowFilterOperator, label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'startsWith', label: '开头是' },
  { value: 'greaterThan', label: '大于' },
  { value: 'lessThan', label: '小于' },
  { value: 'isNull', label: '为空' },
  { value: 'notNull', label: '不为空' },
]

const filterColumnOptions = computed(() => (state.detail?.columns ?? []).map(column => ({
  value: column.name,
  label: column.name,
  description: column.dataType,
})))
const isView = computed(() => props.object.kind === 'view')
const panels = computed(() => isView.value ? viewPanels : tablePanels)
const gridColumns = computed(() => state.page?.columns.length
  ? state.page.columns
  : (state.detail?.columns ?? []).map(column => ({ name: column.name, dataType: column.dataType })))
const filterNeedsValue = computed(() => !['isNull', 'notNull'].includes(filterDraft.operator))
const canInsert = computed(() => state.detail?.kind === 'table')
const canEditExisting = computed(() => canInsert.value && Boolean(state.detail?.primaryKey.length))
const pageNumber = computed(() => Math.floor(state.offset / Number(state.pageSize)) + 1)
const estimatedCount = computed(() => state.exactCount ?? state.detail?.rowEstimate ?? props.object.rowEstimate)
const pendingMutationCount = computed(() => buildMutations().length)
const deleteCount = computed(() => deletedRows.size)

function clearChanges(): void {
  edits.clear()
  deletedRows.clear()
  insertedRows.splice(0)
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
  if (isView.value && !['definition', 'data', 'ddl'].includes(state.activePanel))
    state.activePanel = 'data'

  try {
    const detail = await database.tableDetail(
      props.sessionId,
      props.object.schema,
      props.object.name,
      props.object.kind,
    )
    if (revision !== loadRevision)
      return

    state.detail = detail
    filterDraft.column = detail.columns[0]?.name ?? ''
    await loadRows()
  }
  catch (error) {
    if (revision === loadRevision) {
      state.error = database.errorMessage(error)
      toast.error({ title: '读取表结构失败', description: state.error })
    }
  }
  finally {
    if (revision === loadRevision)
      state.loading = false
  }
}

async function loadRows(): Promise<void> {
  if (!props.sessionId)
    return
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
    if (revision === pageRevision)
      state.page = page
  }
  catch (error) {
    if (revision === pageRevision) {
      state.error = database.errorMessage(error)
      toast.error({ title: '读取表数据失败', description: state.error })
    }
  }
  finally {
    if (revision === pageRevision)
      state.pageLoading = false
  }
}

function applyFilter(): void {
  if (!filterDraft.column)
    return
  state.filters = [{
    column: filterDraft.column,
    operator: filterDraft.operator,
    value: filterNeedsValue.value ? filterDraft.value : '',
  }]
  state.offset = 0
  clearChanges()
  void loadRows()
}

function clearFilter(): void {
  if (!state.filters.length && !filterDraft.value)
    return
  state.filters = []
  filterDraft.value = ''
  state.offset = 0
  clearChanges()
  void loadRows()
}

function changePage(direction: -1 | 1): void {
  const next = Math.max(0, state.offset + direction * Number(state.pageSize))
  if (next === state.offset)
    return
  state.offset = next
  clearChanges()
  void loadRows()
}

function toggleSort(column: string): void {
  state.sort = state.sort?.column === column
    ? state.sort.descending ? null : { column, descending: true }
    : { column, descending: false }
  state.offset = 0
  clearChanges()
  void loadRows()
}

async function calculateCount(): Promise<void> {
  state.countLoading = true
  state.error = ''
  try {
    state.exactCount = await database.countRows(props.sessionId, props.object.schema, props.object.name)
  }
  catch (error) {
    toast.error({ title: '统计行数失败', description: database.errorMessage(error) })
  }
  finally {
    state.countLoading = false
  }
}

function cellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`
}

function cellValue(rowIndex: number, columnIndex: number): string | null {
  const key = cellKey(rowIndex, columnIndex)
  return edits.has(key) ? edits.get(key) ?? null : state.page?.rows[rowIndex]?.[columnIndex] ?? null
}

function setCellValue(rowIndex: number, columnIndex: number, value: string | null): void {
  const original = state.page?.rows[rowIndex]?.[columnIndex] ?? null
  const key = cellKey(rowIndex, columnIndex)
  if (value === original)
    edits.delete(key)
  else
    edits.set(key, value)
}

function setInsertedValue(rowIndex: number, column: string, value: string | null): void {
  const row = insertedRows[rowIndex]
  if (row)
    row[column] = value
}

function insertedValue(rowIndex: number, column: string): string | null {
  const row = insertedRows[rowIndex]
  return row && Object.hasOwn(row, column) ? row[column] ?? null : null
}

function toggleDelete(rowIndex: number): void {
  if (deletedRows.has(rowIndex))
    deletedRows.delete(rowIndex)
  else
    deletedRows.add(rowIndex)
}

function primaryKeys(row: Array<string | null>): CellValue[] {
  const detail = state.detail
  const page = state.page
  if (!detail || !page)
    return []
  return detail.primaryKey.map((column) => {
    const index = gridColumns.value.findIndex(candidate => candidate.name === column)
    return { column, value: index >= 0 ? row[index] ?? null : null }
  })
}

function buildMutations(): RowMutation[] {
  const detail = state.detail
  const page = state.page
  if (!detail || !page)
    return []

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
      if (!Object.hasOwn(row, column.name))
        return []
      const value = row[column.name] ?? null
      if (column.autoIncrement && (value === null || value === ''))
        return []
      return [{ column: column.name, value }]
    })
    if (values.length)
      mutations.push({ type: 'insert', values })
  }
  return mutations
}

function requestSave(): void {
  if (pendingMutationCount.value)
    confirmOpen.value = true
}

async function commitChanges(): Promise<void> {
  const mutations = buildMutations()
  confirmOpen.value = false
  if (!mutations.length)
    return

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
    toast.success(`已提交 ${mutations.length} 项改动，影响 ${result.rowsAffected} 行（${result.elapsedMs} ms）`)
  }
  catch (error) {
    toast.error({ title: '提交数据改动失败', description: database.errorMessage(error) })
  }
  finally {
    state.mutationLoading = false
  }
}

async function copyText(value: string): Promise<void> {
  await copyClipboardText(value)
  toast.success('已复制到剪贴板')
}

watch(
  [() => props.sessionId, () => props.object.schema, () => props.object.name],
  () => void loadDetailAndRows(),
  { immediate: true },
)

watch(() => props.panelNonce, () => {
  const panel = props.initialPanel
  if (panel)
    state.activePanel = panel
}, { immediate: true })

watch(() => state.pageSize, () => {
  state.offset = 0
  clearChanges()
  void loadRows()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-terminal">
    <header class="flex h-10 shrink-0 items-center gap-1 border-b border-line-soft px-2.5">
      <AppButton
        v-for="panel in panels"
        :key="panel.id"
        variant="bare"
        :class="cn(
          'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors',
          state.activePanel === panel.id ? 'bg-raised text-txt' : 'text-txt-3 hover:bg-hover hover:text-txt-2',
        )"
        @click="state.activePanel = panel.id"
      >
        <AppIcon :name="panel.icon" :size="12" />
        {{ panel.label }}
        <span v-if="panel.id === 'columns' && state.detail" class="text-[9px] text-txt-4">{{ state.detail.columns.length }}</span>
      </AppButton>
      <div class="flex-1" />
      <span v-if="!canEditExisting && state.detail?.kind === 'table'" class="mr-1 text-[10px] text-amber" title="当前表没有主键，现有行无法安全定位">
        无主键 · 只读行
      </span>
      <IconButton icon="lucide:rotate-cw" :size="13" title="刷新当前对象" :disabled="state.loading || state.pageLoading" @click="loadDetailAndRows" />
    </header>

    <div v-if="state.loading && !state.detail" class="grid min-h-0 flex-1 place-items-center text-xs text-txt-3">
      <span class="flex items-center gap-2"><AppIcon name="lucide:loader-circle" :size="14" class="animate-spin" />读取表结构…</span>
    </div>
    <div v-else-if="state.error && !state.detail" class="grid min-h-0 flex-1 place-items-center text-center text-xs text-txt-4">
      <div><p>表结构读取失败</p><AppButton class="mt-3" @click="loadDetailAndRows">重新加载</AppButton></div>
    </div>

    <div v-else-if="state.detail" class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
      <template v-if="state.activePanel === 'data'">
        <div class="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-line-soft px-2 py-1">
          <div class="w-32">
            <AppSelect v-model="filterDraft.column" label="筛选字段" :options="filterColumnOptions" hide-label compact searchable />
          </div>
          <div class="w-24">
            <AppSelect v-model="filterDraft.operator" label="筛选方式" :options="operatorOptions" hide-label compact />
          </div>
          <AppInput
            v-if="filterNeedsValue"
            v-model="filterDraft.value"
            size="sm"
            class="min-w-28 flex-1"
            placeholder="筛选值"
            @keydown.enter="applyFilter"
          />
          <AppButton size="sm" @click="applyFilter">
            <AppIcon name="lucide:filter" :size="11" />筛选
          </AppButton>
          <IconButton icon="lucide:list-filter-plus" :size="12" title="清除筛选" :disabled="!state.filters.length && !filterDraft.value" @click="clearFilter" />
          <span class="mx-0.5 h-4 w-px bg-line-soft" />
          <AppButton v-if="canInsert" size="sm" @click="insertedRows.push({})">
            <AppIcon name="lucide:plus" :size="11" />新增行
          </AppButton>
          <AppButton size="sm" :disabled="!pendingMutationCount || state.mutationLoading" @click="requestSave">
            <AppIcon name="lucide:save" :size="11" />提交 <span v-if="pendingMutationCount">({{ pendingMutationCount }})</span>
          </AppButton>
          <IconButton icon="lucide:undo-2" :size="12" title="放弃未提交改动" :disabled="!pendingMutationCount && !insertedRows.length" @click="clearChanges" />
        </div>

        <div class="relative min-h-0 flex-1 overflow-auto scroll-thin">
          <div v-if="state.pageLoading" class="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-violet/15">
            <div class="h-full w-1/3 animate-pulse bg-violet" />
          </div>
          <table v-if="state.page" class="w-full border-collapse text-left font-mono text-[11px]">
            <thead class="sticky top-0 z-10 bg-panel">
              <tr class="text-txt-3">
                <th class="w-9 border-r border-b border-line-soft px-1.5 py-1.5 text-right font-medium">#</th>
                <th v-if="canInsert" class="w-8 border-r border-b border-line-soft" />
                <th
                  v-for="(column, columnIndex) in gridColumns"
                  :key="`${column.name}:${columnIndex}`"
                  class="min-w-36 cursor-pointer select-none border-r border-b border-line-soft px-2.5 py-1.5 font-medium hover:bg-hover"
                  :title="`按 ${column.name} 排序`"
                  @click="toggleSort(column.name)"
                >
                  <span>{{ column.name }}</span>
                  <AppIcon
                    v-if="state.sort?.column === column.name"
                    :name="state.sort?.descending ? 'lucide:arrow-down' : 'lucide:arrow-up'"
                    :size="10"
                    class="ml-1 inline text-violet"
                  />
                  <span class="ml-1.5 text-[9px] font-normal text-txt-4">{{ column.dataType }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIndex) in state.page.rows"
                :key="rowIndex"
                :class="cn('text-txt-2 hover:bg-hover', deletedRows.has(rowIndex) && 'bg-danger/7 opacity-55 line-through')"
              >
                <td class="border-r border-b border-line-soft px-1.5 py-1 text-right text-txt-4">{{ state.offset + rowIndex + 1 }}</td>
                <td v-if="canInsert" class="border-r border-b border-line-soft p-0.5 text-center">
                  <IconButton v-if="canEditExisting" :icon="deletedRows.has(rowIndex) ? 'lucide:undo-2' : 'lucide:trash-2'" :size="11" class="size-6 text-txt-4 hover:text-danger" :title="deletedRows.has(rowIndex) ? '撤销删除' : '标记删除'" @click="toggleDelete(rowIndex)" />
                </td>
                <td
                  v-for="(_, columnIndex) in gridColumns"
                  :key="columnIndex"
                  :class="cn('group/cell relative border-r border-b border-line-soft p-0 last:border-r-0', edits.has(cellKey(rowIndex, columnIndex)) && 'bg-violet/8')"
                >
                  <template v-if="canEditExisting && !deletedRows.has(rowIndex)">
                    <AppInput
                      :model-value="cellValue(rowIndex, columnIndex) ?? ''"
                      variant="cell"
                      monospace
                      :placeholder="cellValue(rowIndex, columnIndex) === null ? 'NULL' : ''"
                      @update:model-value="setCellValue(rowIndex, columnIndex, $event)"
                    />
                    <AppButton
                      variant="bare"
                      class="absolute top-1/2 right-1 hidden -translate-y-1/2 rounded bg-raised px-1 text-[9px] text-txt-4 group-focus-within/cell:block hover:text-violet"
                      title="设为 NULL"
                      @click="setCellValue(rowIndex, columnIndex, null)"
                    >NULL</AppButton>
                  </template>
                  <span v-else-if="row[columnIndex] === null" class="block h-7 min-w-36 px-2.5 py-1.5 italic text-txt-4">NULL</span>
                  <span v-else class="block h-7 min-w-36 max-w-80 truncate px-2.5 py-1.5" :title="row[columnIndex] ?? ''">{{ row[columnIndex] }}</span>
                </td>
              </tr>

              <tr v-for="(_, rowIndex) in insertedRows" :key="`new:${rowIndex}`" class="bg-accent/5 text-txt-2">
                <td class="border-r border-b border-line-soft px-1.5 py-1 text-right text-accent">NEW</td>
                <td v-if="canInsert" class="border-r border-b border-line-soft p-0.5 text-center">
                  <IconButton icon="lucide:x" :size="11" class="size-6 text-txt-4 hover:text-danger" title="移除新增行" @click="insertedRows.splice(rowIndex, 1)" />
                </td>
                <td v-for="column in state.detail.columns" :key="column.name" class="group/cell relative border-r border-b border-line-soft p-0 last:border-r-0">
                  <AppInput
                    :model-value="insertedValue(rowIndex, column.name) ?? ''"
                    variant="cell"
                    monospace
                    :placeholder="column.autoIncrement ? '自动生成' : insertedValue(rowIndex, column.name) === null ? 'NULL' : ''"
                    @update:model-value="setInsertedValue(rowIndex, column.name, $event)"
                  />
                  <AppButton
                    v-if="column.nullable"
                    variant="bare"
                    class="absolute top-1/2 right-1 hidden -translate-y-1/2 rounded bg-raised px-1 text-[9px] text-txt-4 group-focus-within/cell:block hover:text-violet"
                    title="设为 NULL"
                    @click="setInsertedValue(rowIndex, column.name, null)"
                  >NULL</AppButton>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="state.page && !state.page.rows.length && !insertedRows.length" class="grid h-full place-items-center py-12 text-xs text-txt-4">
            当前条件下没有数据
          </div>
        </div>

        <footer class="flex h-8 shrink-0 items-center gap-1.5 border-t border-line-soft px-2.5 text-[10.5px] text-txt-3">
          <IconButton icon="lucide:chevron-left" :size="12" title="上一页" :disabled="state.offset === 0 || state.pageLoading" @click="changePage(-1)" />
          <span>第 {{ pageNumber }} 页</span>
          <IconButton icon="lucide:chevron-right" :size="12" title="下一页" :disabled="!state.page?.hasMore || state.pageLoading" @click="changePage(1)" />
          <div class="w-25">
            <AppSelect v-model="state.pageSize" label="分页大小" :options="pageSizeOptions" hide-label compact />
          </div>
          <span class="ml-1 text-txt-4">
            {{ state.page?.rows.length ?? 0 }} 行 · {{ state.page?.elapsedMs ?? 0 }} ms
          </span>
          <AppButton variant="bare" class="ml-1 rounded px-1.5 py-1 text-txt-4 hover:bg-hover hover:text-txt-2" :disabled="state.countLoading" @click="calculateCount">
            {{ state.countLoading ? '统计中…' : state.exactCount !== null ? `精确 ${state.exactCount.toLocaleString()} 行` : estimatedCount !== null && estimatedCount !== undefined ? `约 ${estimatedCount.toLocaleString()} 行 · 点此精确统计` : '统计总行数' }}
          </AppButton>
          <div class="flex-1" />
          <AppButton v-if="state.page?.sql" variant="bare" class="rounded px-1.5 py-1 font-mono text-txt-4 hover:bg-hover hover:text-txt-2" title="复制本页实际 SQL" @click="copyText(state.page.sql)">
            SQL
          </AppButton>
          <IconButton v-if="state.page?.sql" icon="lucide:external-link" :size="11" title="发送到查询编辑器" @click="emit('query', state.page.sql)" />
        </footer>
      </template>

      <div v-else-if="state.activePanel === 'columns'" class="min-h-0 flex-1 overflow-auto scroll-thin">
        <table class="w-full border-collapse text-left text-[11px]">
          <thead class="sticky top-0 bg-panel text-txt-3"><tr>
            <th class="border-b border-line-soft px-3 py-2 font-medium">字段</th><th class="border-b border-line-soft px-3 py-2 font-medium">类型</th><th class="border-b border-line-soft px-3 py-2 font-medium">约束</th><th class="border-b border-line-soft px-3 py-2 font-medium">默认值</th><th class="border-b border-line-soft px-3 py-2 font-medium">备注</th>
          </tr></thead>
          <tbody><tr v-for="column in state.detail.columns" :key="column.name" class="hover:bg-hover">
            <td class="border-b border-line-soft px-3 py-2 font-mono text-txt"><AppIcon v-if="column.primaryKey" name="lucide:key-round" :size="11" class="mr-1.5 inline text-amber" />{{ column.name }}</td>
            <td class="border-b border-line-soft px-3 py-2 font-mono text-blue">{{ column.dataType }}</td>
            <td class="border-b border-line-soft px-3 py-2 text-txt-3">{{ column.nullable ? 'NULL' : 'NOT NULL' }}<span v-if="column.autoIncrement"> · 自动生成</span></td>
            <td class="max-w-64 truncate border-b border-line-soft px-3 py-2 font-mono text-txt-3" :title="column.defaultValue ?? ''">{{ column.defaultValue ?? '—' }}</td>
            <td class="max-w-64 truncate border-b border-line-soft px-3 py-2 text-txt-3" :title="column.comment ?? ''">{{ column.comment ?? '—' }}</td>
          </tr></tbody>
        </table>
      </div>

      <div v-else-if="state.activePanel === 'indexes'" class="min-h-0 flex-1 overflow-auto p-3 scroll-thin">
        <div v-if="!state.detail.indexes.length" class="text-xs text-txt-4">没有索引</div>
        <div v-for="index in state.detail.indexes" :key="index.name" class="mb-2 rounded-lg border border-line-soft bg-card p-3">
          <div class="flex items-center gap-2 text-xs text-txt"><AppIcon :name="index.primary ? 'lucide:key-round' : 'lucide:list-key'" :size="13" :class="index.primary ? 'text-amber' : 'text-violet'" />{{ index.name }}<span v-if="index.primary" class="badge">PRIMARY</span><span v-else-if="index.unique" class="badge">UNIQUE</span></div>
          <p class="mt-1.5 font-mono text-[10.5px] text-txt-3">{{ index.columns.join(', ') }}</p>
        </div>
      </div>

      <div v-else-if="state.activePanel === 'relations'" class="min-h-0 flex-1 overflow-auto p-3 scroll-thin">
        <div v-if="!state.detail.foreignKeys.length" class="text-xs text-txt-4">没有外键</div>
        <div v-for="foreignKey in state.detail.foreignKeys" :key="foreignKey.name" class="mb-2 rounded-lg border border-line-soft bg-card p-3 text-[11px]">
          <div class="flex items-center gap-2 text-txt"><AppIcon name="lucide:git-branch" :size="13" class="text-violet" />{{ foreignKey.name }}</div>
          <p class="mt-1.5 font-mono text-txt-3">({{ foreignKey.columns.join(', ') }}) → {{ foreignKey.referencedSchema }}.{{ foreignKey.referencedTable }} ({{ foreignKey.referencedColumns.join(', ') }})</p>
        </div>
      </div>

      <div v-else class="relative min-h-0 flex-1 overflow-auto bg-[#0d0f14] p-4 scroll-thin">
        <AppButton size="sm" class="absolute top-3 right-3" @click="copyText(state.detail.ddl)"><AppIcon name="lucide:copy" :size="11" />复制 DDL</AppButton>
        <pre class="whitespace-pre-wrap pr-24 font-mono text-[11.5px] leading-5 text-term-fg">{{ state.detail.ddl || '无法生成 DDL' }}</pre>
      </div>
      </div>

      <aside v-if="isView" class="w-76 shrink-0 overflow-y-auto border-l border-line-soft bg-panel p-3 scroll-thin">
        <h3 class="mb-2 text-[12px] font-medium text-txt">视图信息</h3>
        <dl class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-2 rounded-lg border border-line-soft bg-card p-3 text-[10.5px]">
          <dt class="text-txt-4">名称</dt><dd class="truncate text-txt-2" :title="object.name">{{ object.name }}</dd>
          <dt class="text-txt-4">数据库</dt><dd class="truncate text-txt-2">{{ object.schema }}</dd>
          <dt class="text-txt-4">创建时间</dt><dd class="text-txt-3">{{ object.createdAt || '—' }}</dd>
          <dt class="text-txt-4">更新时间</dt><dd class="text-txt-3">{{ object.updatedAt || '—' }}</dd>
          <dt class="text-txt-4">注释</dt><dd class="break-words text-txt-3">{{ object.comment || '—' }}</dd>
        </dl>

        <h3 class="mt-4 mb-2 text-[12px] font-medium text-txt">字段信息</h3>
        <div class="overflow-hidden rounded-lg border border-line-soft">
          <table class="w-full border-collapse text-left text-[10.5px]">
            <thead class="bg-card text-txt-3"><tr><th class="border-b border-line-soft px-2 py-1.5 font-medium">字段名</th><th class="border-b border-line-soft px-2 py-1.5 font-medium">类型</th><th class="border-b border-line-soft px-2 py-1.5 font-medium">可空</th></tr></thead>
            <tbody><tr v-for="column in state.detail.columns" :key="`view:${column.name}`"><td class="border-b border-line-soft px-2 py-1.5 font-mono text-txt-2">{{ column.name }}</td><td class="border-b border-line-soft px-2 py-1.5 font-mono text-txt-3">{{ column.dataType }}</td><td class="border-b border-line-soft px-2 py-1.5 text-txt-3">{{ column.nullable ? '是' : '否' }}</td></tr></tbody>
          </table>
        </div>
      </aside>
    </div>

    <AppConfirmDialog
      :open="confirmOpen"
      title="提交数据改动？"
      :description="`将以单个事务提交 ${pendingMutationCount} 项改动${deleteCount ? `，其中删除 ${deleteCount} 行` : ''}。任一语句失败会整体回滚。`"
      confirm-label="提交改动"
      :danger="deleteCount > 0"
      @close="confirmOpen = false"
      @confirm="commitChanges"
    />
  </section>
</template>
