<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { databaseObjectKey } from '@/composables/useDatabaseSession'
import type { DatabaseObject } from '@/types/database'
import DatabaseObjectContextMenu from './DatabaseObjectContextMenu.vue'

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
    aria-label="当前数据库的表"
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
      正在加载表列表…
    </div>
    <div
      v-else-if="error"
      role="alert"
      class="text-txt-3 flex flex-col items-center gap-3 p-8 text-xs"
    >
      <p>表列表加载失败，请重试</p>
      <AppButton
        size="sm"
        @click="emit('refresh')"
        >重新加载</AppButton
      >
    </div>
    <table
      v-else
      class="w-full table-fixed border-collapse text-left text-xs"
    >
      <colgroup>
        <col class="w-2/5" />
        <col />
      </colgroup>
      <thead class="bg-panel text-txt-3 sticky top-0 z-10">
        <tr>
          <th
            scope="col"
            class="border-line-soft border-r border-b px-3 py-2 font-medium"
          >
            表名
          </th>
          <th
            scope="col"
            class="border-line-soft border-b px-3 py-2 font-medium"
          >
            备注
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
              :title="`双击打开表 ${table.schema}.${table.name}，右键查看更多操作`"
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
            当前数据库暂无数据表
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
      @refresh="emit('refresh')"
    />
  </section>
</template>
