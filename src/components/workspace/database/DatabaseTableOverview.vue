<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  nextTick,
  reactive,
  toRefs,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import SearchField from '@/components/ui/SearchField.vue'
import { databaseObjectKey } from '@/composables/useDatabaseSession'
import type {
  DatabaseKind,
  DatabaseObject,
  MysqlTableStats,
} from '@/types/database'
import { formatBytes } from '@/utils/format'
import DatabaseObjectContextMenu from './DatabaseObjectContextMenu.vue'
import DatabaseConnectingSkeleton from './DatabaseConnectingSkeleton.vue'
import DatabaseEmptyIllustration from './DatabaseEmptyIllustration.vue'

const { t, locale } = useI18n()

const props = defineProps<{
  objects: readonly DatabaseObject[]
  schema: string
  databaseKind: DatabaseKind
  readOnly?: boolean
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  open: [object: DatabaseObject, panel?: 'data' | 'columns']
  inspect: [object: DatabaseObject]
  askAgent: [object: DatabaseObject]
  query: [object: DatabaseObject]
  copy: [object: DatabaseObject]
  renameObject: [object: DatabaseObject]
  removeObject: [object: DatabaseObject]
  designObject: [object: DatabaseObject]
  truncateObject: [object: DatabaseObject]
  testData: [object: DatabaseObject]
  documentObject: [object: DatabaseObject]
  refresh: []
  newQuery: []
  newTable: []
}>()

type ColumnName =
  | 'name'
  | 'comment'
  | 'rowEstimate'
  | 'createdAt'
  | 'updatedAt'
  | keyof MysqlTableStats
interface OverviewColumn {
  name: ColumnName
  label: string
  width: string
}

const state = reactive({
  // 单击或右键选中的表。
  selectedKey: '',
  filterOpen: false,
  filter: '',
  sortBy: 'name' as ColumnName,
  descending: false,
  // 右键菜单的位置及目标表。
  menu: { open: false, x: 0, y: 0, object: null as DatabaseObject | null },
})
const { selectedKey, menu } = toRefs(state)
const filterId = useId()
const filterInput =
  useTemplateRef<InstanceType<typeof SearchField>>('filterInput')
const filterToggle = useTemplateRef<HTMLButtonElement>('filterToggle')

const tables = computed(() =>
  props.objects.filter(object => object.kind === 'table')
)
const columnScope = computed(() =>
  props.schema ? `overview:${props.schema}` : ''
)
const columns = computed<OverviewColumn[]>(() => {
  // 表名沿用原清单可见宽度的 40%，备注留出阅读空间，其余位置显示统计列。
  const result: OverviewColumn[] = [
    { name: 'name', label: t('表名'), width: 'max(8rem, 40cqw)' },
  ]
  if (props.databaseKind !== 'sqlite')
    result.push(
      {
        name: 'comment',
        label: t('备注'),
        width:
          props.databaseKind === 'postgresql'
            ? 'max(12rem, calc(60cqw - 100px))'
            : 'clamp(12rem, 22cqw, 32rem)',
      },
      { name: 'rowEstimate', label: t('预估行数'), width: '100px' }
    )
  if (props.databaseKind === 'mysql')
    result.push(
      { name: 'dataLength', label: t('数据长度'), width: '100px' },
      { name: 'indexLength', label: t('索引长度'), width: '100px' },
      { name: 'autoIncrement', label: t('自增值'), width: '96px' },
      { name: 'engine', label: t('存储引擎'), width: '108px' },
      { name: 'charset', label: t('字符集'), width: '100px' },
      { name: 'updatedAt', label: t('更新时间'), width: '174px' },
      { name: 'createdAt', label: t('创建时间'), width: '174px' }
    )
  return result
})
const collator = computed(
  () => new Intl.Collator(locale.value, { numeric: true, sensitivity: 'base' })
)

/** 直接读取目录返回的值用于排序，保留空值以及精确的自增计数文本。 */
function columnValue(
  table: DatabaseObject,
  name: ColumnName
): string | number | null {
  switch (name) {
    case 'dataLength':
    case 'indexLength':
    case 'autoIncrement':
    case 'engine':
    case 'charset':
      return table.mysqlStats?.[name] ?? null
    default:
      return table[name]
  }
}

/** 字节长度统一换算成容量单位，其余字段保留数据库原文。 */
function displayValue(table: DatabaseObject, name: ColumnName): string {
  const value = columnValue(table, name)
  if (value == null || value === '') return '—'
  return typeof value === 'number' &&
    (name === 'dataLength' || name === 'indexLength')
    ? formatBytes(value)
    : String(value)
}

const visibleTables = computed(() => {
  const term = state.filter.trim().toLocaleLowerCase()
  const rows = tables.value.filter(
    table =>
      !term ||
      table.name.toLocaleLowerCase().includes(term) ||
      table.comment?.toLocaleLowerCase().includes(term)
  )
  return rows.sort((a, b) => {
    const left = columnValue(a, state.sortBy)
    const right = columnValue(b, state.sortBy)
    if (left == null || right == null)
      return Number(left == null) - Number(right == null)
    const diff =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : collator.value.compare(String(left), String(right))
    return state.descending ? -diff : diff
  })
})
const selectedTable = computed(() =>
  visibleTables.value.find(
    table => databaseObjectKey(table) === state.selectedKey
  )
)

/** 再次点击同一表头时反向排序，切换到新列时从升序开始。 */
function sortBy(name: ColumnName): void {
  state.descending = state.sortBy === name && !state.descending
  state.sortBy = name
}

/** 打开后聚焦筛选框，收起时清空条件并把键盘焦点交还按钮。 */
async function toggleFilter(): Promise<void> {
  state.filterOpen = !state.filterOpen
  if (!state.filterOpen) state.filter = ''
  await nextTick()
  if (state.filterOpen) filterInput.value?.focus()
  else filterToggle.value?.focus()
}

/** 记录右键点击的行及菜单位置。 */
function showContext(event: MouseEvent, object: DatabaseObject): void {
  state.selectedKey = databaseObjectKey(object)
  state.menu = { open: true, x: event.clientX, y: event.clientY, object }
}

function handleRowKeydown(event: KeyboardEvent, object: DatabaseObject): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    emit('open', object)
  } else if (
    event.key === 'ContextMenu' ||
    (event.shiftKey && event.key === 'F10')
  ) {
    event.preventDefault()
    event.stopPropagation()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    state.selectedKey = databaseObjectKey(object)
    state.menu = { open: true, x: rect.left + 12, y: rect.bottom, object }
  }
}

// 目录更新会使旧菜单失效；切换数据库时另外清除该库的筛选和选中状态。
watch([() => props.objects, () => props.loading], () => {
  state.menu.open = false
})
watch(
  () => props.schema,
  () => {
    state.selectedKey = ''
    state.filter = ''
    state.filterOpen = false
  }
)
</script>

<template>
  <div
    class="scroll-thin border-line-soft flex min-h-10 min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b px-2.5 py-1 whitespace-nowrap"
  >
    <template v-if="schema">
      <AppButton
        variant="ghost"
        size="sm"
        class="h-7 shrink-0"
        :disabled="loading || !!error"
        @click="emit('newQuery')"
      >
        <AppIcon
          name="lucide:square-terminal"
          :size="13"
        />{{ t('新建查询') }}
      </AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        class="h-7 shrink-0"
        :disabled="loading || !!error || readOnly"
        @click="emit('newTable')"
      >
        <AppIcon
          name="lucide:table-2"
          :size="13"
        />{{ t('新建表') }}
      </AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        class="h-7 shrink-0"
        :disabled="loading || !selectedTable"
        @click="selectedTable && emit('open', selectedTable, 'columns')"
      >
        <AppIcon
          name="lucide:columns-3"
          :size="13"
        />{{ t('字段') }}
      </AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        class="h-7 shrink-0"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <AppIcon
          name="lucide:rotate-cw"
          :size="13"
        />{{ t('刷新') }}
      </AppButton>
      <span
        v-if="!loading && !error"
        class="text-txt-3 mx-2 shrink-0 text-[11px] tabular-nums"
        role="status"
      >
        {{
          state.filter.trim()
            ? t('{matched} / {total} 张表', {
                matched: visibleTables.length,
                total: tables.length,
              })
            : t('共 {count} 张表', { count: tables.length })
        }}
      </span>
    </template>
    <div class="min-w-0 flex-1" />
    <template v-if="schema && !error">
      <SearchField
        v-if="state.filterOpen"
        :id="filterId"
        ref="filterInput"
        v-model="state.filter"
        class="h-7 w-40 shrink-0"
        :placeholder="t('按表名或备注筛选')"
        @keydown.esc.stop.prevent="toggleFilter"
      />
      <button
        ref="filterToggle"
        type="button"
        class="icon-btn shrink-0"
        :aria-expanded="state.filterOpen"
        :aria-controls="state.filterOpen ? filterId : undefined"
        :title="state.filterOpen ? t('取消搜索') : t('按表名或备注筛选')"
        :aria-label="state.filterOpen ? t('取消搜索') : t('按表名或备注筛选')"
        @click="toggleFilter"
      >
        <AppIcon
          :name="state.filterOpen ? 'lucide:x' : 'lucide:search'"
          :size="13"
        />
      </button>
    </template>
    <div class="shrink-0"><slot name="connection-actions" /></div>
  </div>
  <section
    class="scroll-thin @container min-h-0 min-w-0 flex-1 overflow-auto"
    :aria-label="t('当前数据库的表')"
    :aria-busy="loading"
  >
    <DatabaseConnectingSkeleton
      v-if="loading"
      :label="t('正在加载表列表…')"
    />
    <div
      v-else-if="error"
      role="alert"
      class="text-txt-3 flex flex-col items-center gap-3 p-8 text-xs"
    >
      <p>{{ t('表列表加载失败，请重试') }}</p>
      <AppButton
        size="sm"
        @click="emit('refresh')"
      >
        {{ t('重新加载') }}
      </AppButton>
    </div>
    <AppDataTable
      v-else-if="schema"
      :columns="columns"
      :width-scope="columnScope"
      :sort-by="state.sortBy"
      :descending="state.descending"
      @sort="sortBy"
    >
      <tr
        v-for="table in visibleTables"
        :key="databaseObjectKey(table)"
        :class="
          selectedKey === databaseObjectKey(table)
            ? 'bg-hover/60'
            : 'even:bg-panel/40 hover:bg-hover/60 focus-within:bg-hover/60'
        "
        @click="selectedKey = databaseObjectKey(table)"
        @dblclick="emit('open', table)"
        @contextmenu.prevent.stop="showContext($event, table)"
        @keydown="handleRowKeydown($event, table)"
      >
        <td class="border-line-soft border-r px-3 py-2">
          <button
            type="button"
            class="text-txt-2 hover:text-accent focus-visible:outline-accent flex max-w-full items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2"
            :title="
              t('双击打开表 {value0}.{value1}，右键查看更多操作', {
                value0: table.schema,
                value1: table.name,
              })
            "
          >
            <AppIcon
              name="lucide:table-2"
              :size="13"
              class="text-blue shrink-0"
            />
            <span class="truncate font-mono">{{ table.name }}</span>
          </button>
        </td>
        <td
          v-for="column in columns.slice(1)"
          :key="column.name"
          class="text-txt-3 border-line-soft border-r px-3 py-2 tabular-nums"
          :class="
            column.name === 'comment'
              ? 'wrap-anywhere whitespace-pre-wrap'
              : 'truncate'
          "
          :title="displayValue(table, column.name)"
        >
          {{ displayValue(table, column.name) }}
        </td>
      </tr>
      <tr v-if="!visibleTables.length">
        <td
          :colspan="columns.length"
          class="text-txt-4 p-8 text-center"
        >
          {{ tables.length ? t('没有匹配的表') : t('当前数据库暂无数据表') }}
        </td>
      </tr>
    </AppDataTable>
    <div
      v-else
      class="flex h-full items-center justify-center p-6"
      aria-hidden="true"
    >
      <DatabaseEmptyIllustration />
    </div>
    <DatabaseObjectContextMenu
      :open="menu.open"
      :x="menu.x"
      :y="menu.y"
      :object="menu.object"
      @close="menu.open = false"
      @open="(object, panel) => emit('open', object, panel)"
      @inspect="emit('inspect', $event)"
      @ask-agent="emit('askAgent', $event)"
      @query="emit('query', $event)"
      @copy="emit('copy', $event)"
      @rename="emit('renameObject', $event)"
      @remove="emit('removeObject', $event)"
      @design="emit('designObject', $event)"
      @truncate="emit('truncateObject', $event)"
      @test-data="emit('testData', $event)"
      @document="emit('documentObject', $event)"
      @refresh="emit('refresh')"
    />
  </section>
</template>
