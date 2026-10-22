<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { reactive, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { databaseObjectKey } from '@/composables/useDatabaseSession'
import type {
  DatabaseColumn,
  DatabaseObject,
  DatabaseObjectKind,
} from '@/types/database'
import { cn } from '@/utils/cn'

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
}>()

const state = reactive({
  expanded: Boolean(props.defaultExpanded),
  expandedObjects: new Set<string>(),
})

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
    :aria-expanded="state.expanded"
    :aria-busy="loading"
    @click="state.expanded = !state.expanded"
    @contextmenu.prevent.stop="emit('categoryContext', $event, schema, kind)"
  >
    <AppIcon
      name="lucide:chevron-right"
      :size="12"
      :class="
        cn('text-txt-4 transition-transform', state.expanded && 'rotate-90')
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

  <template v-if="state.expanded">
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
      v-for="object in objects"
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
        :title="
          t('{value0}.{value1}{value2}（双击打开）', {
            value0: object.schema,
            value1: object.name,
            value2: object.identity ? `(${object.identity})` : '',
          })
        "
        @dblclick="emit('open', object)"
        @contextmenu.prevent.stop="emit('context', $event, object)"
      >
        <AppIcon
          v-if="hasColumns()"
          @click="selectObject(object)"
          name="lucide:chevron-right"
          :size="11"
          :class="
            cn(
              'text-txt-4 transition-transform',
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

      <template
        v-if="
          hasColumns() && state.expandedObjects.has(databaseObjectKey(object))
        "
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
          class="text-txt-3 flex h-6 items-center gap-1.5 pr-2 pl-15 text-[10.5px]"
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
      </template>
    </template>
  </template>
</template>
