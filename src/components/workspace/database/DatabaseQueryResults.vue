<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useIntervalFn, useStorage } from '@vueuse/core'

import {
  computed,
  reactive,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppColumnResizeHandle from '@/components/ui/AppColumnResizeHandle.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import {
  columnsScope,
  useDatabaseColumnWidths,
} from '@/composables/useDatabaseColumnWidths'
import { toast } from '@/composables/useToast'
import type {
  DatabaseExecution,
  DatabaseKind,
  DatabaseStatementResult,
} from '@/types/database'
import { exportDataText } from '@/utils/database-export'
import {
  extractErrorCode,
  type QueryResultEntry,
} from '@/utils/query-result-history'
import DatabaseExportMenu from '@/components/workspace/database/DatabaseExportMenu.vue'
import DatabaseGridContextMenu from '@/components/workspace/database/DatabaseGridContextMenu.vue'
import DatabaseValueViewer from '@/components/workspace/database/DatabaseValueViewer.vue'
import {
  formatGridNumber,
  useGridDensity,
  useGridSelection,
} from '@/composables/useGridSelection'
import {
  toStatusSelection,
  usePublishDatabaseSelection,
} from '@/composables/useDatabaseStatusBar'
import {
  formatGridSelection,
  isNumericType,
  type GridCopyFormat,
} from '@/utils/database-grid'
import ExplainPlanView from '@/components/workspace/database/ExplainPlanView.vue'
import SqlAiResultAsk from '@/components/workspace/database/ai/SqlAiResultAsk.vue'
import type { PlanNode } from '@/utils/explain-plan'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    execution: DatabaseExecution | null
    loading: boolean
    error: string
    databaseKind?: DatabaseKind
    databaseName?: string
    /** 最近一次分析的执行计划；有值时显示 Plan 页签 */
    plan?: PlanNode | null
    planLoading?: boolean
  planSql?: string
    /** 该查询标签保留的历史结果（含固定的），按执行先后排列 */
    history?: readonly QueryResultEntry[]
  }>(),
  { history: () => [] }
)

const emit = defineEmits<{
  /** 把报错连同失败语句交给 AI 修复 */
  fixError: [content: string]
  /** 在编辑器内联修复失败语句 */
  aiFix: [statement: DatabaseStatementResult]
  cancel: []
  retry: []
  /** 在编辑器中定位失败语句 */
  locate: [statement: DatabaseStatementResult]
  togglePin: [id: string]
  closeResult: [id: string]
}>()

const panelId = useId()
type ViewTab = 'results' | 'messages' | 'plan' | 'ask'
const activeTab = shallowRef<ViewTab>('results')
const viewTabs = computed(() => [
  { id: 'results' as const, label: t('结果') },
  { id: 'messages' as const, label: t('消息') },
  ...(result.value?.columns.length
    ? [{ id: 'ask' as const, label: t('问 AI') }]
    : []),
  ...(props.plan || props.planLoading
    ? [{ id: 'plan' as const, label: t('执行计划') }]
    : []),
])

// 新的计划到达时自动切过去，重新执行查询时切回结果
watch(
  () => [props.plan, props.planLoading] as const,
  ([plan, planLoading]) => {
    if (plan || planLoading) activeTab.value = 'plan'
  }
)

// 正在查看的历史结果；为空表示跟随最新一次执行。
const viewingId = shallowRef('')
const viewingEntry = computed(() =>
  viewingId.value
    ? props.history.find(entry => entry.id === viewingId.value)
    : undefined
)
const latestIndex = computed(() => props.history.length - 1)
const selectedHistoryIndex = computed(() =>
  viewingEntry.value
    ? props.history.indexOf(viewingEntry.value)
    : latestIndex.value
)
const shownExecution = computed(() =>
  viewingEntry.value ? viewingEntry.value.execution : props.execution
)
const shownError = computed(() =>
  viewingEntry.value ? viewingEntry.value.error : props.error
)
// 加载期间仍展示上一次结果，只是置灰；没有旧结果时才显示占位。
const stale = computed(() => props.loading && !viewingEntry.value)

const activeStatement = shallowRef(0)
const page = shallowRef(0)
const pageSize = 200
const result = computed(
  () => shownExecution.value?.statements[activeStatement.value] ?? null
)
const failedStatement = computed(
  () => shownExecution.value?.statements.find(item => item.error) ?? null
)
const failedIndex = computed(() =>
  failedStatement.value && shownExecution.value
    ? shownExecution.value.statements.indexOf(failedStatement.value) + 1
    : 0
)
const errorMessage = computed(
  () => shownError.value || result.value?.error || ''
)
const errorCode = computed(() => extractErrorCode(errorMessage.value))
const pageCount = computed(() =>
  Math.max(1, Math.ceil((result.value?.rows.length ?? 0) / pageSize))
)
const visibleRows = computed(
  () =>
    result.value?.rows.slice(
      page.value * pageSize,
      (page.value + 1) * pageSize
    ) ?? []
)
watch(result, () => {
  page.value = 0
})
const rowCountLabel = computed(() => {
  if (!result.value) return t('{count} 行', { count: 0 })
  if (!result.value.columns.length)
    return t('{count} 行受影响', { count: result.value.rowsAffected })
  return t('{count} 行', {
    count: `${result.value.rows.length}${result.value.truncated ? '+' : ''}`,
  })
})

// 形状相同的结果集（同一批列名）共用一套列宽，重跑查询后仍然保留。
const columnScope = computed(() =>
  columnsScope(
    'query',
    (result.value?.columns ?? []).map(column => column.name)
  )
)
const { resized, widthOf, beginResize, autoFit, keyboardResize, resetWidths } =
  useDatabaseColumnWidths(columnScope)

watch(shownExecution, execution => {
  const failed =
    execution?.statements.findIndex(statement => Boolean(statement.error)) ?? -1
  activeStatement.value = failed >= 0 ? failed : 0
})
watch(
  () => props.execution,
  execution => {
    viewingId.value = ''
    if (execution) activeTab.value = 'results'
  }
)
watch(
  () => props.history,
  history => {
    if (viewingId.value && !history.some(item => item.id === viewingId.value))
      viewingId.value = ''
  }
)

function selectHistory(entry: QueryResultEntry): void {
  viewingId.value = entry === props.history[latestIndex.value] ? '' : entry.id
}

// 实时计时：超过 300ms 才显示，避免快查询时数字一闪而过。
const elapsed = shallowRef(0)
let startedAt = 0
const timer = useIntervalFn(
  () => {
    elapsed.value = performance.now() - startedAt
  },
  100,
  { immediate: false }
)
watch(
  () => props.loading,
  loading => {
    if (loading) {
      startedAt = performance.now()
      elapsed.value = 0
      timer.resume()
    } else timer.pause()
  },
  { immediate: true }
)
const elapsedLabel = computed(() =>
  elapsed.value < 10_000
    ? `${(elapsed.value / 1000).toFixed(1)} s`
    : `${Math.floor(elapsed.value / 1000)} s`
)

function statementLabel(statement: string, index: number): string {
  const keyword = statement.trim().split(/\s+/u)[0]?.toUpperCase()
  return `${index + 1} · ${keyword || 'SQL'}`
}

function historyLabel(entry: QueryResultEntry, index: number): string {
  const time = new Date(entry.executedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return `#${index + 1} ${time}`
}

/** tablist 内的方向键切换，符合 WAI-ARIA tabs 模式。 */
function moveTab<T>(
  event: KeyboardEvent,
  items: readonly T[],
  current: number,
  select: (item: T) => void
): void {
  if (!items.length) return
  let next = current
  if (event.key === 'ArrowRight') next = current + 1
  else if (event.key === 'ArrowLeft') next = current - 1
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else return
  event.preventDefault()
  next = (next + items.length) % items.length
  const item = items[next]
  if (item === undefined) return
  select(item)
  ;(event.currentTarget as HTMLElement)
    .querySelectorAll<HTMLElement>('[role="tab"]')
    [next]?.focus()
}

/** 把当前错误与对应语句拼成上下文，交给 Agent 面板修复。 */
function fixWithAgent(): void {
  if (!errorMessage.value) return
  const statement =
    failedStatement.value?.statement ?? result.value?.statement ?? ''
  emit('fixError', `${statement}\n\n-- Error:\n${errorMessage.value}`.trim())
}

async function copyError(): Promise<void> {
  const statement = failedStatement.value?.statement
  await copyText(
    statement ? `${errorMessage.value}\n\n${statement}` : errorMessage.value
  )
  toast.success(t('已复制错误信息'))
}

const exportData = computed(() => ({
  name: 'query_result',
  schema: props.databaseKind === 'mysql' ? props.databaseName : undefined,
  databaseKind: props.databaseKind ?? 'mysql',
  columns: result.value?.columns ?? [],
  rows: result.value?.rows ?? [],
  truncated: result.value?.truncated,
}))

/* ---------- 单元格选区（只读网格，选区限于当前页） ---------- */

const { density, densityIcon, cycleDensity } = useGridDensity()
const DENSITY_PADDING = {
  compact: 'py-0.5',
  standard: 'py-1.5',
  comfortable: 'py-2.5',
} as const
const numericColumns = computed(() =>
  (result.value?.columns ?? []).map(column => isNumericType(column.dataType))
)
const gridScroller = useTemplateRef<HTMLElement>('gridScroller')
const gridValue = (row: number, column: number): string | null =>
  visibleRows.value[row]?.[column] ?? null
const selection = useGridSelection({
  container: gridScroller,
  rowCount: () => visibleRows.value.length,
  columnCount: () => result.value?.columns.length ?? 0,
  valueAt: gridValue,
  numericColumn: column => numericColumns.value[column] ?? false,
  copy: value => void copyGridText(value),
  edit: position => openViewer(position.row, position.column),
})
// 把多选统计同步到数据库底部状态栏；结果网格不可见（切走标签、收起结果、切到其他页签）时清掉
usePublishDatabaseSelection(
  () => toStatusSelection(selection.stats.value),
  () => gridScroller.value
)
watch([result, page], () => {
  selection.clear()
  gridMenu.open = false
})

function cellSelected(row: number, column: number): boolean {
  const range = selection.rowSelection(row)
  return Boolean(range && column >= range.left && column <= range.right)
}

async function copyGridText(value: string): Promise<void> {
  await copyText(value)
  toast.success(t('已复制到剪贴板'))
}

const viewerOpen = useStorage('miraihub:database-value-viewer', false)
const viewerCell = computed(() => {
  const cell = selection.anchor.value
  const column = cell && result.value?.columns[cell.column]
  if (!viewerOpen.value || !cell || !column) return null
  return {
    key: `${page.value}:${cell.row}:${cell.column}`,
    name: column.name,
    dataType: column.dataType,
    value: gridValue(cell.row, cell.column),
  }
})

function openViewer(row: number, column: number): void {
  selection.select({ row, column })
  viewerOpen.value = true
}

function openCellFromEvent(event: MouseEvent): void {
  const cell = selection.cellAt(event.target)
  if (cell) openViewer(cell.row, cell.column)
}

const gridMenu = reactive({ open: false, x: 0, y: 0 })
function openGridMenu(event: MouseEvent, row: number): void {
  if (!selection.rowSelection(row)) selection.select({ row, column: 0 })
  gridMenu.x = event.clientX
  gridMenu.y = event.clientY
  gridMenu.open = true
}

async function handleGridAction(id: string): Promise<void> {
  const range = selection.range.value
  const cell = selection.anchor.value
  gridMenu.open = false
  if (!range || !cell) return
  const columns = result.value?.columns.length ?? 0
  if (id === 'copy-value')
    await copyGridText(gridValue(cell.row, cell.column) ?? 'NULL')
  else if (id === 'view') viewerOpen.value = true
  else if (id === 'copy-row' || id.startsWith('copy:')) {
    const format = (id === 'copy-row' ? 'tsv' : id.slice(5)) as GridCopyFormat
    const target =
      id === 'copy-row' ? { ...range, left: 0, right: columns - 1 } : range
    await copyGridText(
      formatGridSelection(
        format,
        { ...exportData.value, rows: [] },
        target,
        gridValue
      )
    )
  }
}

async function copyResult(): Promise<void> {
  await copyText(exportDataText(exportData.value, 'csv'))
}
</script>

<template>
  <div
    class="border-line flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t"
  >
    <div
      v-if="history.length > 1"
      role="tablist"
      :aria-label="t('结果历史')"
      class="border-line-soft scroll-none flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b px-2"
      @keydown="moveTab($event, history, selectedHistoryIndex, selectHistory)"
    >
      <div
        v-for="(entry, index) in history"
        :key="entry.id"
        :class="
          cn(
            'group/result flex shrink-0 items-center rounded text-[10px] transition-colors',
            selectedHistoryIndex === index
              ? 'bg-raised text-txt'
              : 'text-txt-4 hover:text-txt-2',
            entry.error && 'text-danger'
          )
        "
      >
        <AppButton
          variant="bare"
          role="tab"
          :aria-selected="selectedHistoryIndex === index"
          :tabindex="selectedHistoryIndex === index ? 0 : -1"
          :title="entry.sql"
          class="flex items-center gap-1 py-0.5 pl-1.5 font-mono"
          @click="selectHistory(entry)"
        >
          <AppIcon
            v-if="entry.pinned"
            name="lucide:pin"
            :size="9"
            class="text-violet"
          />
          {{ historyLabel(entry, index) }}
          <span
            v-if="entry.evicted"
            class="text-txt-4"
            >· {{ t('已释放') }}</span
          >
        </AppButton>
        <IconButton
          :icon="entry.pinned ? 'lucide:pin-off' : 'lucide:pin'"
          :size="9"
          class="size-4 opacity-0 group-hover/result:opacity-100 focus-visible:opacity-100"
          :title="entry.pinned ? t('取消固定结果') : t('固定结果')"
          @click="emit('togglePin', entry.id)"
        />
        <IconButton
          icon="lucide:x"
          :size="9"
          class="mr-0.5 size-4 opacity-0 group-hover/result:opacity-100 focus-visible:opacity-100"
          :title="t('关闭结果')"
          @click="emit('closeResult', entry.id)"
        />
      </div>
    </div>
    <div
      class="border-line-soft scroll-none flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2"
    >
      <div
        v-if="shownExecution?.statements.length"
        role="tablist"
        :aria-label="t('语句结果')"
        class="flex items-center gap-0.5"
        @keydown="
          moveTab(
            $event,
            shownExecution.statements.map((_, index) => index),
            activeStatement,
            index => (activeStatement = index)
          )
        "
      >
        <AppButton
          v-for="(statement, index) in shownExecution.statements"
          :key="`${statement.offset}:${index}`"
          variant="bare"
          role="tab"
          :aria-selected="activeStatement === index"
          :aria-controls="`${panelId}-panel`"
          :tabindex="activeStatement === index ? 0 : -1"
          :title="statement.statement"
          :class="
            cn(
              'shrink-0 rounded px-2 py-1 font-mono text-[10px] transition-colors',
              activeStatement === index
                ? 'bg-raised text-txt'
                : 'text-txt-4 hover:text-txt-2',
              statement.error && 'text-danger'
            )
          "
          @click="activeStatement = index"
        >
          {{ statementLabel(statement.statement, index) }}
        </AppButton>
        <span class="bg-line-soft mx-1 h-4 w-px shrink-0" />
      </div>
      <div class="flex-1" />
      <div
        role="tablist"
        :aria-label="t('结果视图')"
        class="flex items-center gap-0.5"
        @keydown="
          moveTab(
            $event,
            viewTabs,
            viewTabs.findIndex(tab => tab.id === activeTab),
            tab => (activeTab = tab.id)
          )
        "
      >
        <AppButton
          v-for="tab in viewTabs"
          :key="tab.id"
          variant="bare"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`${panelId}-panel`"
          :tabindex="activeTab === tab.id ? 0 : -1"
          :class="
            cn(
              'rounded px-2.5 py-1 text-[11px] transition-colors',
              activeTab === tab.id
                ? 'bg-raised text-txt'
                : 'text-txt-3 hover:text-txt-2'
            )
          "
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </AppButton>
      </div>
    </div>

    <div
      :id="`${panelId}-panel`"
      role="tabpanel"
      class="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div
        v-if="loading"
        class="progress-indeterminate"
        role="progressbar"
        :aria-label="t('正在执行查询…')"
      />
      <Transition name="fade">
        <div
          v-if="loading && elapsed >= 300"
          class="border-line-strong bg-panel/92 shadow-pop absolute top-2 right-3 z-30 flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] backdrop-blur"
          aria-live="polite"
        >
          <AppIcon
            name="lucide:loader-circle"
            :size="12"
            class="motion-safe:animate-spin"
          />
          <span class="text-txt-2 font-mono tabular-nums">{{
            elapsedLabel
          }}</span>
          <AppButton
            size="sm"
            variant="danger"
            class="h-5 px-1.5"
            :title="t('取消当前查询')"
            @click="emit('cancel')"
          >
            <AppIcon
              name="lucide:square"
              :size="9"
            />
            {{ t('停止') }}
          </AppButton>
        </div>
      </Transition>

      <SqlAiResultAsk
        v-if="activeTab === 'ask'"
        :statement="result"
      />
      <div
        v-else-if="activeTab === 'plan'"
        class="scroll-thin min-h-0 flex-1 overflow-auto p-2"
      >
        <div
          v-if="planLoading"
          class="text-txt-3 grid h-full place-items-center text-xs"
        >
          <span class="flex items-center gap-2">
            <AppIcon
              name="lucide:loader-circle"
              :size="14"
              class="motion-safe:animate-spin"
            />
            {{ t('正在分析执行计划…') }}
          </span>
        </div>
        <Transition
          v-else-if="plan"
          name="fade"
          appear
        >
          <ExplainPlanView
          :plan="plan"
          :sql="planSql"
        />
        </Transition>
      </div>

      <div
        v-else-if="activeTab === 'messages'"
        :class="
          cn(
            'scroll-thin min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5',
            stale && shownExecution && 'stale-dim'
          )
        "
      >
        <p
          v-if="shownError"
          class="text-danger whitespace-pre-wrap"
        >
          {{ shownError }}
        </p>
        <div
          v-else-if="shownExecution"
          class="space-y-1.5"
        >
          <p
            v-for="(statement, index) in shownExecution.statements"
            :key="`${statement.offset}:${index}`"
            :class="statement.error ? 'text-danger' : 'text-txt-2'"
          >
            <span class="text-txt-4 mr-2">[{{ index + 1 }}]</span
            >{{ statement.message }}
            <span class="text-txt-4 ml-2">{{ statement.elapsedMs }} ms</span>
          </p>
          <p
            v-if="shownExecution.cancelled"
            class="text-amber"
          >
            {{ t('执行已由用户取消。') }}
          </p>
        </div>
        <p
          v-else-if="loading"
          class="text-txt-3"
        >
          {{ t('正在执行查询…') }}
        </p>
        <p
          v-else
          class="text-txt-4"
        >
          {{ t('执行查询后将在这里显示消息。') }}
        </p>
      </div>

      <div
        v-else
        class="flex min-h-0 min-w-0 flex-1"
      >
      <div
        ref="gridScroller"
        :class="
          cn(
            'query-result-scroll scroll-thin contain-grid focus-visible:ring-violet/35 min-h-0 min-w-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset',
            stale && (shownExecution || shownError) && 'stale-dim'
          )
        "
        tabindex="0"
        @pointerdown="selection.handlePointerDown"
        @keydown="selection.handleKeydown"
        @dblclick="openCellFromEvent"
      >
        <div
          v-if="errorMessage"
          class="p-3"
          role="alert"
        >
          <div
            class="border-danger/30 bg-danger/8 flex flex-col gap-2 rounded-lg border p-3"
          >
            <div class="flex items-center gap-2 text-xs">
              <AppIcon
                name="lucide:circle-alert"
                :size="14"
                class="text-danger shrink-0"
              />
              <span class="text-danger font-medium">{{
                failedIndex
                  ? t('第 {index} 条语句执行失败', { index: failedIndex })
                  : t('查询执行失败')
              }}</span>
              <span
                v-if="errorCode"
                class="bg-danger/15 text-danger rounded px-1.5 py-0.5 font-mono text-[10px]"
                >{{ errorCode }}</span
              >
            </div>
            <p
              class="text-txt-2 max-h-40 overflow-auto font-mono text-[11px] leading-5 whitespace-pre-wrap select-text"
            >
              {{ errorMessage }}
            </p>
            <pre
              v-if="failedStatement"
              class="bg-terminal text-txt-3 max-h-24 overflow-auto rounded px-2 py-1.5 font-mono text-[10.5px] whitespace-pre-wrap"
                >{{ failedStatement.statement }}</pre>
            <div class="flex flex-wrap items-center gap-1.5">
              <AppButton
                size="sm"
                :disabled="loading"
                @click="emit('retry')"
              >
                <AppIcon
                  name="lucide:rotate-cw"
                  :size="12"
                />
                {{ t('重试') }}
              </AppButton>
              <AppButton
                v-if="failedStatement"
                size="sm"
                @click="emit('locate', failedStatement)"
              >
                <AppIcon
                  name="lucide:locate-fixed"
                  :size="12"
                />
                {{ t('定位到语句') }}
              </AppButton>
              <AppButton
                size="sm"
                @click="copyError"
              >
                <AppIcon
                  name="lucide:copy"
                  :size="12"
                />
                {{ t('复制错误') }}
              </AppButton>
              <AppButton
                v-if="failedStatement"
                size="sm"
                variant="primary"
                :disabled="loading"
                @click="emit('aiFix', failedStatement)"
              >
                <AppIcon
                  name="lucide:wand-sparkles"
                  :size="12"
                />
                {{ t('AI 修复') }}
              </AppButton>
              <AppButton
                size="sm"
                @click="fixWithAgent"
              >
                <AppIcon
                  name="lucide:sparkles"
                  :size="12"
                />
                {{ t('让 AI 修复') }}
              </AppButton>
            </div>
          </div>
        </div>
        <div
          v-else-if="!result && loading"
          class="text-txt-3 grid h-full place-items-center text-xs"
        >
          <span class="flex items-center gap-2">
            <AppIcon
              name="lucide:loader-circle"
              :size="14"
              class="motion-safe:animate-spin"
            />
            {{ t('正在执行查询…') }}
          </span>
        </div>
        <div
          v-else-if="!result"
          class="text-txt-4 grid h-full place-items-center text-xs"
        >
          {{ t('按 Ctrl+Enter 或点击执行按钮运行 SQL') }}
        </div>
        <div
          v-else-if="!result.columns.length"
          class="text-txt-3 grid h-full place-items-center text-xs"
        >
          {{ result.message }}
        </div>
        <div
          v-else-if="viewingEntry?.evicted"
          class="text-txt-4 grid h-full place-items-center text-xs"
        >
          {{ t('结果已超出内存上限，行数据已释放') }}
        </div>
        <table
          v-else
          :style="{
            width: `${40 + result.columns.reduce((width, column) => width + (resized ? widthOf(column.name) : 160), 0)}px`,
            minWidth: '100%',
          }"
          class="table-fixed border-collapse text-left font-mono text-[11.5px]"
          role="grid"
          aria-readonly="true"
          :aria-label="t('查询结果')"
        >
          <colgroup>
            <col style="width: 40px" />
            <col
              v-for="(column, index) in result.columns"
              :key="`${column.name}:${index}`"
              :style="{ width: `${resized ? widthOf(column.name) : 160}px` }"
            />
          </colgroup>
          <thead class="database-glass-header database-glass-header--sticky">
            <tr class="text-txt-3">
              <th
                class="border-line-soft w-10 border-r border-b px-2 py-1.5 text-right font-medium"
              >
                #
              </th>
              <th
                v-for="(column, index) in result.columns"
                :key="`${column.name}:${index}`"
                :data-column="column.name"
                :class="
                  cn(
                    'border-line-soft border-r border-b px-3 py-1.5 font-medium last:border-r-0',
                    !resized && 'min-w-28',
                    numericColumns[index] && 'text-right'
                  )
                "
                :title="column.dataType"
              >
                <span class="block truncate">
                  <span>{{ column.name }}</span>
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
              v-for="(row, rowIndex) in visibleRows"
              :key="rowIndex"
              :data-row-index="rowIndex"
              class="text-txt-2 hover:bg-hover"
              @contextmenu.prevent="openGridMenu($event, rowIndex)"
            >
              <td
                data-row-header
                :class="
                  cn(
                    'border-line-soft text-txt-4 cursor-default border-r border-b px-2 text-right select-none',
                    DENSITY_PADDING[density],
                      selection.rowSelection(rowIndex) &&
                        'bg-violet/10 text-txt-2'
                  )
                "
              >
                {{ page * pageSize + rowIndex + 1 }}
              </td>
              <td
                v-for="(value, columnIndex) in row"
                :key="columnIndex"
                :data-col="columnIndex"
                :aria-selected="cellSelected(rowIndex, columnIndex)"
                :class="
                  cn(
                    'border-line-soft scroll-mt-8 scroll-ml-12 overflow-hidden border-r border-b px-3 select-none last:border-r-0',
                    DENSITY_PADDING[density],
                    !resized && 'max-w-96',
                    numericColumns[columnIndex] && 'text-right tabular-nums',
                    cellSelected(rowIndex, columnIndex) && 'bg-violet/15',
                    selection.activeColumn(rowIndex) === columnIndex &&
                      'ring-violet ring-1 ring-inset'
                  )
                "
                :title="value ?? 'NULL'"
              >
                <span
                  v-if="value === null"
                  class="text-txt-4 italic"
                  >NULL</span
                >
                <span
                  v-else
                  class="block truncate"
                  >{{ value }}</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <DatabaseValueViewer
        v-if="viewerOpen && result?.columns.length"
        :cell-key="viewerCell?.key ?? null"
        :column="viewerCell?.name"
        :data-type="viewerCell?.dataType"
        :value="viewerCell?.value ?? null"
        @close="viewerOpen = false"
      />
      </div>
    </div>
    <DatabaseGridContextMenu
      :open="gridMenu.open"
      :x="gridMenu.x"
      :y="gridMenu.y"
      @close="gridMenu.open = false"
      @select="handleGridAction"
    />

    <footer
      class="border-line-soft text-txt-3 flex min-h-8 shrink-0 flex-wrap items-center gap-y-1 border-t px-3 py-1 text-[10.5px]"
    >
      <span>{{ rowCountLabel }}</span>
      <span
        v-if="result?.columns.length"
        class="text-txt-4 ml-2"
        :title="t('左右滚动可查看全部字段')"
        >{{ t('{count} 个字段', { count: result.columns.length }) }} ·
        {{ t('左右滚动可查看全部字段') }}</span
      >
      <span
        v-if="result?.truncated"
        class="text-amber ml-2"
      >
        {{ t('已达行数上限，调高上限后重新执行') }}
      </span>
      <span
        v-if="shownExecution && shownExecution.statements.length > 1"
        class="text-txt-4 ml-2"
      >
        {{
          t('database.statements', { count: shownExecution.statements.length })
        }}
      </span>
      <span
        v-if="viewingEntry"
        class="text-violet ml-2 flex items-center gap-1"
      >
        {{ t('正在查看历史结果') }}
        <AppButton
          variant="bare"
          class="underline"
          @click="viewingId = ''"
          >{{ t('回到最新') }}</AppButton
        >
      </span>
      <span
        v-if="selection.stats.value"
        class="text-txt-3 ml-2 tabular-nums"
        aria-live="polite"
      >
        {{ t('已选 {value0} 格', { value0: selection.stats.value.cells }) }}
        <template v-if="selection.stats.value.numbers">
          · {{ t('求和') }} {{ formatGridNumber(selection.stats.value.sum) }} ·
          {{ t('平均') }}
          {{ formatGridNumber(selection.stats.value.average) }}
        </template>
      </span>
      <slot name="status" />
      <div
        v-if="!$slots.status"
        class="flex-1"
      />
      <div
        v-if="pageCount > 1"
        class="mx-2 flex items-center gap-1"
      >
        <IconButton
          icon="lucide:chevron-left"
          :size="11"
          :disabled="page === 0"
          :title="t('上一页')"
          @click="page -= 1"
        />
        <span>{{ page + 1 }} / {{ pageCount }}</span>
        <IconButton
          icon="lucide:chevron-right"
          :size="11"
          :disabled="page + 1 >= pageCount"
          :title="t('下一页')"
          @click="page += 1"
        />
      </div>
      <div
        v-if="result?.columns.length"
        class="mr-2 flex items-center gap-0.5"
      >
        <IconButton
          icon="lucide:panel-right"
          :size="11"
          :title="viewerOpen ? t('关闭值查看器') : t('打开值查看器')"
          :aria-pressed="viewerOpen"
          :class="viewerOpen && 'text-violet'"
          @click="viewerOpen = !viewerOpen"
        />
        <IconButton
          :icon="densityIcon"
          :size="11"
          :title="t('切换行密度')"
          @click="cycleDensity"
        />
        <IconButton
          v-if="resized"
          icon="lucide:unfold-horizontal"
          :size="11"
          :title="t('恢复自动列宽')"
          @click="resetWidths"
        />
        <IconButton
          icon="lucide:copy"
          :size="11"
          :title="t('复制为 CSV')"
          @click="copyResult"
        />
        <DatabaseExportMenu
          :data="exportData"
          :disabled="loading || Boolean(errorMessage)"
        />
      </div>
      <span
        v-if="loading"
        class="flex items-center gap-1 tabular-nums"
      >
        <AppIcon
          name="lucide:timer"
          :size="11"
        />
        <span>{{ elapsedLabel }}</span>
      </span>
      <span
        v-else-if="shownExecution"
        class="flex items-center gap-1 tabular-nums"
        :title="t('耗时')"
      >
        <AppIcon
          name="lucide:timer"
          :size="11"
        />
        <span>{{ shownExecution.elapsedMs }} ms</span>
      </span>
    </footer>
  </div>
</template>
