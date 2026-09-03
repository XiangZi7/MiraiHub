<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { databaseObjectKey } from '@/composables/useDatabaseSession'
import type { DatabaseColumn, DatabaseObject } from '@/types/database'
import { cn } from '@/utils/cn'

const props = defineProps<{
  databaseName: string
  objects: DatabaseObject[]
  columnsByObject: Record<string, DatabaseColumn[] | undefined>
  inspectingKeys: Set<string>
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  refresh: []
  inspect: [object: DatabaseObject]
  open: [object: DatabaseObject]
}>()

interface SchemaGroup {
  name: string
  tables: DatabaseObject[]
  views: DatabaseObject[]
}

const expanded = reactive(new Set<string>(['database']))
const selectedKey = shallowRef('')

const schemas = computed<SchemaGroup[]>(() => {
  const groups = new Map<string, SchemaGroup>()
  for (const object of props.objects) {
    const group = groups.get(object.schema) ?? { name: object.schema, tables: [], views: [] }
    if (object.kind === 'view')
      group.views.push(object)
    else
      group.tables.push(object)
    groups.set(object.schema, group)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
})

watch(
  schemas,
  (next) => {
    if (!next.length)
      return
    const first = next[0]
    expanded.add(`schema:${first.name}`)
    expanded.add(`tables:${first.name}`)
  },
  { immediate: true },
)

function toggle(key: string): void {
  if (expanded.has(key))
    expanded.delete(key)
  else
    expanded.add(key)
}

function selectObject(object: DatabaseObject): void {
  const key = databaseObjectKey(object)
  selectedKey.value = key
  toggle(`object:${key}`)
  if (expanded.has(`object:${key}`))
    emit('inspect', object)
}

function columnsFor(object: DatabaseObject): DatabaseColumn[] {
  return props.columnsByObject[databaseObjectKey(object)] ?? []
}
</script>

<template>
  <nav class="flex w-[224px] shrink-0 flex-col border-r border-line-soft bg-panel">
    <div class="flex h-10 shrink-0 items-center gap-1 border-b border-line-soft px-2">
      <AppIcon name="lucide:database" :size="14" class="ml-1 text-pink" />
      <span class="min-w-0 flex-1 truncate px-1 text-xs text-txt-2" :title="databaseName">
        {{ databaseName }}
      </span>
      <IconButton
        icon="lucide:rotate-cw"
        :size="13"
        title="刷新对象树"
        :disabled="loading"
        @click="emit('refresh')"
      />
    </div>

    <div class="flex-1 overflow-y-auto p-1.5 scroll-thin">
      <div v-if="loading && !objects.length" class="px-2 py-3 text-[11px] text-txt-4">
        正在读取数据库结构…
      </div>
      <div v-else-if="error && !objects.length" class="px-2 py-3 text-[11px] leading-5 text-danger">
        {{ error }}
      </div>
      <div v-else-if="!schemas.length" class="px-2 py-3 text-[11px] text-txt-4">
        当前数据库中没有表或视图
      </div>

      <template v-for="schema in schemas" :key="schema.name">
        <button
          type="button"
          class="nav-item h-7 w-full gap-1.5 text-xs"
          @click="toggle(`schema:${schema.name}`)"
        >
          <AppIcon
            name="lucide:chevron-right"
            :size="12"
            :class="cn('text-txt-4 transition-transform', expanded.has(`schema:${schema.name}`) && 'rotate-90')"
          />
          <AppIcon name="lucide:layers-3" :size="13" class="text-txt-3" />
          <span class="truncate">{{ schema.name }}</span>
        </button>

        <template v-if="expanded.has(`schema:${schema.name}`)">
          <button
            v-if="schema.tables.length"
            type="button"
            class="nav-item h-7 w-full gap-1.5 pl-6 text-xs"
            @click="toggle(`tables:${schema.name}`)"
          >
            <AppIcon
              name="lucide:chevron-right"
              :size="12"
              :class="cn('text-txt-4 transition-transform', expanded.has(`tables:${schema.name}`) && 'rotate-90')"
            />
            <AppIcon name="lucide:table-2" :size="13" class="text-txt-3" />
            <span>Tables</span>
            <span class="ml-auto text-[10px] text-txt-4">{{ schema.tables.length }}</span>
          </button>

          <template v-if="expanded.has(`tables:${schema.name}`)">
            <template v-for="object in schema.tables" :key="databaseObjectKey(object)">
              <button
                type="button"
                :class="cn(
                  'nav-item h-7 w-full gap-1.5 pl-10 text-xs',
                  selectedKey === databaseObjectKey(object) && 'nav-item-active',
                )"
                :title="`${object.schema}.${object.name}（双击生成查询）`"
                @click="selectObject(object)"
                @dblclick="emit('open', object)"
              >
                <AppIcon
                  name="lucide:chevron-right"
                  :size="11"
                  :class="cn('text-txt-4 transition-transform', expanded.has(`object:${databaseObjectKey(object)}`) && 'rotate-90')"
                />
                <AppIcon name="lucide:table" :size="12" class="text-blue" />
                <span class="truncate">{{ object.name }}</span>
              </button>

              <template v-if="expanded.has(`object:${databaseObjectKey(object)}`)">
                <div
                  v-if="inspectingKeys.has(databaseObjectKey(object))"
                  class="py-1 pl-15 text-[10.5px] text-txt-4"
                >
                  读取字段…
                </div>
                <div
                  v-for="column in columnsFor(object)"
                  :key="`${databaseObjectKey(object)}:${column.name}`"
                  class="flex h-6 items-center gap-1.5 pr-2 pl-15 text-[10.5px] text-txt-3"
                  :title="`${column.dataType}${column.nullable ? ' · nullable' : ''}`"
                >
                  <AppIcon name="lucide:columns-3" :size="10" class="shrink-0 text-txt-4" />
                  <span class="min-w-0 flex-1 truncate">{{ column.name }}</span>
                  <span class="max-w-18 truncate font-mono text-[9.5px] text-txt-4">{{ column.dataType }}</span>
                </div>
              </template>
            </template>
          </template>

          <button
            v-if="schema.views.length"
            type="button"
            class="nav-item h-7 w-full gap-1.5 pl-6 text-xs"
            @click="toggle(`views:${schema.name}`)"
          >
            <AppIcon
              name="lucide:chevron-right"
              :size="12"
              :class="cn('text-txt-4 transition-transform', expanded.has(`views:${schema.name}`) && 'rotate-90')"
            />
            <AppIcon name="lucide:eye" :size="13" class="text-txt-3" />
            <span>Views</span>
            <span class="ml-auto text-[10px] text-txt-4">{{ schema.views.length }}</span>
          </button>

          <template v-if="expanded.has(`views:${schema.name}`)">
            <template v-for="object in schema.views" :key="databaseObjectKey(object)">
              <button
                type="button"
                :class="cn(
                  'nav-item h-7 w-full gap-1.5 pl-10 text-xs',
                  selectedKey === databaseObjectKey(object) && 'nav-item-active',
                )"
                :title="`${object.schema}.${object.name}（双击生成查询）`"
                @click="selectObject(object)"
                @dblclick="emit('open', object)"
              >
                <AppIcon
                  name="lucide:chevron-right"
                  :size="11"
                  :class="cn('text-txt-4 transition-transform', expanded.has(`object:${databaseObjectKey(object)}`) && 'rotate-90')"
                />
                <AppIcon name="lucide:eye" :size="12" class="text-violet" />
                <span class="truncate">{{ object.name }}</span>
              </button>
              <template v-if="expanded.has(`object:${databaseObjectKey(object)}`)">
                <div
                  v-if="inspectingKeys.has(databaseObjectKey(object))"
                  class="py-1 pl-15 text-[10.5px] text-txt-4"
                >
                  读取字段…
                </div>
                <div
                  v-for="column in columnsFor(object)"
                  :key="`${databaseObjectKey(object)}:${column.name}`"
                  class="flex h-6 items-center gap-1.5 pr-2 pl-15 text-[10.5px] text-txt-3"
                  :title="`${column.dataType}${column.nullable ? ' · nullable' : ''}`"
                >
                  <AppIcon name="lucide:columns-3" :size="10" class="shrink-0 text-txt-4" />
                  <span class="min-w-0 flex-1 truncate">{{ column.name }}</span>
                  <span class="max-w-18 truncate font-mono text-[9.5px] text-txt-4">{{ column.dataType }}</span>
                </div>
              </template>
            </template>
          </template>
        </template>
      </template>
    </div>
  </nav>
</template>
