<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { reactive, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { SavedDatabaseQuery } from '@/types/database-query'
import { cn } from '@/utils/cn'
import DatabaseTreeCollapse from './DatabaseTreeCollapse.vue'

const { t } = useI18n()

const props = defineProps<{
  database: string
  queries: readonly SavedDatabaseQuery[]
  selectedId: string
  defaultExpanded?: boolean
}>()

const emit = defineEmits<{
  create: [database: string]
  open: [query: SavedDatabaseQuery]
  context: [event: MouseEvent, query: SavedDatabaseQuery]
  categoryContext: [event: MouseEvent, database: string]
  rename: [query: SavedDatabaseQuery]
  remove: [query: SavedDatabaseQuery]
}>()

const state = reactive({ expanded: Boolean(props.defaultExpanded) })

function categoryKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight' && !state.expanded) state.expanded = true
  else if (event.key === 'ArrowLeft' && state.expanded) state.expanded = false
  else return
  event.preventDefault()
}

/** Enter 走按钮原生 click 打开；F2 重命名、Del 删除。 */
function queryKeydown(event: KeyboardEvent, query: SavedDatabaseQuery): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'F2') emit('rename', query)
  else if (event.key === 'Delete') emit('remove', query)
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
    :data-tree-key="`queries:${database}`"
    data-tree-label="Queries"
    @click="state.expanded = !state.expanded"
    @keydown="categoryKeydown"
    @contextmenu.prevent.stop="emit('categoryContext', $event, database)"
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
      name="lucide:notebook-tabs"
      :size="13"
      class="text-cyan"
    />
    <span> {{ t('Queries') }} </span>
    <span class="text-txt-4 ml-auto text-[10px]">{{ queries.length }}</span>
  </AppButton>

  <DatabaseTreeCollapse :open="state.expanded">
    <AppButton
      v-if="!queries.length"
      variant="bare"
      class="nav-item text-txt-4 h-7 w-full gap-1.5 pl-10 text-[10.5px]"
      role="treeitem"
      tabindex="-1"
      aria-level="3"
      :data-tree-key="`queries:${database}:create`"
      :data-tree-label="t('新建已保存查询')"
      @click="emit('create', database)"
    >
      <span
        aria-hidden="true"
        class="w-[11px] shrink-0"
      />
      <AppIcon
        name="lucide:plus"
        :size="12"
      /><span> {{ t('新建已保存查询') }} </span>
    </AppButton>
    <AppButton
      v-for="query in queries"
      :key="query.id"
      variant="bare"
      :class="
        cn(
          'nav-item h-7 w-full gap-1.5 pl-10 text-xs',
          selectedId === query.id && 'nav-item-active'
        )
      "
      role="treeitem"
      tabindex="-1"
      aria-level="3"
      :aria-selected="selectedId === query.id"
      :data-tree-key="`query:${query.id}`"
      :data-tree-label="query.name"
      :title="
        t('database.queryTooltip', {
          name: query.name,
          database: query.database,
        })
      "
      @click="emit('open', query)"
      @keydown="queryKeydown($event, query)"
      @contextmenu.prevent.stop="emit('context', $event, query)"
    >
      <span
        aria-hidden="true"
        class="w-[11px] shrink-0"
      />
      <AppIcon
        name="lucide:file-code-2"
        :size="12"
        class="text-cyan shrink-0"
      />
      <span class="min-w-0 flex-1 truncate text-left">{{ query.name }}</span>
      <span
        class="bg-cyan size-1.25 flex-none rounded-full opacity-70 shadow-[0_0_6px_color-mix(in_oklch,var(--color-cyan)_48%,transparent)]"
        :title="t('已保存')"
      />
    </AppButton>
  </DatabaseTreeCollapse>
</template>
