<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
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
import DatabaseSavedQueryCategory from './DatabaseSavedQueryCategory.vue'

const props = defineProps<{
  databaseName: string
  databaseKind: DatabaseKind
  activeDatabase: string
  databaseNames: readonly string[]
  objects: DatabaseObject[]
  savedQueries: readonly SavedDatabaseQuery[]
  selectedSavedQueryId: string
  columnsByObject: Record<string, DatabaseColumn[] | undefined>
  inspectingKeys: Set<string>
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  refresh: []
  inspect: [object: DatabaseObject]
  open: [object: DatabaseObject, panel?: 'data' | 'columns']
  query: [object: DatabaseObject]
  copy: [object: DatabaseObject]
  selectDatabase: [name: string]
  createDatabase: []
  createObject: [schema: string, kind: DatabaseObjectKind]
  newQuery: [schema?: string]
  renameDatabase: [name: string]
  removeDatabase: [name: string]
  renameObject: [object: DatabaseObject]
  removeObject: [object: DatabaseObject]
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

watch(
  schemas,
  next => {
    const preferred =
      next.find(schema => schema.name === props.activeDatabase) ?? next[0]
    if (preferred) expanded.add(`schema:${preferred.name}`)
  },
  { immediate: true }
)

function createObjectItems(schema: string): ContextMenuItem[] {
  return [
    {
      id: `create-table:${schema}`,
      label: '新建表',
      icon: 'lucide:table-2',
      iconTone: 'blue',
    },
    {
      id: `create-view:${schema}`,
      label: '新建视图',
      icon: 'lucide:eye',
      iconTone: 'violet',
    },
    {
      id: `create-procedure:${schema}`,
      label: '新建存储过程',
      icon: 'lucide:workflow',
      iconTone: 'violet',
    },
    {
      id: `create-function:${schema}`,
      label: '新建函数',
      icon: 'lucide:braces',
      iconTone: 'amber',
    },
  ]
}

const contextItems = computed<ContextMenuItem[]>(() => {
  if (context.target === 'root') {
    return [
      {
        id: 'create-database',
        label: '新建数据库',
        icon: 'lucide:database',
        iconTone: 'violet',
      },
      {
        id: 'new-query',
        label: '新建查询',
        icon: 'lucide:square-terminal',
        iconTone: 'blue',
      },
      {
        id: 'refresh',
        label: '刷新数据库列表',
        icon: 'lucide:rotate-cw',
        separatorBefore: true,
      },
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
          label: '新建查询',
          icon: 'lucide:square-terminal',
          iconTone: 'blue',
        },
        {
          id: 'create-object',
          label: '新建对象',
          icon: 'lucide:plus',
          children: createObjectItems(context.database),
        },
        {
          id: 'refresh',
          label: '刷新对象树',
          icon: 'lucide:rotate-cw',
          separatorBefore: true,
        },
      ]
    }
    const active = context.database === props.activeDatabase
    return [
      {
        id: 'activate-database',
        label: active ? '当前数据库' : '设为当前数据库',
        icon: 'lucide:circle-check',
        checked: active,
        disabled: active,
        groupLabel: context.database,
      },
      {
        id: 'new-query',
        label: '新建查询',
        icon: 'lucide:square-terminal',
        iconTone: 'blue',
      },
      {
        id: 'create-object',
        label: '新建对象',
        icon: 'lucide:plus',
        children: createObjectItems(context.database),
      },
      {
        id: 'rename-database',
        label:
          props.databaseKind === 'mysql'
            ? '迁移/重命名数据库…'
            : '重命名数据库…',
        icon: 'lucide:pencil',
        separatorBefore: true,
      },
      { id: 'refresh', label: '刷新', icon: 'lucide:rotate-cw' },
      {
        id: 'remove-database',
        label: '删除数据库…',
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
        label: `新建${kindLabel(context.category)}`,
        icon: 'lucide:plus',
        iconTone: 'violet',
        groupLabel: `${context.database} / ${kindLabel(context.category)}`,
      },
      { id: 'new-query', label: '新建查询', icon: 'lucide:square-terminal' },
      {
        id: 'refresh',
        label: '刷新对象树',
        icon: 'lucide:rotate-cw',
        separatorBefore: true,
      },
    ]
  }

  if (context.target === 'query-category') {
    return [
      {
        id: 'create-saved-query',
        label: '新建已保存查询',
        icon: 'lucide:file-plus-2',
        iconTone: 'blue',
        groupLabel: `${context.database} / Queries`,
      },
      {
        id: 'new-query',
        label: '新建临时查询',
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
        label: '打开查询',
        icon: 'lucide:file-code-2',
        iconTone: 'blue',
        groupLabel: query.name,
      },
      {
        id: 'duplicate-saved-query',
        label: '创建副本',
        icon: 'lucide:copy-plus',
      },
      {
        id: 'rename-saved-query',
        label: '重命名…',
        icon: 'lucide:pencil',
        separatorBefore: true,
      },
      {
        id: 'remove-saved-query',
        label: '删除查询…',
        icon: 'lucide:trash-2',
        iconTone: 'danger',
        danger: true,
      },
    ]
  }

  const object = context.object
  if (!object) return []
  const relation = object.kind === 'table' || object.kind === 'view'
  return [
    {
      id: 'open-object',
      label: object.kind === 'table' ? '浏览数据' : '打开对象',
      icon: relation ? 'lucide:table-2' : 'lucide:file-code-2',
      groupLabel: `${object.schema}.${object.name}`,
    },
    {
      id: 'query-object',
      label: relation
        ? '生成 SELECT 查询'
        : object.kind === 'procedure'
          ? '生成 CALL 查询'
          : '生成函数查询',
      icon: 'lucide:square-terminal',
    },
    {
      id: 'structure-object',
      label: '查看结构',
      icon: 'lucide:columns-3',
      disabled: !relation,
    },
    {
      id: 'copy-object',
      label: '复制限定名称',
      icon: 'lucide:copy',
      separatorBefore: true,
    },
    { id: 'rename-object', label: '重命名…', icon: 'lucide:pencil' },
    { id: 'refresh', label: '刷新对象树', icon: 'lucide:rotate-cw' },
    {
      id: 'remove-object',
      label: `删除${kindLabel(object.kind)}…`,
      icon: 'lucide:trash-2',
      iconTone: 'danger',
      danger: true,
      separatorBefore: true,
    },
  ]
})

function kindLabel(kind: DatabaseObjectKind): string {
  if (kind === 'table') return '表'
  if (kind === 'view') return '视图'
  if (kind === 'procedure') return '存储过程'
  return '函数'
}

function toggle(key: string): void {
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
}

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

function handleContextAction(id: string): void {
  const object = context.object
  const savedQuery = context.savedQuery
  if (id === 'create-database') emit('createDatabase')
  else if (id === 'activate-database' && context.database)
    emit('selectDatabase', context.database)
  else if (id === 'new-query') emit('newQuery', context.database || undefined)
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
  else if (id === 'open-object' && object) emit('open', object)
  else if (id === 'query-object' && object) emit('query', object)
  else if (id === 'structure-object' && object) {
    emit('inspect', object)
    emit('open', object, 'columns')
  } else if (id === 'copy-object' && object) emit('copy', object)
  else if (id === 'rename-object' && object) emit('renameObject', object)
  else if (id === 'remove-object' && object) emit('removeObject', object)
  else if (id === 'refresh') emit('refresh')
}
</script>

<template>
  <nav
    class="border-line-soft bg-panel flex w-[248px] shrink-0 flex-col border-r"
    aria-label="数据库对象"
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
        title="在当前数据库中新建查询"
        @click.stop="emit('newQuery', activeDatabase || undefined)"
      />
      <IconButton
        icon="lucide:plus"
        :size="13"
        title="新建数据库"
        @click.stop="emit('createDatabase')"
      />
      <IconButton
        icon="lucide:rotate-cw"
        :size="13"
        title="刷新对象树"
        :disabled="loading"
        @click.stop="emit('refresh')"
      />
    </div>

    <div class="border-line-soft shrink-0 border-b p-1.5">
      <SearchField
        v-model="search"
        icon="lucide:search"
        placeholder="搜索查询、表、视图或存储过程"
      />
    </div>

    <div class="scroll-thin flex-1 overflow-y-auto p-1.5">
      <div
        v-if="loading && !objects.length && !savedQueries.length"
        class="text-txt-4 px-2 py-3 text-[11px]"
      >
        正在读取数据库结构…
      </div>
      <div
        v-else-if="error && !objects.length && !savedQueries.length"
        class="text-txt-4 px-2 py-3 text-[11px] leading-5"
      >
        对象列表加载失败，请刷新重试
      </div>
      <div
        v-else-if="!schemas.length"
        class="text-txt-4 px-2 py-3 text-[11px]"
      >
        当前连接中没有可显示的数据库对象
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
          :aria-expanded="expanded.has(`schema:${schema.name}`)"
          @click.stop="toggle(`schema:${schema.name}`)"
          @dblclick.stop="
            databaseKind === 'mysql' && emit('selectDatabase', schema.name)
          "
          @contextmenu.prevent.stop="
            showContext($event, 'database', { database: schema.name })
          "
        >
          <AppIcon
            name="lucide:chevron-right"
            :size="12"
            :class="
              cn(
                'text-txt-4 transition-transform',
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
            title="当前数据库"
          />
        </AppButton>

        <template v-if="expanded.has(`schema:${schema.name}`)">
          <DatabaseObjectCategory
            :schema="schema.name"
            kind="table"
            label="Tables"
            icon="lucide:table-2"
            icon-class="text-blue"
            :objects="schema.tables"
            :selected-key="selectedKey"
            :columns-by-object="columnsByObject"
            :inspecting-keys="inspectingKeys"
            :default-expanded="schema.name === activeDatabase"
            @select="selectObject"
            @open="emit('open', $event)"
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
            label="Views"
            icon="lucide:eye"
            icon-class="text-accent"
            :objects="schema.views"
            :selected-key="selectedKey"
            :columns-by-object="columnsByObject"
            :inspecting-keys="inspectingKeys"
            :default-expanded="
              schema.name === activeDatabase && schema.views.length > 0
            "
            @select="selectObject"
            @open="emit('open', $event)"
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
            label="Stored Procedures"
            icon="lucide:workflow"
            icon-class="text-violet"
            :objects="schema.procedures"
            :selected-key="selectedKey"
            :columns-by-object="columnsByObject"
            :inspecting-keys="inspectingKeys"
            :default-expanded="
              schema.name === activeDatabase && schema.procedures.length > 0
            "
            @select="selectObject"
            @open="emit('open', $event)"
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
            label="Functions"
            icon="lucide:braces"
            icon-class="text-amber"
            :objects="schema.functions"
            :selected-key="selectedKey"
            :columns-by-object="columnsByObject"
            :inspecting-keys="inspectingKeys"
            :default-expanded="
              schema.name === activeDatabase && schema.functions.length > 0
            "
            @select="selectObject"
            @open="emit('open', $event)"
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
        </template>
      </template>
    </div>

    <AppContextMenu
      :open="context.open"
      :x="context.x"
      :y="context.y"
      :items="contextItems"
      label="数据库对象操作"
      @close="context.open = false"
      @select="handleContextAction"
    />
  </nav>
</template>
