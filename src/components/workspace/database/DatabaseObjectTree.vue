<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  nextTick,
  reactive,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import { databaseObjectKey } from '@/composables/useDatabaseSession'
import type { ContextMenuItem } from '@/types/context-menu'
import type {
  DatabaseColumn,
  DatabaseKind,
  DatabaseObject,
  DatabaseObjectKind,
} from '@/types/database'
import type { SavedDatabaseQuery } from '@/types/database-query'
import { cn } from '@/utils/cn'
import DatabaseObjectCategory from './DatabaseObjectCategory.vue'
import DatabaseObjectContextMenu from './DatabaseObjectContextMenu.vue'
import DatabaseSavedQueryCategory from './DatabaseSavedQueryCategory.vue'
import DatabaseTreeCollapse from './DatabaseTreeCollapse.vue'

const { t } = useI18n()

const props = defineProps<{
  databaseName: string
  databaseKind: DatabaseKind
  activeDatabase: string
  currentDatabase?: string
  databaseNames: readonly string[]
  objects: DatabaseObject[]
  savedQueries: readonly SavedDatabaseQuery[]
  selectedSavedQueryId: string
  columnsByObject: Record<string, DatabaseColumn[] | undefined>
  inspectingKeys: Set<string>
  loadedDatabases?: ReadonlySet<string>
  switchingDisabled?: boolean
  loading: boolean
  databasesLoading?: boolean
  preparingTransfer?: boolean
  error: string
  ready?: boolean
}>()

const emit = defineEmits<{
  refresh: []
  inspect: [object: DatabaseObject]
  askAgent: [object: DatabaseObject]
  open: [object: DatabaseObject, panel?: 'data' | 'columns']
  query: [object: DatabaseObject]
  copy: [object: DatabaseObject]
  selectDatabase: [name: string]
  selectSchema: [name: string]
  createDatabase: []
  createObject: [schema: string, kind: DatabaseObjectKind]
  newQuery: [schema?: string]
  renameDatabase: [name: string]
  removeDatabase: [name: string]
  exportDatabase: [name: string]
  importDatabase: [name: string]
  renameObject: [object: DatabaseObject]
  removeObject: [object: DatabaseObject]
  designObject: [object: DatabaseObject]
  truncateObject: [object: DatabaseObject]
  createSavedQuery: [database: string]
  openSavedQuery: [query: SavedDatabaseQuery]
  renameSavedQuery: [query: SavedDatabaseQuery]
  removeSavedQuery: [query: SavedDatabaseQuery]
  duplicateSavedQuery: [query: SavedDatabaseQuery]
}>()

interface SchemaGroup {
  name: string
  queries: SavedDatabaseQuery[]
  tables: DatabaseObject[]
  views: DatabaseObject[]
  procedures: DatabaseObject[]
  functions: DatabaseObject[]
}

type ContextTarget =
  'root' | 'database' | 'category' | 'object' | 'query-category' | 'saved-query'

const expanded = reactive(new Set<string>())
// 响应式状态
const state = reactive({
  // 只展开最后一次请求且已加载成功的数据库，连续双击不重复切换。
  pendingSchema: '',
})
const selectedKey = shallowRef('')
const search = shallowRef('')
const context = reactive({
  open: false,
  x: 0,
  y: 0,
  target: 'root' as ContextTarget,
  database: '',
  category: 'table' as DatabaseObjectKind,
  object: null as DatabaseObject | null,
  savedQuery: null as SavedDatabaseQuery | null,
})

function emptySchema(name: string): SchemaGroup {
  return {
    name,
    queries: [],
    tables: [],
    views: [],
    procedures: [],
    functions: [],
  }
}

const schemas = computed<SchemaGroup[]>(() => {
  if (props.ready === false) return []
  const term = search.value.trim().toLocaleLowerCase()
  const groups = new Map<string, SchemaGroup>()

  for (const name of props.databaseNames) {
    if (!term || name.toLocaleLowerCase().includes(term)) {
      groups.set(name, emptySchema(name))
    }
  }

  for (const object of props.objects) {
    const key = databaseObjectKey(object)
    const matchesColumn = (props.columnsByObject[key] ?? []).some(column =>
      column.name.toLocaleLowerCase().includes(term)
    )
    const searchable =
      `${object.schema}.${object.name} ${object.identity}`.toLocaleLowerCase()
    if (term && !searchable.includes(term) && !matchesColumn) continue

    const group = groups.get(object.schema) ?? emptySchema(object.schema)
    if (object.kind === 'view') group.views.push(object)
    else if (object.kind === 'procedure') group.procedures.push(object)
    else if (object.kind === 'function') group.functions.push(object)
    else group.tables.push(object)
    groups.set(object.schema, group)
  }

  for (const query of props.savedQueries) {
    // 已保存查询是本地数据，不能凭它在当前连接中虚构一个尚未读取或已删除的库。
    if (
      props.databaseKind === 'mysql' &&
      !props.databaseNames.includes(query.database)
    )
      continue
    const searchable =
      `${query.database}.${query.name} ${query.sql}`.toLocaleLowerCase()
    if (term && !searchable.includes(term)) continue
    const group = groups.get(query.database) ?? emptySchema(query.database)
    group.queries.push(query)
    groups.set(query.database, group)
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      queries: [...group.queries].sort(
        (a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name)
      ),
      tables: [...group.tables].sort((a, b) => a.name.localeCompare(b.name)),
      views: [...group.views].sort((a, b) => a.name.localeCompare(b.name)),
      procedures: [...group.procedures].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      functions: [...group.functions].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

function createObjectItems(schema: string): ContextMenuItem[] {
  return [
    {
      id: `create-table:${schema}`,
      label: t('新建表'),
      icon: 'lucide:table-2',
      iconTone: 'blue',
    },
    {
      id: `create-view:${schema}`,
      label: t('新建视图'),
      icon: 'lucide:eye',
      iconTone: 'violet',
    },
    {
      id: `create-procedure:${schema}`,
      label: t('新建存储过程'),
      icon: 'lucide:workflow',
      iconTone: 'violet',
    },
    {
      id: `create-function:${schema}`,
      label: t('新建函数'),
      icon: 'lucide:braces',
      iconTone: 'amber',
    },
  ]
}

const transferDatabase = computed(() =>
  props.databaseKind === 'postgresql'
    ? props.currentDatabase || props.activeDatabase
    : context.target === 'database'
      ? context.database
      : props.activeDatabase
)
const transferItems = computed<ContextMenuItem[]>(() => [
  {
    id: 'export-database',
    label:
      props.databaseKind === 'postgresql'
        ? t('导出当前数据库…')
        : t('导出数据库…'),
    icon: 'lucide:database-backup',
    iconTone: 'blue',
    separatorBefore: true,
    disabled:
      props.loading || props.preparingTransfer || !transferDatabase.value,
  },
  {
    id: 'import-database',
    label:
      props.databaseKind === 'postgresql'
        ? t('导入到当前数据库…')
        : t('导入数据库…'),
    icon: 'lucide:file-input',
    iconTone: 'blue',
    disabled:
      props.loading || props.preparingTransfer || !transferDatabase.value,
  },
])

const contextItems = computed<ContextMenuItem[]>(() => {
  if (context.target === 'root') {
    return [
      {
        id: 'create-database',
        label: t('新建数据库'),
        icon: 'lucide:database',
        iconTone: 'violet',
      },
      {
        id: 'new-query',
        label: t('新建查询'),
        icon: 'lucide:square-terminal',
        iconTone: 'blue',
      },
      {
        id: 'refresh',
        label: t('刷新数据库列表'),
        icon: 'lucide:rotate-cw',
        separatorBefore: true,
      },
      ...transferItems.value,
    ]
  }

  if (context.target === 'database') {
    if (props.databaseKind === 'postgresql') {
      return [
        {
          id: 'schema-label',
          label: 'Schema',
          icon: 'lucide:layers-3',
          disabled: true,
          groupLabel: context.database,
        },
        {
          id: 'new-query',
          label: t('新建查询'),
          icon: 'lucide:square-terminal',
          iconTone: 'blue',
        },
        {
          id: 'create-object',
          label: t('新建对象'),
          icon: 'lucide:plus',
          children: createObjectItems(context.database),
        },
        {
          id: 'refresh',
          label: t('刷新对象树'),
          icon: 'lucide:rotate-cw',
          separatorBefore: true,
        },
        ...transferItems.value,
      ]
    }
    const active = context.database === props.activeDatabase
    return [
      {
        id: 'activate-database',
        label: active ? t('当前数据库') : t('设为当前数据库'),
        icon: 'lucide:circle-check',
        checked: active,
        disabled: active,
        groupLabel: context.database,
      },
      {
        id: 'new-query',
        label: t('新建查询'),
        icon: 'lucide:square-terminal',
        iconTone: 'blue',
      },
      {
        id: 'create-object',
        label: t('新建对象'),
        icon: 'lucide:plus',
        children: createObjectItems(context.database),
      },
      ...transferItems.value,
      {
        id: 'rename-database',
        label:
          props.databaseKind === 'mysql'
            ? t('迁移/重命名数据库…')
            : t('重命名数据库…'),
        icon: 'lucide:pencil',
        separatorBefore: true,
      },
      { id: 'refresh', label: t('刷新'), icon: 'lucide:rotate-cw' },
      {
        id: 'remove-database',
        label: t('删除数据库…'),
        icon: 'lucide:trash-2',
        iconTone: 'danger',
        danger: true,
        separatorBefore: true,
      },
    ]
  }

  if (context.target === 'category') {
    return [
      {
        id: 'create-current-object',
        label: t('新建{value0}', { value0: kindLabel(context.category) }),
        icon: 'lucide:plus',
        iconTone: 'violet',
        groupLabel: `${context.database} / ${kindLabel(context.category)}`,
      },
      { id: 'new-query', label: t('新建查询'), icon: 'lucide:square-terminal' },
      {
        id: 'refresh',
        label: t('刷新对象树'),
        icon: 'lucide:rotate-cw',
        separatorBefore: true,
      },
    ]
  }

  if (context.target === 'query-category') {
    return [
      {
        id: 'create-saved-query',
        label: t('新建已保存查询'),
        icon: 'lucide:file-plus-2',
        iconTone: 'blue',
        groupLabel: `${context.database} / Queries`,
      },
      {
        id: 'new-query',
        label: t('新建临时查询'),
        icon: 'lucide:square-terminal',
      },
    ]
  }

  if (context.target === 'saved-query') {
    const query = context.savedQuery
    if (!query) return []
    return [
      {
        id: 'open-saved-query',
        label: t('打开查询'),
        icon: 'lucide:file-code-2',
        iconTone: 'blue',
        groupLabel: query.name,
      },
      {
        id: 'duplicate-saved-query',
        label: t('创建副本'),
        icon: 'lucide:copy-plus',
      },
      {
        id: 'rename-saved-query',
        label: t('重命名…'),
        icon: 'lucide:pencil',
        separatorBefore: true,
      },
      {
        id: 'remove-saved-query',
        label: t('删除查询…'),
        icon: 'lucide:trash-2',
        iconTone: 'danger',
        danger: true,
      },
    ]
  }

  return []
})

function kindLabel(kind: DatabaseObjectKind): string {
  if (kind === 'table') return t('表')
  if (kind === 'view') return t('视图')
  if (kind === 'procedure') return t('存储过程')
  return t('函数')
}

function schemaLoading(name: string): boolean {
  return (
    props.loading &&
    (props.databaseKind === 'postgresql' || name === props.activeDatabase)
  )
}

function schemaError(name: string): string {
  return props.databaseKind === 'postgresql' || name === props.activeDatabase
    ? props.error
    : ''
}

function toggle(key: string): void {
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
}

/**
 * 点击数据库时先判断缓存；未加载的库保持折叠，只在箭头处展示加载图标。
 * 已缓存的库立即切换展开状态，连续点击同一个待加载库不会重复请求或闪烁。
 */
function selectSchema(name: string): void {
  if (
    props.preparingTransfer ||
    props.switchingDisabled ||
    state.pendingSchema === name
  )
    return
  if (props.databaseKind === 'mysql' && !props.loadedDatabases?.has(name)) {
    state.pendingSchema = name
    emit('selectSchema', name)
    return
  }
  state.pendingSchema = ''
  toggle(`schema:${name}`)
  emit('selectSchema', name)
}

// 成功后才展开当前请求；切换目标或请求失败时停止等待，保留其他库的展开缓存。
watch(
  () =>
    [
      props.loading,
      props.activeDatabase,
      props.loadedDatabases?.has(state.pendingSchema),
      props.error,
      props.switchingDisabled,
    ] as const,
  ([loading, active, loaded, error, disabled]) => {
    const pending = state.pendingSchema
    if (!pending || loading) return
    if (active === pending && loaded && !error) {
      expanded.add(`schema:${pending}`)
      state.pendingSchema = ''
    } else if (error || disabled) state.pendingSchema = ''
  }
)

function selectObject(object: DatabaseObject): void {
  selectedKey.value = databaseObjectKey(object)
  if (object.kind === 'table' || object.kind === 'view') emit('inspect', object)
}

function showContext(
  event: MouseEvent,
  target: ContextTarget,
  options: {
    database?: string
    category?: DatabaseObjectKind
    object?: DatabaseObject
    savedQuery?: SavedDatabaseQuery
  } = {}
): void {
  context.x = event.clientX
  context.y = event.clientY
  context.target = target
  context.database = options.database ?? ''
  context.category = options.category ?? 'table'
  context.object = options.object ?? null
  context.savedQuery = options.savedQuery ?? null
  if (options.object) selectedKey.value = databaseObjectKey(options.object)
  context.open = true
}

const treeRef = useTemplateRef<HTMLElement>('tree')
const searchRef =
  useTemplateRef<InstanceType<typeof SearchField>>('searchField')
/** 类型首字母跳转：短时间内连续输入的字符拼成前缀。 */
const typeahead = { text: '', at: 0 }

/** 当前可见的树节点（排除正在收起过渡中的分组），按 DOM 顺序。 */
function treeItems(): HTMLElement[] {
  const root = treeRef.value
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter(
    item => !item.closest('[data-tree-collapsed]') && !item.matches(':disabled')
  )
}

/** 漫游 tabindex：整棵树只有一个可 Tab 进入的节点。 */
function focusItem(item: HTMLElement | undefined): void {
  if (!item) return
  const focusable = treeRef.value?.querySelectorAll<HTMLElement>(
    '[role="treeitem"][tabindex="0"]'
  )
  for (const other of focusable ?? []) if (other !== item) other.tabIndex = -1
  item.tabIndex = 0
  item.focus({ preventScroll: true })
  item.scrollIntoView({ block: 'nearest' })
}

function onTreeFocusin(event: FocusEvent): void {
  const item = (event.target as HTMLElement).closest<HTMLElement>(
    '[role="treeitem"]'
  )
  if (item && item.tabIndex !== 0) focusItem(item)
}

// 列表变化后保证至少有一个节点可被 Tab 聚焦。
watch(
  schemas,
  async () => {
    await nextTick()
    const items = treeItems()
    if (items.length && !items.some(item => item.tabIndex === 0))
      items[0]!.tabIndex = 0
  },
  { immediate: true, flush: 'post' }
)

function itemLevel(item: HTMLElement): number {
  return Number(item.getAttribute('aria-level') ?? 1)
}

function parentItem(
  items: HTMLElement[],
  index: number
): HTMLElement | undefined {
  const level = itemLevel(items[index]!)
  for (let i = index - 1; i >= 0; i--)
    if (itemLevel(items[i]!) < level) return items[i]
  return undefined
}

function typeaheadTarget(
  items: HTMLElement[],
  index: number,
  key: string
): HTMLElement | undefined {
  const now = Date.now()
  typeahead.text =
    (now - typeahead.at < 700 ? typeahead.text : '') + key.toLocaleLowerCase()
  typeahead.at = now
  // 重复按同一字符时在同首字母的节点间循环。
  const repeated = [...typeahead.text].every(
    char => char === typeahead.text[0]
  )
  const prefix = repeated ? typeahead.text[0]! : typeahead.text
  const start = repeated || index < 0 ? index + 1 : index
  return [...items.slice(start), ...items.slice(0, start)].find(item =>
    (item.dataset.treeLabel ?? '').toLocaleLowerCase().startsWith(prefix)
  )
}

/**
 * 对象树键盘导航（WAI-ARIA Tree View）：节点自身处理展开/打开/重命名/删除并
 * preventDefault，这里只处理未被消费的移动类按键。
 */
function onTreeKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
    return
  const items = treeItems()
  const current = (event.target as HTMLElement).closest<HTMLElement>(
    '[role="treeitem"]'
  )
  const index = current ? items.indexOf(current) : -1
  let next: HTMLElement | undefined
  if (event.key === 'ArrowDown')
    next = items[Math.min(index + 1, items.length - 1)]
  else if (event.key === 'ArrowUp') next = items[Math.max(index - 1, 0)]
  else if (event.key === 'Home') next = items[0]
  else if (event.key === 'End') next = items.at(-1)
  else if (event.key === 'ArrowRight') {
    // 已展开时进入第一个子节点；叶子节点不动。
    const child = items[index + 1]
    if (
      current?.getAttribute('aria-expanded') === 'true' &&
      child &&
      itemLevel(child) > itemLevel(current)
    )
      next = child
  } else if (event.key === 'ArrowLeft') {
    if (index >= 0) next = parentItem(items, index)
  } else if (event.key.length === 1 && event.key.trim()) {
    next = typeaheadTarget(items, index, event.key)
    if (!next) return
  } else return
  event.preventDefault()
  focusItem(next)
}

function schemaKeydown(event: KeyboardEvent, name: string): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const open = expanded.has(`schema:${name}`)
  const editable = props.databaseKind !== 'postgresql'
  if (event.key === 'ArrowRight' && !open) selectSchema(name)
  else if (event.key === 'ArrowLeft' && open) expanded.delete(`schema:${name}`)
  else if (event.key === 'F2' && editable) emit('renameDatabase', name)
  else if (event.key === 'Delete' && editable) emit('removeDatabase', name)
  else return
  event.preventDefault()
}

/** 供快捷键聚焦对象树过滤框。 */
function focusFilter(): void {
  searchRef.value?.focus()
}

defineExpose({ focusFilter })

function handleContextAction(id: string): void {
  const savedQuery = context.savedQuery
  if (id === 'create-database') emit('createDatabase')
  else if (id === 'activate-database' && context.database)
    emit('selectDatabase', context.database)
  else if (id === 'new-query') emit('newQuery', context.database || undefined)
  else if (id === 'export-database')
    emit('exportDatabase', transferDatabase.value)
  else if (id === 'import-database')
    emit('importDatabase', transferDatabase.value)
  else if (id === 'create-saved-query')
    emit('createSavedQuery', context.database)
  else if (id === 'open-saved-query' && savedQuery)
    emit('openSavedQuery', savedQuery)
  else if (id === 'duplicate-saved-query' && savedQuery)
    emit('duplicateSavedQuery', savedQuery)
  else if (id === 'rename-saved-query' && savedQuery)
    emit('renameSavedQuery', savedQuery)
  else if (id === 'remove-saved-query' && savedQuery)
    emit('removeSavedQuery', savedQuery)
  else if (id === 'create-current-object')
    emit('createObject', context.database, context.category)
  else if (id.startsWith('create-')) {
    const separator = id.indexOf(':')
    if (separator > 0)
      emit(
        'createObject',
        id.slice(separator + 1),
        id.slice(7, separator) as DatabaseObjectKind
      )
  } else if (id === 'rename-database') emit('renameDatabase', context.database)
  else if (id === 'remove-database') emit('removeDatabase', context.database)
  else if (id === 'refresh') emit('refresh')
}
</script>

<template>
  <nav
    class="border-line-soft bg-panel flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-r"
    :aria-label="t('数据库对象')"
    @contextmenu.prevent="showContext($event, 'root')"
  >
    <div
      class="border-line-soft flex h-10 shrink-0 items-center gap-1 border-b px-2"
    >
      <AppIcon
        name="lucide:database"
        :size="14"
        class="text-pink ml-1"
      />
      <span
        class="text-txt-2 min-w-0 flex-1 truncate px-1 text-xs"
        :title="databaseName"
      >
        {{ databaseName }}
      </span>
      <IconButton
        icon="lucide:square-terminal"
        :size="13"
        :title="t('在当前数据库中新建查询')"
        @click.stop="emit('newQuery', activeDatabase || undefined)"
      />
      <IconButton
        icon="lucide:plus"
        :size="13"
        :title="t('新建数据库')"
        @click.stop="emit('createDatabase')"
      />
      <IconButton
        icon="lucide:rotate-cw"
        :size="13"
        :title="t('刷新对象树')"
        :disabled="loading || databasesLoading || preparingTransfer"
        @click.stop="emit('refresh')"
      />
    </div>

    <div class="border-line-soft shrink-0 border-b p-1.5">
      <SearchField
        ref="searchField"
        v-model="search"
        icon="lucide:search"
        :placeholder="t('搜索查询、表、视图或存储过程')"
      />
    </div>

    <div
      ref="tree"
      class="scroll-thin flex-1 overflow-y-auto p-1.5"
      role="tree"
      :aria-label="t('数据库对象')"
      @keydown="onTreeKeydown"
      @focusin="onTreeFocusin"
    >
      <div
        v-if="(loading || databasesLoading) && !schemas.length"
        class="space-y-3 px-2 py-3 motion-safe:animate-pulse"
        role="status"
        :aria-label="t('正在读取数据库结构…')"
      >
        <div
          v-for="width in ['w-3/4', 'w-1/2', 'w-2/3']"
          :key="width"
          :class="cn('bg-txt-4/15 h-3 rounded-sm', width)"
          aria-hidden="true"
        />
      </div>
      <div
        v-else-if="error && !objects.length"
        class="text-txt-4 px-2 py-3 text-[11px] leading-5"
      >
        {{ t('对象列表加载失败，请刷新重试') }}
      </div>
      <div
        v-else-if="
          ready !== false && !loading && !databasesLoading && !schemas.length
        "
        class="text-txt-4 px-2 py-3 text-[11px]"
      >
        {{ t('当前连接中没有可显示的数据库对象') }}
      </div>

      <template
        v-for="schema in schemas"
        :key="schema.name"
      >
        <AppButton
          variant="bare"
          :class="
            cn(
              'nav-item h-7 w-full gap-1.5 text-xs',
              schema.name === activeDatabase && 'text-txt'
            )
          "
          role="treeitem"
          tabindex="-1"
          aria-level="1"
          :aria-expanded="expanded.has(`schema:${schema.name}`)"
          :aria-selected="schema.name === activeDatabase"
          :data-tree-key="`schema:${schema.name}`"
          :data-tree-label="schema.name"
          :disabled="preparingTransfer || switchingDisabled"
          :aria-busy="state.pendingSchema === schema.name"
          @click.stop="selectSchema(schema.name)"
          @keydown="schemaKeydown($event, schema.name)"
          @contextmenu.prevent.stop="
            showContext($event, 'database', { database: schema.name })
          "
        >
          <AppIcon
            :name="
              state.pendingSchema === schema.name
                ? 'lucide:loader-circle'
                : 'lucide:chevron-right'
            "
            :size="12"
            :class="
              cn(
                'text-txt-4 motion-safe:transition-transform',
                state.pendingSchema === schema.name &&
                  'text-accent animate-spin',
                expanded.has(`schema:${schema.name}`) && 'rotate-90'
              )
            "
          />
          <AppIcon
            name="lucide:layers-3"
            :size="13"
            class="text-txt-3"
          />
          <span class="min-w-0 flex-1 truncate text-left">{{
            schema.name
          }}</span>
          <span
            v-if="databaseKind === 'mysql' && schema.name === activeDatabase"
            class="bg-accent size-1.5 shrink-0 rounded-full shadow-[0_0_7px_var(--color-accent)]"
            :title="t('当前数据库')"
          />
        </AppButton>

        <DatabaseTreeCollapse :open="expanded.has(`schema:${schema.name}`)">
          <DatabaseObjectCategory
            :schema="schema.name"
            kind="table"
            :label="t('Tables')"
            icon="lucide:table-2"
            icon-class="text-blue"
            :objects="schema.tables"
            :loading="schemaLoading(schema.name)"
            :error="schemaError(schema.name)"
            :selected-key="selectedKey"
            :columns-by-object="columnsByObject"
            :inspecting-keys="inspectingKeys"
            :default-expanded="schema.name === activeDatabase"
            @select="selectObject"
            @open="emit('open', $event)"
            @rename="emit('renameObject', $event)"
            @remove="emit('removeObject', $event)"
            @context="
              (event, object) =>
                showContext(event, 'object', {
                  database: object.schema,
                  object,
                })
            "
            @category-context="
              (event, database, category) =>
                showContext(event, 'category', { database, category })
            "
          />
          <DatabaseSavedQueryCategory
            :database="schema.name"
            :queries="schema.queries"
            :selected-id="selectedSavedQueryId"
            :default-expanded="
              schema.name === activeDatabase && schema.queries.length > 0
            "
            @create="emit('createSavedQuery', $event)"
            @open="emit('openSavedQuery', $event)"
            @rename="emit('renameSavedQuery', $event)"
            @remove="emit('removeSavedQuery', $event)"
            @context="
              (event, query) =>
                showContext(event, 'saved-query', {
                  database: query.database,
                  savedQuery: query,
                })
            "
            @category-context="
              (event, database) =>
                showContext(event, 'query-category', { database })
            "
          />
          <DatabaseObjectCategory
            :schema="schema.name"
            kind="view"
            :label="t('Views')"
            icon="lucide:eye"
            icon-class="text-accent"
            :objects="schema.views"
            :loading="schemaLoading(schema.name)"
            :error="schemaError(schema.name)"
            :selected-key="selectedKey"
            :columns-by-object="columnsByObject"
            :inspecting-keys="inspectingKeys"
            :default-expanded="
              schema.name === activeDatabase && schema.views.length > 0
            "
            @select="selectObject"
            @open="emit('open', $event)"
            @rename="emit('renameObject', $event)"
            @remove="emit('removeObject', $event)"
            @context="
              (event, object) =>
                showContext(event, 'object', {
                  database: object.schema,
                  object,
                })
            "
            @category-context="
              (event, database, category) =>
                showContext(event, 'category', { database, category })
            "
          />
          <DatabaseObjectCategory
            :schema="schema.name"
            kind="procedure"
            :label="t('Stored Procedures')"
            icon="lucide:workflow"
            icon-class="text-violet"
            :objects="schema.procedures"
            :loading="schemaLoading(schema.name)"
            :error="schemaError(schema.name)"
            :selected-key="selectedKey"
            :columns-by-object="columnsByObject"
            :inspecting-keys="inspectingKeys"
            :default-expanded="
              schema.name === activeDatabase && schema.procedures.length > 0
            "
            @select="selectObject"
            @open="emit('open', $event)"
            @rename="emit('renameObject', $event)"
            @remove="emit('removeObject', $event)"
            @context="
              (event, object) =>
                showContext(event, 'object', {
                  database: object.schema,
                  object,
                })
            "
            @category-context="
              (event, database, category) =>
                showContext(event, 'category', { database, category })
            "
          />
          <DatabaseObjectCategory
            :schema="schema.name"
            kind="function"
            :label="t('Functions')"
            icon="lucide:braces"
            icon-class="text-amber"
            :objects="schema.functions"
            :loading="schemaLoading(schema.name)"
            :error="schemaError(schema.name)"
            :selected-key="selectedKey"
            :columns-by-object="columnsByObject"
            :inspecting-keys="inspectingKeys"
            :default-expanded="
              schema.name === activeDatabase && schema.functions.length > 0
            "
            @select="selectObject"
            @open="emit('open', $event)"
            @rename="emit('renameObject', $event)"
            @remove="emit('removeObject', $event)"
            @context="
              (event, object) =>
                showContext(event, 'object', {
                  database: object.schema,
                  object,
                })
            "
            @category-context="
              (event, database, category) =>
                showContext(event, 'category', { database, category })
            "
          />
        </DatabaseTreeCollapse>
      </template>
    </div>

    <DatabaseObjectContextMenu
      v-if="context.target === 'object'"
      :open="context.open"
      :x="context.x"
      :y="context.y"
      :object="context.object"
      @close="context.open = false"
      @open="(object, panel) => emit('open', object, panel)"
      @inspect="emit('inspect', $event)"
      @ask-agent="emit('askAgent', $event)"
      @query="emit('query', $event)"
      @copy="emit('copy', $event)"
      @rename="emit('renameObject', $event)"
      @remove="emit('removeObject', $event)"
      @design="emit('designObject', $event)"
      @truncate="emit('truncateObject', $event)"
      @refresh="emit('refresh')"
    />
    <AppContextMenu
      v-else
      :open="context.open"
      :x="context.x"
      :y="context.y"
      :items="contextItems"
      :label="t('数据库对象操作')"
      @close="context.open = false"
      @select="handleContextAction"
    />
  </nav>
</template>
