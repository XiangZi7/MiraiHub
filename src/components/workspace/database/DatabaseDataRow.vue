<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed } from 'vue'
import IconButton from '@/components/ui/IconButton.vue'
import { tagColorCss, tagLabel } from '@/composables/useDatabaseColumnTags'
import type {
  ColumnTagConfig,
  ColumnTagRule,
  ColumnTagStyle,
  DatabaseQueryColumn,
} from '@/types/database'
import { cn } from '@/utils/cn'
import DatabaseCellEditor from './DatabaseCellEditor.vue'
import DatabaseCellTag from './DatabaseCellTag.vue'

const { t } = useI18n()

/**
 * 数据表格的一行。拆成独立组件是为了把重绘控制在行内：
 * 编辑某个单元格、切换某行删除标记时，只有那一行会重新渲染。
 *
 * 单元格平时只渲染文本，点击后才换成输入框；长文本只渲染开头一段，
 * 几百行 × 十几列的 JSON / 日志不会把 DOM 撑得很重。
 */
const PREVIEW_LENGTH = 160

const props = defineProps<{
  row: ReadonlyArray<string | null>
  rowIndex: number
  /** 显示用的行号，已含分页偏移。 */
  number: number
  columns: ReadonlyArray<DatabaseQueryColumn>
  canInsert: boolean
  canEdit: boolean
  deleted: boolean
  /** 全表未提交的修改，key 为 `行:列`；这里只读取本行的键。 */
  edits: ReadonlyMap<string, string | null>
  editingColumn: number | null
  resized: boolean
  /** 标签规则；隐藏标签样式时为 null。 */
  tags: Readonly<Record<string, ColumnTagConfig>> | null
  tagLookups: ReadonlyMap<string, ReadonlyMap<string, ColumnTagRule>> | null
}>()

const emit = defineEmits<{
  edit: [columnIndex: number]
  commit: [columnIndex: number, value: string]
  cancel: []
  move: [columnIndex: number, delta: 1 | -1]
  toggleDelete: []
}>()

interface CellView {
  value: string | null
  text: string
  edited: boolean
  tag: { label: string; color: string; variant: ColumnTagStyle } | null
}

const editable = computed(() => props.canEdit && !props.deleted)

const cells = computed<CellView[]>(() =>
  props.columns.map((column, index) => {
    const key = `${props.rowIndex}:${index}`
    const edited = props.edits.has(key)
    const value = edited
      ? (props.edits.get(key) ?? null)
      : (props.row[index] ?? null)
    let tag: CellView['tag'] = null
    if (value !== null && props.tagLookups && props.tags) {
      const lookup = props.tagLookups.get(column.name)
      const rule = lookup?.get(value) ?? lookup?.get(value.trim())
      const config = rule ? props.tags[column.name] : undefined
      if (rule && config)
        tag = {
          label: tagLabel(rule),
          color: tagColorCss(rule.color),
          variant: config.style,
        }
    }
    return {
      value,
      edited,
      text:
        value === null
          ? ''
          : value.length > PREVIEW_LENGTH
            ? `${value.slice(0, PREVIEW_LENGTH)}…`
            : value,
      tag,
    }
  })
)
</script>

<template>
  <tr
    :class="
      cn(
        'text-txt-2 hover:bg-hover',
        deleted && 'bg-danger/7 line-through opacity-55'
      )
    "
  >
    <td
      class="border-line-soft text-txt-4 border-r border-b px-1.5 py-1 text-right"
    >
      {{ number }}
    </td>
    <td
      v-if="canInsert"
      class="border-line-soft border-r border-b p-0.5 text-center"
    >
      <IconButton
        v-if="canEdit"
        :icon="deleted ? 'lucide:undo-2' : 'lucide:trash-2'"
        :size="11"
        class="text-txt-4 hover:text-danger size-6"
        :title="deleted ? t('撤销删除') : t('标记删除')"
        @click="emit('toggleDelete')"
      />
    </td>
    <td
      v-for="(cell, columnIndex) in cells"
      :key="columnIndex"
      :class="
        cn(
          'border-line-soft relative overflow-hidden border-r border-b p-0 last:border-r-0',
          cell.edited && 'bg-violet/8'
        )
      "
    >
      <DatabaseCellEditor
        v-if="editingColumn === columnIndex"
        :value="cell.value"
        @commit="emit('commit', columnIndex, $event)"
        @cancel="emit('cancel')"
        @move="emit('move', columnIndex, $event)"
      />
      <component
        :is="editable ? 'button' : 'span'"
        v-else
        :type="editable ? 'button' : undefined"
        :class="
          cn(
            'flex h-7 w-full items-center px-2.5 text-left',
            editable && 'cursor-text',
            !resized && 'max-w-80 min-w-36'
          )
        "
        :title="cell.text"
        @click="editable && emit('edit', columnIndex)"
      >
        <DatabaseCellTag
          v-if="cell.tag"
          :label="cell.tag.label"
          :color="cell.tag.color"
          :variant="cell.tag.variant"
        />
        <span
          v-else-if="cell.value === null"
          class="text-txt-4 italic"
          >NULL</span
        >
        <span
          v-else
          class="truncate"
          >{{ cell.text }}</span
        >
      </component>
    </td>
  </tr>
</template>
