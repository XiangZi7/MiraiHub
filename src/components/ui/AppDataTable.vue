<script setup lang="ts" generic="Column extends string">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppColumnResizeHandle from '@/components/ui/AppColumnResizeHandle.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useDatabaseColumnWidths } from '@/composables/useDatabaseColumnWidths'

const props = defineProps<{
  columns: readonly {
    name: Column
    label: string
    width: string
    sortable?: boolean
  }[]
  widthScope: string
  sortBy?: Column
  descending?: boolean
}>()
const emit = defineEmits<{ sort: [column: Column] }>()
const { t } = useI18n()
const { widths, beginResize, autoFit, keyboardResize } =
  useDatabaseColumnWidths(computed(() => props.widthScope))
const sizedColumns = computed(() =>
  props.columns.map(column => ({
    ...column,
    width: widths.value[column.name]
      ? `${widths.value[column.name]}px`
      : column.width,
  }))
)
const minWidth = computed(
  () => `calc(${sizedColumns.value.map(column => column.width).join(' + ')})`
)
</script>

<template>
  <!-- 表清单共享固定表头、排序按钮和可持久化的列宽；业务行通过插槽提供。 -->
  <table
    class="w-full table-fixed border-collapse text-left text-xs"
    :style="{ minWidth }"
  >
    <colgroup>
      <col
        v-for="(column, index) in sizedColumns"
        :key="column.name"
        :style="{
          width:
            index < sizedColumns.length - 1 || widths[column.name]
              ? column.width
              : undefined,
        }"
      />
    </colgroup>
    <thead
      class="database-glass-header database-glass-header--sticky text-txt-3"
    >
      <tr>
        <th
          v-for="column in sizedColumns"
          :key="column.name"
          :data-column="column.name"
          scope="col"
          :aria-sort="
            sortBy === column.name
              ? descending
                ? 'descending'
                : 'ascending'
              : undefined
          "
          class="border-line-soft relative border-r border-b px-3 py-2 font-medium"
        >
          <button
            v-if="column.sortable !== false"
            type="button"
            class="hover:text-txt focus-visible:outline-accent flex w-full items-center justify-between gap-1 text-left"
            @click="emit('sort', column.name)"
          >
            <span class="truncate">{{ column.label }}</span>
            <AppIcon
              v-if="sortBy === column.name"
              :name="descending ? 'lucide:chevron-down' : 'lucide:chevron-up'"
              :size="12"
            />
          </button>
          <span
            v-else
            class="block truncate"
            >{{ column.label }}</span
          >
          <AppColumnResizeHandle
            :label="t('调整“{value0}”列宽', { value0: column.label })"
            @pointerdown="beginResize(column.name, $event)"
            @dblclick="autoFit(column.name, $event)"
            @keydown="keyboardResize(column.name, $event)"
          />
        </th>
      </tr>
    </thead>
    <!-- 分组列表可提供多个语义化行组，普通列表继续使用默认表体。 -->
    <slot name="body">
      <tbody>
        <slot />
      </tbody>
    </slot>
  </table>
</template>
