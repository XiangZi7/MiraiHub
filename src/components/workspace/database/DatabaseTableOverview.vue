<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, toRefs, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppColumnResizeHandle from '@/components/ui/AppColumnResizeHandle.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useDatabaseColumnWidths } from '@/composables/useDatabaseColumnWidths'
import { databaseObjectKey } from '@/composables/useDatabaseSession'
import type { DatabaseObject } from '@/types/database'
import { cn } from '@/utils/cn'
import DatabaseObjectContextMenu from './DatabaseObjectContextMenu.vue'

const { t } = useI18n()

const props = defineProps<{
  objects: readonly DatabaseObject[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  open: [object: DatabaseObject, panel?: 'data' | 'columns']
  inspect: [object: DatabaseObject]
  query: [object: DatabaseObject]
  copy: [object: DatabaseObject]
  renameObject: [object: DatabaseObject]
  removeObject: [object: DatabaseObject]
  designObject: [object: DatabaseObject]
  truncateObject: [object: DatabaseObject]
  refresh: []
}>()

// 响应式状态
const state = reactive({
  // 单击或右键选中的表。
  selectedKey: '',
  // 右键菜单的位置及目标表。
  menu: { open: false, x: 0, y: 0, object: null as DatabaseObject | null },
})
const { selectedKey, menu } = toRefs(state)

const tables = computed(() =>
  props.objects.filter(object => object.kind === 'table')
)
// 表列表只有「表名 / 备注」两列，列宽按数据库记住，重开连接后仍在。
const columnScope = computed(() => {
  const schema = tables.value[0]?.schema
  return schema ? `overview:${schema}` : ''
})
const { resized, widthOf, beginResize, autoFit, keyboardResize } =
  useDatabaseColumnWidths(columnScope)
const columns = computed(() => [
  { name: 'name', label: t('表名') },
  { name: 'comment', label: t('备注') },
])
const showSchema = computed(
  () => new Set(tables.value.map(table => table.schema)).size > 1
)

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

watch([() => props.objects, () => props.loading], () => {
  state.menu.open = false
})
</script>

<template>
  <section
    class="scroll-thin min-h-0 min-w-0 flex-1 overflow-auto"
    :aria-label="t('当前数据库的表')"
    :aria-busy="loading"
  >
    <div
      v-if="loading"
      role="status"
      class="text-txt-3 flex items-center justify-center gap-2 p-8 text-xs"
    >
      <AppIcon
        name="lucide:loader-circle"
        :size="14"
        class="animate-spin"
      />
      {{ t('正在加载表列表…') }}
    </div>
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
    <table
      v-else
      :class="
        cn(
          'w-full border-collapse text-left text-xs',
          resized ? 'table-fixed' : 'table-auto'
        )
      "
    >
      <colgroup v-if="resized">
        <col
          v-for="column in columns"
          :key="column.name"
          :style="{ width: `${widthOf(column.name)}px` }"
        />
      </colgroup>
      <thead class="database-glass-header database-glass-header--sticky text-txt-3">
        <tr>
          <th
            v-for="(column, index) in columns"
            :key="column.name"
            :data-column="column.name"
            scope="col"
            :class="
              cn(
                'border-line-soft border-b px-3 py-2 font-medium',
                index === 0 && 'border-r',
                !resized && (index === 0 ? 'w-2/5' : '')
              )
            "
          >
            {{ column.label }}
            <AppColumnResizeHandle
              :label="t('调整“{value0}”列宽', { value0: column.label })"
              @pointerdown="beginResize(column.name, $event)"
              @dblclick="autoFit(column.name, $event)"
              @keydown="keyboardResize(column.name, $event)"
            />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="table in tables"
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
              <span class="truncate font-mono">{{
                showSchema ? `${table.schema}.${table.name}` : table.name
              }}</span>
            </button>
          </td>
          <td class="text-txt-3 px-3 py-2 wrap-anywhere whitespace-pre-wrap">
            {{ table.comment || '—' }}
          </td>
        </tr>
        <tr v-if="!tables.length">
          <td
            colspan="2"
            class="text-txt-4 p-8 text-center"
          >
            {{ t('当前数据库暂无数据表') }}
          </td>
        </tr>
      </tbody>
    </table>
    <DatabaseObjectContextMenu
      :open="menu.open"
      :x="menu.x"
      :y="menu.y"
      :object="menu.object"
      @close="menu.open = false"
      @open="(object, panel) => emit('open', object, panel)"
      @inspect="emit('inspect', $event)"
      @query="emit('query', $event)"
      @copy="emit('copy', $event)"
      @rename="emit('renameObject', $event)"
      @remove="emit('removeObject', $event)"
      @design="emit('designObject', $event)"
      @truncate="emit('truncateObject', $event)"
      @refresh="emit('refresh')"
    />
  </section>
</template>
