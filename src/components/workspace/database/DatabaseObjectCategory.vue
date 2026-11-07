<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, useTemplateRef, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { databaseObjectKey } from '@/composables/useDatabaseSession'
import type {
  DatabaseColumn,
  DatabaseObject,
  DatabaseObjectKind,
} from '@/types/database'
import { cn } from '@/utils/cn'
import DatabaseTreeCollapse from './DatabaseTreeCollapse.vue'

const { t } = useI18n()

const props = defineProps<{
  schema: string
  kind: DatabaseObjectKind
  label: string
  icon: string
  iconClass: string
  objects: readonly DatabaseObject[]
  selectedKey: string
  columnsByObject: Record<string, DatabaseColumn[] | undefined>
  inspectingKeys: Set<string>
  defaultExpanded?: boolean
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  select: [object: DatabaseObject]
  open: [object: DatabaseObject]
  context: [event: MouseEvent, object: DatabaseObject]
  categoryContext: [event: MouseEvent, schema: string, kind: DatabaseObjectKind]
  rename: [object: DatabaseObject]
  remove: [object: DatabaseObject]
}>()

/**
 * 每批渲染的对象数。库里有几千张表时一次性挂出所有行（每行两个图标加提示）
 * 会让展开分类卡顿，先渲染一批，滚到底部再接着加。
 */
const PAGE_SIZE = 200

const state = reactive({
  expanded: Boolean(props.defaultExpanded),
  expandedObjects: new Set<string>(),
  limit: PAGE_SIZE,
})

const visibleObjects = computed(() => props.objects.slice(0, state.limit))
const remaining = computed(() => props.objects.length - state.limit)
const sentinel = useTemplateRef<InstanceType<typeof AppButton>>('sentinel')

function showMore(): void {
  state.limit += PAGE_SIZE
}

useIntersectionObserver(sentinel, entries => {
  if (entries.some(entry => entry.isIntersecting)) showMore()
})

// 选中项可能来自搜索或标签页切换，落在未渲染的批次里时把它所在批次也渲染出来。
watch(
  [() => props.selectedKey, () => props.objects],
  ([key]) => {
    const index = props.objects.findIndex(
      object => databaseObjectKey(object) === key
    )
    if (index >= state.limit)
      state.limit = Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE
  },
  { immediate: true }
)

const hasColumns = () => props.kind === 'table' || props.kind === 'view'

function columnsFor(object: DatabaseObject): DatabaseColumn[] {
  return props.columnsByObject[databaseObjectKey(object)] ?? []
}

function selectObject(object: DatabaseObject): void {
  emit('select', object)
  if (!hasColumns()) return

  const key = databaseObjectKey(object)
  if (state.expandedObjects.has(key)) state.expandedObjects.delete(key)
  else state.expandedObjects.add(key)
}

/** 对象行键盘：Enter 打开、→/← 展开收起字段、F2 重命名、Del 删除；其余交给对象树导航。 */
function objectKeydown(event: KeyboardEvent, object: DatabaseObject): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const key = databaseObjectKey(object)
  const open = state.expandedObjects.has(key)
  if (event.key === 'Enter') emit('open', object)
  else if (event.key === 'F2') emit('rename', object)
  else if (event.key === 'Delete') emit('remove', object)
  else if (event.key === 'ArrowRight' && hasColumns() && !open)
    selectObject(object)
  else if (event.key === 'ArrowLeft' && open) state.expandedObjects.delete(key)
  else return
  event.preventDefault()
}

function categoryKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight' && !state.expanded) state.expanded = true
  else if (event.key === 'ArrowLeft' && state.expanded) state.expanded = false
  else return
  event.preventDefault()
}

watch(
  () => props.defaultExpanded,
  expanded => {
    if (expanded) state.expanded = true
  }
)
</script>

<template>
  <AppButton
    variant="bare"
    class="nav-item h-7 w-full gap-1.5 pl-6 text-xs"
    role="treeitem"
    tabindex="-1"
    aria-level="2"
    :aria-expanded="state.expanded"
    :aria-busy="loading"
    :data-tree-key="`category:${schema}:${kind}`"
    :data-tree-label="label"
    @click="state.expanded = !state.expanded"
    @keydown="categoryKeydown"
    @contextmenu.prevent.stop="emit('categoryContext', $event, schema, kind)"
  >
    <AppIcon
      name="lucide:chevron-right"
      :size="12"
      :class="
        cn(
          'text-txt-4 motion-safe:transition-transform',
          state.expanded && 'rotate-90'
        )
      "
    />
    <AppIcon
      :name="icon"
      :size="13"
      :class="iconClass"
    />
    <span>{{ label }}</span>
    <span
      v-if="loading"
      class="bg-txt-4/15 ml-auto h-2 w-3 rounded-sm motion-safe:animate-pulse"
      aria-hidden="true"
    />
    <span
      v-else
      class="text-txt-4 ml-auto text-[10px]"
      >{{ error ? '—' : objects.length }}</span
    >
  </AppButton>

  <DatabaseTreeCollapse :open="state.expanded">
    <div
      v-if="loading && !objects.length"
      class="space-y-2 py-2 pr-4 pl-10 motion-safe:animate-pulse"
      role="status"
      :aria-label="t('正在读取数据库结构…')"
    >
      <div
        v-for="width in ['w-4/5', 'w-3/5', 'w-2/3']"
        :key="width"
        :class="cn('bg-txt-4/15 h-2.5 rounded-sm', width)"
        aria-hidden="true"
      />
    </div>
    <div
      v-else-if="!objects.length"
      class="text-txt-4 flex h-7 items-center gap-1.5 pl-10 text-[10.5px]"
    >
      <span>{{
        error ? t('对象列表加载失败，请刷新重试') : t('暂无对象')
      }}</span>
    </div>

    <template
      v-for="object in visibleObjects"
      :key="databaseObjectKey(object)"
    >
      <AppButton
        variant="bare"
        :class="
          cn(
            'nav-item h-7 w-full gap-1.5 pl-10 text-xs',
            selectedKey === databaseObjectKey(object) && 'nav-item-active'
          )
        "
        role="treeitem"
        tabindex="-1"
        aria-level="3"
        :aria-selected="selectedKey === databaseObjectKey(object)"
        :aria-expanded="
          hasColumns()
            ? state.expandedObjects.has(databaseObjectKey(object))
            : undefined
        "
        :data-tree-key="databaseObjectKey(object)"
        :data-tree-label="object.name"
        :title="
          t('{value0}.{value1}{value2}（双击打开）', {
            value0: object.schema,
            value1: object.name,
            value2: object.identity ? `(${object.identity})` : '',
          })
        "
        @dblclick="emit('open', object)"
        @keydown="objectKeydown($event, object)"
        @contextmenu.prevent.stop="emit('context', $event, object)"
      >
        <AppIcon
          v-if="hasColumns()"
          @click="selectObject(object)"
          name="lucide:chevron-right"
          :size="11"
          :class="
            cn(
              'text-txt-4 motion-safe:transition-transform',
              state.expandedObjects.has(databaseObjectKey(object)) &&
                'rotate-90'
            )
          "
        />
        <span
          v-else
          aria-hidden="true"
          class="w-2.75 shrink-0"
        />
        <AppIcon
          :name="icon"
          :size="12"
          :class="iconClass"
        />
        <span class="min-w-0 flex-1 truncate text-left">{{ object.name }}</span>
        <span
          v-if="object.identity"
          class="text-txt-4 max-w-18 truncate font-mono text-[8.5px]"
          :title="object.identity"
        >
          {{ object.identity }}
        </span>
        <span
          v-else-if="object.rowEstimate !== null"
          class="text-txt-4 text-[9px]"
        >
          {{ object.rowEstimate.toLocaleString() }}
        </span>
      </AppButton>

      <DatabaseTreeCollapse
        v-if="hasColumns()"
        :open="state.expandedObjects.has(databaseObjectKey(object))"
      >
        <div
          v-if="inspectingKeys.has(databaseObjectKey(object))"
          class="text-txt-4 py-1 pl-15 text-[10.5px]"
        >
          {{ t('读取字段…') }}
        </div>
        <div
          v-for="column in columnsFor(object)"
          :key="`${databaseObjectKey(object)}:${column.name}`"
          class="text-txt-3 focus-visible:bg-hover flex h-6 items-center gap-1.5 pr-2 pl-15 text-[10.5px] outline-none"
          role="treeitem"
          tabindex="-1"
          aria-level="4"
          :data-tree-key="`${databaseObjectKey(object)}:${column.name}`"
          :data-tree-label="column.name"
          :title="`${column.dataType}${column.nullable ? ' · nullable' : ''}`"
        >
          <AppIcon
            name="lucide:columns-3"
            :size="10"
            class="text-txt-4 shrink-0"
          />
          <span class="min-w-0 flex-1 truncate">{{ column.name }}</span>
          <span class="text-txt-4 max-w-18 truncate font-mono text-[9.5px]">
            {{ column.dataType }}
          </span>
        </div>
      </DatabaseTreeCollapse>
    </template>
    <AppButton
      v-if="remaining > 0"
      ref="sentinel"
      variant="bare"
      class="nav-item text-txt-4 h-7 w-full pl-10 text-[10.5px]"
      @click="showMore"
    >
      {{ t('显示更多（还有 {count} 个）', { count: remaining }) }}
    </AppButton>
  </DatabaseTreeCollapse>
</template>
