<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
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

/**
 * 数据表格的一行。拆成独立组件是为了把重绘控制在行内：
 * 编辑某个单元格、切换某行删除标记时，只有那一行会重新渲染。
 *
 * 单元格平时只渲染文本，点击后才换成输入框；长文本只渲染开头一段，
 * 几百行 × 十几列的 JSON / 日志不会把 DOM 撑得很重。
 */
const PREVIEW_LENGTH = 160

const { t } = useI18n()

const props = defineProps<{
  row: ReadonlyArray<string | null>
  rowIndex: number
  /** 显示用的行号，已含分页偏移。 */
  number: number
  columns: ReadonlyArray<DatabaseQueryColumn>
  canEdit: boolean
  deleted: boolean
  /** 本行是刚提交成功的改动/新增行，播放一次提交高亮。 */
  flash?: boolean
  /** 全表未提交的修改，key 为 `行:列`；这里只读取本行的键。 */
  edits: ReadonlyMap<string, string | null>
  editingColumn: number | null
  resized: boolean
  /** 标签规则；隐藏标签样式时为 null。 */
  tags: Readonly<Record<string, ColumnTagConfig>> | null
  tagLookups: ReadonlyMap<string, ReadonlyMap<string, ColumnTagRule>> | null
  /** 本行落在选区内时的列范围；不在选区内为 null，选区变化时其他行不重绘。 */
  selectionLeft?: number | null
  selectionRight?: number | null
  /** 活动单元格在本行时的列号。 */
  activeColumn?: number | null
  /** 每列是否数值列，数值右对齐。 */
  numeric: ReadonlyArray<boolean>
  /** 每列是否属于外键，非空值显示跳转图标。 */
  foreignKeys?: ReadonlyArray<boolean>
  /** 单元格高度类，随网格密度变化。 */
  heightClass: string
}>()

const emit = defineEmits<{
  edit: [columnIndex: number]
  commit: [columnIndex: number, value: string]
  cancel: []
  move: [columnIndex: number, delta: 1 | -1]
  context: [event: MouseEvent]
  /** 双击单元格；可编辑时进入编辑，否则由父组件打开值查看器。 */
  open: [columnIndex: number]
  /** 点击外键单元格的跳转图标。 */
  follow: [columnIndex: number]
}>()

function selected(columnIndex: number): boolean {
  return (
    props.selectionLeft != null &&
    props.selectionRight != null &&
    columnIndex >= props.selectionLeft &&
    columnIndex <= props.selectionRight
  )
}

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
        'hover:bg-hover',
        deleted
          ? 'bg-danger/10 text-danger decoration-danger motion-safe:grid-row-removed line-through opacity-70'
          : 'text-txt-2',
        flash && 'motion-safe:grid-commit-flash'
      )
    "
    :data-row-index="rowIndex"
    @contextmenu.prevent.stop="emit('context', $event)"
  >
    <td
      data-row-header
      :class="
        cn(
          'border-line-soft text-txt-4 cursor-default border-r border-b px-1.5 py-1 text-right select-none',
          selectionLeft != null && 'bg-violet/10 text-txt-2'
        )
      "
    >
      {{ number }}
    </td>
    <td
      v-for="(cell, columnIndex) in cells"
      :key="columnIndex"
      :data-col="columnIndex"
      :aria-selected="selected(columnIndex)"
      :class="
        cn(
          'border-line-soft relative scroll-mt-8 scroll-ml-12 overflow-hidden border-r border-b p-0 last:border-r-0',
          cell.edited && 'bg-amber/12 motion-safe:grid-cell-edited',
          selected(columnIndex) && 'bg-violet/15',
          activeColumn === columnIndex &&
            editingColumn !== columnIndex &&
            'ring-violet ring-1 ring-inset'
        )
      "
      @dblclick="emit('open', columnIndex)"
    >
      <DatabaseCellEditor
        v-if="editingColumn === columnIndex"
        :value="cell.value"
        :data-type="columns[columnIndex]?.dataType"
        :height-class="heightClass"
        @commit="emit('commit', columnIndex, $event)"
        @cancel="emit('cancel')"
        @move="emit('move', columnIndex, $event)"
      />
      <div
        v-else
        :class="
          cn(
            'flex w-full items-center px-2.5 text-left select-none',
            heightClass,
            numeric[columnIndex] && 'justify-end text-right tabular-nums',
            editable && 'cursor-cell',
            !resized && 'max-w-80 min-w-36'
          )
        "
        :title="cell.text"
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
        <button
          v-if="foreignKeys?.[columnIndex] && cell.value !== null"
          type="button"
          tabindex="-1"
          class="text-txt-4 hover:text-violet ml-1 shrink-0 cursor-pointer"
          :title="t('打开被引用的记录')"
          :aria-label="t('打开被引用的记录')"
          @pointerdown.stop
          @dblclick.stop
          @click.stop="emit('follow', columnIndex)"
        >
          <AppIcon
            name="lucide:link"
            :size="10"
          />
        </button>
      </div>
    </td>
  </tr>
</template>
