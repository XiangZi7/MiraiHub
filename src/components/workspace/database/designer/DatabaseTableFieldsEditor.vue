<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import * as database from '@/api/database'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useTabReorder } from '@/composables/useTabReorder'
import { cn } from '@/utils/cn'
import type { DatabaseKind } from '@/types/database'
import type { TableDesignerColumn } from '@/types/database-designer'
import {
  columnTypeGroups,
  columnTypeTraits,
  defaultColumnLength,
  primaryKeyColumns,
  quoteDefaultText,
  unquoteDefaultText,
} from '@/utils/database-ddl'

const { t } = useI18n()

const props = defineProps<{
  modelValue: TableDesignerColumn[]
  databaseKind: DatabaseKind
  /** 编辑模式下当前表已有的非标准类型（如 ENUM），合并进类型下拉框。 */
  extraTypes?: readonly string[]
  editing?: boolean
  sessionId?: string
  /** 表的默认排序规则，用来提示字段“跟随表默认”时实际是什么。 */
  tableCollation?: string
  /** 按字段 ID 归类的校验错误。 */
  errors?: Record<string, string[]>
  /** 上次读取 / 保存时的字段，传入后标出改过的单元格（只在编辑现有表时传）。 */
  baseline?: readonly TableDesignerColumn[]
}>()

const emit = defineEmits<{
  'update:modelValue': [columns: TableDesignerColumn[]]
}>()

const mysql = computed(() => props.databaseKind === 'mysql')
const tableWrap = useTemplateRef<HTMLElement>('tableWrap')
const reorder = useTabReorder({
  tabs: () => props.modelValue,
  container: () => tableWrap.value,
  onReorder: moveColumnFromIndex,
})
const draggedColumn = computed(() =>
  props.modelValue.find(column => column.id === reorder.draggedId.value)
)

const selected = ref(new Set<string>())
const activeId = shallowRef('')
const activeColumn = computed(() =>
  props.modelValue.find(column => column.id === activeId.value)
)
const allSelected = computed(
  () =>
    props.modelValue.length > 0 &&
    props.modelValue.every(column => selected.value.has(column.id))
)
// 列表变化后清掉已不存在的选择，避免批量操作命中幽灵行。
watch(
  () => props.modelValue.map(column => column.id),
  ids => {
    const alive = new Set(ids)
    if ([...selected.value].some(id => !alive.has(id)))
      selected.value = new Set([...selected.value].filter(id => alive.has(id)))
    if (activeId.value && !alive.has(activeId.value)) activeId.value = ''
  }
)

const typeOptions = computed(() => {
  const base = columnTypeGroups(props.databaseKind).flatMap(group =>
    group.types.map(value => ({ value, label: value, group: t(group.label) }))
  )
  const known = new Set(base.map(option => option.value))
  const extra = (props.extraTypes ?? [])
    .filter(value => !known.has(value))
    .map(value => ({ value, label: value, group: t('当前表') }))
  return [...base, ...extra]
})

const primaryOrder = computed(() => {
  const columns = primaryKeyColumns(props.modelValue)
  return columns.length > 1
    ? new Map(columns.map((column, index) => [column.id, index + 1]))
    : new Map<string, number>()
})

const collations = shallowRef<{ name: string; charset: string }[]>([])
watch(
  () => [props.sessionId, props.databaseKind] as const,
  async ([sessionId, kind]) => {
    collations.value = []
    if (kind !== 'mysql' || !sessionId) return
    try {
      const result = await database.tableOptionChoices(sessionId)
      collations.value = result.collations.map(([name, charset]) => ({
        name,
        charset,
      }))
    } catch {
      // 读不到目录时字符集/排序规则退回手动输入。
    }
  },
  { immediate: true }
)
const inherit = computed(() =>
  props.tableCollation
    ? t('跟随表默认（{value0}）', { value0: props.tableCollation })
    : t('跟随表默认')
)
const charsetOptions = computed(() => [
  { value: '', label: inherit.value },
  ...[...new Set(collations.value.map(item => item.charset))].map(value => ({
    value,
    label: value,
  })),
])
function collationOptions(column: TableDesignerColumn) {
  const charset = column.charset || props.tableCollation?.split('_')[0] || ''
  return [
    { value: '', label: inherit.value },
    ...collations.value
      .filter(item => !charset || item.charset === charset)
      .map(item => ({ value: item.name, label: item.name })),
  ]
}

type DefaultMode = 'none' | 'null' | 'text' | 'current' | 'expression'
// 表达式模式下值可能暂时是空串，靠这个记住用户选过表达式。
const expressionModes = ref(new Set<string>())
function defaultMode(column: TableDesignerColumn): DefaultMode {
  const value = column.defaultValue.trim()
  if (!value) return expressionModes.value.has(column.id) ? 'expression' : 'none'
  if (/^null$/iu.test(value)) return 'null'
  if (unquoteDefaultText(value, props.databaseKind) !== null) return 'text'
  if (/^current_timestamp(?:\(\d*\))?$/iu.test(value)) return 'current'
  return 'expression'
}
const defaultModeOptions = computed(() => [
  { value: 'none', label: t('无默认值') },
  { value: 'null', label: 'NULL' },
  { value: 'text', label: t('文本') },
  { value: 'current', label: 'CURRENT_TIMESTAMP' },
  { value: 'expression', label: t('表达式') },
])
function setDefaultMode(column: TableDesignerColumn, mode: string): void {
  const next = new Set(expressionModes.value)
  if (mode === 'expression') next.add(column.id)
  else next.delete(column.id)
  expressionModes.value = next
  const values: Record<string, string> = {
    none: '',
    null: 'NULL',
    text: quoteDefaultText('', props.databaseKind),
    current: 'CURRENT_TIMESTAMP',
    expression:
      defaultMode(column) === 'text' || defaultMode(column) === 'null'
        ? ''
        : column.defaultValue,
  }
  updateColumn(column.id, { defaultValue: values[mode] ?? '' })
}
function defaultInput(column: TableDesignerColumn): string {
  return defaultMode(column) === 'text'
    ? (unquoteDefaultText(column.defaultValue, props.databaseKind) ?? '')
    : column.defaultValue
}
function setDefaultInput(column: TableDesignerColumn, value: string): void {
  updateColumn(column.id, {
    defaultValue:
      defaultMode(column) === 'text'
        ? quoteDefaultText(value, props.databaseKind)
        : value,
  })
}

function lengthPart(column: TableDesignerColumn, part: 0 | 1): string {
  return column.length.split(',')[part]?.trim() ?? ''
}
function setLengthPart(
  column: TableDesignerColumn,
  part: 0 | 1,
  value: string
): void {
  const parts = [lengthPart(column, 0), lengthPart(column, 1)]
  parts[part] = value.trim()
  updateColumn(column.id, {
    length: parts[1] ? `${parts[0]},${parts[1]}` : parts[0],
  })
}

function changeType(column: TableDesignerColumn, dataType: string): void {
  const before = columnTypeTraits(column.dataType, props.databaseKind)
  const traits = columnTypeTraits(dataType, props.databaseKind)
  const keepLength =
    traits.length &&
    before.length &&
    before.scale === traits.scale &&
    !before.enumerated
  updateColumn(column.id, {
    dataType,
    length: keepLength
      ? column.length
      : traits.enumerated
        ? ''
        : defaultColumnLength(dataType),
    unsigned: traits.unsigned && column.unsigned,
    zerofill: traits.zerofill && Boolean(column.zerofill),
    autoIncrement: traits.integer && column.autoIncrement,
    charset: traits.charset ? column.charset : '',
    collation: traits.collation ? column.collation : '',
    onUpdateCurrentTimestamp:
      traits.onUpdate && Boolean(column.onUpdateCurrentTimestamp),
  })
}

function newId(): string {
  return `column-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function blankColumn(first: boolean, number: number): TableDesignerColumn {
  return {
    id: newId(),
    name: first ? 'id' : `column_${number}`,
    dataType: first ? 'BIGINT' : 'VARCHAR',
    length: first ? '' : '255',
    nullable: !first,
    primaryKey: first,
    unique: false,
    unsigned: false,
    autoIncrement: first,
    defaultValue: '',
    comment: '',
  }
}

function uniqueName(base: string): string {
  const names = new Set(props.modelValue.map(column => column.name))
  let name = base
  for (let index = 2; names.has(name); index += 1) name = `${base}_${index}`
  return name
}

/** 在指定位置之后插入新字段，默认追加到末尾。 */
function addColumn(after = props.modelValue.length - 1): string {
  const column = blankColumn(
    props.modelValue.length === 0,
    props.modelValue.length + 1
  )
  column.name = uniqueName(column.name)
  const columns = [...props.modelValue]
  columns.splice(after + 1, 0, column)
  emit('update:modelValue', columns)
  activeId.value = column.id
  void focusCell(column.id, 'name')
  return column.id
}

function updateColumn(id: string, patch: Partial<TableDesignerColumn>): void {
  emit(
    'update:modelValue',
    props.modelValue.map(column =>
      column.id === id ? { ...column, ...patch } : column
    )
  )
}

function togglePrimaryKey(column: TableDesignerColumn, value: boolean): void {
  const orders = props.modelValue
    .map(item => item.primaryKeyOrder)
    .filter((order): order is number => order != null)
  updateColumn(column.id, {
    primaryKey: value,
    nullable: value ? false : column.nullable,
    // 已有显式主键顺序时，新加入的字段排到最后。
    primaryKeyOrder:
      value && orders.length ? Math.max(...orders) + 1 : undefined,
  })
}

function removeColumns(ids: ReadonlySet<string>): void {
  if (!ids.size) return
  const firstIndex = props.modelValue.findIndex(column => ids.has(column.id))
  const columns = props.modelValue.filter(column => !ids.has(column.id))
  emit('update:modelValue', columns)
  selected.value = new Set()
  const next = columns[Math.min(firstIndex, columns.length - 1)]
  activeId.value = next?.id ?? ''
  if (next) void focusRow(next.id)
}

function targetIds(): Set<string> {
  if (selected.value.size) return new Set(selected.value)
  return activeId.value ? new Set([activeId.value]) : new Set()
}

function duplicateColumns(): void {
  const ids = targetIds()
  if (!ids.size) return
  const columns: TableDesignerColumn[] = []
  let lastCopy = ''
  for (const column of props.modelValue) {
    columns.push(column)
    if (!ids.has(column.id)) continue
    const { originalName: _original, primaryKeyOrder: _order, ...rest } =
      column
    const copy: TableDesignerColumn = {
      ...rest,
      id: newId(),
      name: uniqueName(`${column.name}_copy`),
      // 复制出的字段不能再当主键或自增，否则一保存就冲突。
      primaryKey: false,
      autoIncrement: false,
    }
    columns.push(copy)
    lastCopy = copy.id
  }
  emit('update:modelValue', columns)
  activeId.value = lastCopy
}

/** 把选中的字段整体上移或下移一格。 */
function shiftColumns(offset: -1 | 1): void {
  const ids = targetIds()
  if (!ids.size) return
  const columns = [...props.modelValue]
  const order = offset < 0 ? columns.keys() : [...columns.keys()].reverse()
  for (const index of order) {
    const target = index + offset
    if (
      !ids.has(columns[index].id) ||
      target < 0 ||
      target >= columns.length ||
      ids.has(columns[target].id)
    )
      continue
    ;[columns[index], columns[target]] = [columns[target], columns[index]]
  }
  emit('update:modelValue', columns)
}

/** 把某列从一个索引移动到另一个索引（拖拽回传）。 */
function moveColumnFromIndex(fromIndex: number, toIndex: number): void {
  const target = Math.max(0, Math.min(toIndex, props.modelValue.length - 1))
  if (fromIndex < 0 || fromIndex === target) return
  const columns = [...props.modelValue]
  const [column] = columns.splice(fromIndex, 1)
  if (!column) return
  columns.splice(target, 0, column)
  emit('update:modelValue', columns)
}

function toggleSelected(id: string, value: boolean): void {
  const next = new Set(selected.value)
  if (value) next.add(id)
  else next.delete(id)
  selected.value = next
}

function toggleAll(value: boolean): void {
  selected.value = value
    ? new Set(props.modelValue.map(column => column.id))
    : new Set()
}

function rowElement(id: string): HTMLElement | null {
  return (
    tableWrap.value?.querySelector<HTMLElement>(
      `tr[data-reorderable-tab-id="${CSS.escape(id)}"]`
    ) ?? null
  )
}

async function focusRow(id: string): Promise<void> {
  await nextTick()
  rowElement(id)?.focus()
}

async function focusCell(id: string, cell: string): Promise<void> {
  await nextTick()
  const input = rowElement(id)?.querySelector<HTMLInputElement>(
    `[data-cell="${cell}"] input`
  )
  input?.focus()
  input?.select()
}

function onRowKeydown(event: KeyboardEvent, column: TableDesignerColumn): void {
  const target = event.target as HTMLElement
  const inInput = target instanceof HTMLInputElement
  const index = props.modelValue.findIndex(item => item.id === column.id)
  const modifier = event.ctrlKey || event.metaKey
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    activeId.value = column.id
    shiftColumns(event.key === 'ArrowUp' ? -1 : 1)
    return
  }
  if (modifier && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    activeId.value = column.id
    duplicateColumns()
    return
  }
  if (event.key === 'Delete' && (!inInput || modifier)) {
    event.preventDefault()
    activeId.value = column.id
    removeColumns(targetIds())
    return
  }
  if (event.key === 'Enter' && inInput && !event.isComposing) {
    event.preventDefault()
    const cell =
      target.closest<HTMLElement>('[data-cell]')?.dataset.cell ?? 'name'
    const next = props.modelValue[index + 1]
    if (next) {
      activeId.value = next.id
      void focusCell(next.id, cell)
    } else addColumn(index)
  }
}

const baselineById = computed(
  () => new Map((props.baseline ?? []).map(column => [column.id, column]))
)

/** 判断字段的指定属性是否与基线不同；新增的字段整行都算改过。 */
function changed(
  column: TableDesignerColumn,
  ...keys: (keyof TableDesignerColumn)[]
): boolean {
  if (!props.baseline) return false
  const original = baselineById.value.get(column.id)
  if (!original) return true
  return keys.some(key => (original[key] ?? '') !== (column[key] ?? ''))
}

/** 改过的单元格样式：淡琥珀底色 + 左上角小三角，不只依赖颜色区分。 */
function changedCell(
  column: TableDesignerColumn,
  ...keys: (keyof TableDesignerColumn)[]
): string | undefined {
  return changed(column, ...keys) ? 'designer-cell-changed' : undefined
}

/** 字段的校验错误列表，用于行内提示。 */
function rowErrors(column: TableDesignerColumn): string[] {
  return props.errors?.[column.id] ?? []
}

const columnCount = computed(() => (mysql.value ? 15 : 14))

// 「添加字段」按钮住在设计器工具条上，不在本面板里。
defineExpose({ add: () => void addColumn() })
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div
      class="border-line-soft text-txt-3 flex h-9 shrink-0 items-center gap-1 border-b px-2 text-[10.5px]"
    >
      <span class="text-txt-4 min-w-16 px-1 tabular-nums">
        {{
          selected.size
            ? t('已选 {value0} 个', { value0: selected.size })
            : t('{value0} 个字段', { value0: modelValue.length })
        }}
      </span>
      <IconButton
        icon="lucide:list-plus"
        :size="12"
        class="size-7"
        :title="t('在当前字段后插入')"
        @click="
          addColumn(
            activeColumn
              ? modelValue.indexOf(activeColumn)
              : modelValue.length - 1
          )
        "
      />
      <IconButton
        icon="lucide:arrow-up"
        :size="12"
        class="size-7"
        :title="t('上移 (Alt+↑)')"
        :disabled="!selected.size && !activeId"
        @click="shiftColumns(-1)"
      />
      <IconButton
        icon="lucide:arrow-down"
        :size="12"
        class="size-7"
        :title="t('下移 (Alt+↓)')"
        :disabled="!selected.size && !activeId"
        @click="shiftColumns(1)"
      />
      <IconButton
        icon="lucide:copy"
        :size="12"
        class="size-7"
        :title="t('复制字段 (Ctrl+D)')"
        :disabled="!selected.size && !activeId"
        @click="duplicateColumns"
      />
      <IconButton
        icon="lucide:trash-2"
        :size="12"
        class="text-danger hover:text-danger size-7"
        :title="t('删除字段 (Delete)')"
        :disabled="!selected.size && !activeId"
        @click="removeColumns(targetIds())"
      />
      <span
        v-if="editing && !mysql"
        class="text-txt-4 ml-2 truncate"
      >
        {{ t('PostgreSQL 不支持调整已有字段的位置，排序只对新建表生效') }}
      </span>
      <span class="text-txt-4 ml-auto hidden truncate xl:inline">
        {{ t('Enter 下一行 · Alt+↑↓ 移动 · Ctrl+D 复制 · Delete 删除') }}
      </span>
    </div>
    <div
      ref="tableWrap"
      class="scroll-thin min-h-0 flex-1 overflow-auto p-2"
    >
      <table class="designer-table min-w-295">
        <thead class="database-glass-header database-glass-header--sticky">
          <tr>
            <th class="w-8">
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="allSelected"
                  :label="t('全选')"
                  hide-label
                  :disabled="!modelValue.length"
                  @update:model-value="toggleAll"
                />
              </div>
            </th>
            <th
              class="w-6"
              :aria-label="t('排序')"
            />
            <th class="min-w-36">{{ t('字段名') }}</th>
            <th class="min-w-36">{{ t('类型') }}</th>
            <th class="w-24">{{ t('长度') }}</th>
            <th class="w-16">{{ t('小数位') }}</th>
            <th class="w-12">{{ t('可空') }}</th>
            <th class="w-12">{{ t('主键') }}</th>
            <th class="w-12">{{ t('唯一') }}</th>
            <th
              v-if="mysql"
              class="w-14"
            >
              {{ t('无符号') }}
            </th>
            <th class="w-12">{{ t('自增') }}</th>
            <th class="min-w-36">{{ t('默认值') }}</th>
            <th class="min-w-40">{{ t('备注') }}</th>
            <th class="w-8" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="column in modelValue"
            :key="column.id"
            :aria-invalid="rowErrors(column).length > 0 || undefined"
            :data-reorderable-tab-id="column.id"
            tabindex="0"
            :title="rowErrors(column).join('\n') || undefined"
            :class="
              cn(
                'outline-none',
                'hover:[&>td]:bg-violet/3 motion-safe:[&>td]:transition-colors',
                activeId === column.id &&
                  '[&>td]:bg-violet/6 [&>td:first-child]:shadow-[inset_2px_0_var(--color-violet)]',
                rowErrors(column).length &&
                  '[&>td:first-child]:shadow-[inset_2px_0_var(--color-danger)]'
              )
            "
            :data-dragging="reorder.draggedId.value === column.id || undefined"
            :data-drop="
              reorder.targetId.value === column.id
                ? reorder.targetPosition.value || undefined
                : undefined
            "
            @pointerdown="reorder.start($event, column.id)"
            @focusin="activeId = column.id"
            @keydown="onRowKeydown($event, column)"
          >
            <td>
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="selected.has(column.id)"
                  :label="t('选择字段')"
                  hide-label
                  @update:model-value="toggleSelected(column.id, $event)"
                />
              </div>
            </td>
            <td>
              <div class="flex items-center justify-center">
                <span
                  class="text-txt-4 hover:text-txt-2 grid h-6 w-4 cursor-grab touch-none place-items-center"
                  data-grip
                  :title="t('拖动排序')"
                >
                  <AppIcon
                    name="lucide:grip-vertical"
                    :size="12"
                  />
                </span>
              </div>
            </td>
            <td
              data-cell="name"
              :class="changedCell(column, 'name')"
            >
              <div class="flex items-center">
                <AppInput
                  :model-value="column.name"
                  variant="cell"
                  monospace
                  :aria-label="t('字段名')"
                  :aria-invalid="rowErrors(column).length > 0"
                  @update:model-value="
                    updateColumn(column.id, { name: $event })
                  "
                />
                <AppIcon
                  v-if="column.generatedExpression"
                  name="lucide:sigma"
                  :size="11"
                  class="text-violet mr-1 shrink-0"
                  :title="t('生成列')"
                />
                <AppIcon
                  v-if="rowErrors(column).length"
                  name="lucide:circle-alert"
                  :size="11"
                  class="text-danger mr-1 shrink-0"
                  role="img"
                  :aria-label="rowErrors(column).join('; ')"
                  :title="rowErrors(column).join('; ')"
                />
              </div>
            </td>
            <td :class="changedCell(column, 'dataType')">
              <AppSelect
                :model-value="column.dataType"
                :label="t('字段类型')"
                :options="typeOptions"
                hide-label
                compact
                searchable
                @update:model-value="changeType(column, $event)"
              />
            </td>
            <template
              v-if="columnTypeTraits(column.dataType, databaseKind).enumerated"
            >
              <td
                colspan="2"
                data-cell="length"
                :class="changedCell(column, 'length')"
              >
                <AppInput
                  :model-value="column.length"
                  variant="cell"
                  monospace
                  placeholder="'a','b'"
                  :aria-label="t('枚举值')"
                  @update:model-value="
                    updateColumn(column.id, { length: $event })
                  "
                />
              </td>
            </template>
            <template v-else>
              <td
                data-cell="length"
                :class="changedCell(column, 'length')"
              >
                <AppInput
                  :model-value="lengthPart(column, 0)"
                  variant="cell"
                  monospace
                  :disabled="
                    !columnTypeTraits(column.dataType, databaseKind).length
                  "
                  :aria-label="t('长度或精度')"
                  @update:model-value="setLengthPart(column, 0, $event)"
                />
              </td>
              <td data-cell="scale">
                <AppInput
                  :model-value="lengthPart(column, 1)"
                  variant="cell"
                  monospace
                  :disabled="
                    !columnTypeTraits(column.dataType, databaseKind).scale
                  "
                  :aria-label="t('小数位')"
                  @update:model-value="setLengthPart(column, 1, $event)"
                />
              </td>
            </template>
            <td :class="changedCell(column, 'nullable')">
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="column.nullable"
                  :label="t('允许为空')"
                  hide-label
                  :disabled="column.primaryKey"
                  @update:model-value="
                    updateColumn(column.id, { nullable: $event })
                  "
                />
              </div>
            </td>
            <td :class="changedCell(column, 'primaryKey')">
              <div class="flex items-center justify-center gap-0.5">
                <AppCheckbox
                  :model-value="column.primaryKey"
                  :label="t('主键')"
                  hide-label
                  @update:model-value="togglePrimaryKey(column, $event)"
                />
                <span
                  v-if="primaryOrder.get(column.id)"
                  class="text-accent font-mono text-[9px] tabular-nums"
                  :title="t('复合主键中的顺序')"
                  >{{ primaryOrder.get(column.id) }}</span
                >
              </div>
            </td>
            <td :class="changedCell(column, 'unique')">
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="column.unique"
                  :label="t('唯一')"
                  hide-label
                  @update:model-value="
                    updateColumn(column.id, { unique: $event })
                  "
                />
              </div>
            </td>
            <td v-if="mysql">
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="column.unsigned"
                  :label="t('无符号')"
                  hide-label
                  :disabled="
                    !columnTypeTraits(column.dataType, databaseKind).unsigned
                  "
                  @update:model-value="
                    updateColumn(column.id, { unsigned: $event })
                  "
                />
              </div>
            </td>
            <td :class="changedCell(column, 'autoIncrement')">
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="column.autoIncrement"
                  :label="t('自动递增')"
                  hide-label
                  :disabled="
                    !columnTypeTraits(column.dataType, databaseKind).integer ||
                    Boolean(column.generatedExpression)
                  "
                  @update:model-value="
                    updateColumn(column.id, { autoIncrement: $event })
                  "
                />
              </div>
            </td>
            <td
              data-cell="default"
              :class="changedCell(column, 'defaultValue')"
            >
              <AppInput
                :model-value="defaultInput(column)"
                variant="cell"
                :monospace="defaultMode(column) !== 'text'"
                :placeholder="
                  defaultMode(column) === 'text' ? t('空字符串') : 'NULL'
                "
                :aria-label="t('默认值表达式')"
                :disabled="
                  column.autoIncrement ||
                  Boolean(column.generatedExpression) ||
                  defaultMode(column) === 'null' ||
                  defaultMode(column) === 'current'
                "
                @update:model-value="setDefaultInput(column, $event)"
              />
            </td>
            <td
              data-cell="comment"
              :class="changedCell(column, 'comment')"
            >
              <AppInput
                :model-value="column.comment"
                variant="cell"
                :aria-label="t('字段备注')"
                @update:model-value="
                  updateColumn(column.id, { comment: $event })
                "
              />
            </td>
            <td>
              <IconButton
                icon="lucide:trash-2"
                :size="11"
                class="text-danger hover:text-danger size-6"
                :title="t('删除字段')"
                @click="removeColumns(new Set([column.id]))"
              />
            </td>
          </tr>
          <tr v-if="!modelValue.length">
            <td
              :colspan="columnCount"
              class="text-txt-4 h-28 text-center"
            >
              <AppIcon
                name="lucide:columns-3"
                :size="18"
                class="text-txt-4/70 mx-auto mb-1.5"
              />
              {{ t('尚未添加字段') }}
              <p class="mt-1 text-[10px]">
                {{ t('点击工具栏「添加字段」，或使用 AI 生成表结构') }}
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="activeColumn"
      class="border-line-soft bg-card/60 grid shrink-0 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-3 gap-y-2 border-t px-3 py-2.5 text-[10px]"
    >
      <p
        class="text-txt-2 col-span-full flex items-center gap-1.5 font-mono text-[10.5px]"
      >
        <AppIcon
          name="lucide:settings-2"
          :size="11"
          class="text-violet"
        />{{ activeColumn.name || t('未命名字段') }}
        <span class="text-txt-4 font-sans">{{ t('字段属性') }}</span>
        <span
          v-if="rowErrors(activeColumn).length"
          class="text-danger ml-2 truncate font-sans"
          >{{ rowErrors(activeColumn)[0] }}</span
        >
      </p>
      <div class="text-txt-4 grid gap-1">
        <span>{{ t('默认值') }}</span>
        <AppSelect
          :model-value="defaultMode(activeColumn)"
          :label="t('默认值类型')"
          :options="defaultModeOptions"
          hide-label
          compact
          :disabled="
            activeColumn.autoIncrement ||
            Boolean(activeColumn.generatedExpression)
          "
          @update:model-value="setDefaultMode(activeColumn, $event)"
        />
      </div>
      <label
        v-if="columnTypeTraits(activeColumn.dataType, databaseKind).onUpdate"
        class="text-txt-3 flex items-center gap-2 self-end pb-1.5"
      >
        <AppCheckbox
          :model-value="Boolean(activeColumn.onUpdateCurrentTimestamp)"
          :label="t('更新时自动设为当前时间')"
          hide-label
          :disabled="Boolean(activeColumn.generatedExpression)"
          @update:model-value="
            updateColumn(activeColumn.id, {
              onUpdateCurrentTimestamp: $event,
            })
          "
        />{{ t('更新时自动设为当前时间') }}
      </label>
      <label
        v-if="columnTypeTraits(activeColumn.dataType, databaseKind).zerofill"
        class="text-txt-3 flex items-center gap-2 self-end pb-1.5"
      >
        <AppCheckbox
          :model-value="Boolean(activeColumn.zerofill)"
          :label="t('零填充')"
          hide-label
          @update:model-value="
            updateColumn(activeColumn.id, { zerofill: $event })
          "
        />{{ t('零填充') }}
      </label>
      <div
        v-if="columnTypeTraits(activeColumn.dataType, databaseKind).charset"
        class="text-txt-4 grid gap-1"
      >
        <span>{{ t('字符集') }}</span>
        <AppSelect
          v-if="collations.length"
          :model-value="activeColumn.charset ?? ''"
          :label="t('字符集')"
          :options="charsetOptions"
          hide-label
          compact
          searchable
          @update:model-value="
            updateColumn(activeColumn.id, {
              charset: $event,
              collation: activeColumn.collation?.startsWith(`${$event}_`)
                ? activeColumn.collation
                : '',
            })
          "
        />
        <AppInput
          v-else
          :model-value="activeColumn.charset ?? ''"
          size="sm"
          monospace
          :placeholder="inherit"
          @update:model-value="
            updateColumn(activeColumn.id, { charset: $event })
          "
        />
      </div>
      <div
        v-if="columnTypeTraits(activeColumn.dataType, databaseKind).collation"
        class="text-txt-4 grid gap-1"
      >
        <span>{{ t('排序规则') }}</span>
        <AppSelect
          v-if="collations.length"
          :model-value="activeColumn.collation ?? ''"
          :label="t('排序规则')"
          :options="collationOptions(activeColumn)"
          hide-label
          compact
          searchable
          @update:model-value="
            updateColumn(activeColumn.id, { collation: $event })
          "
        />
        <AppInput
          v-else
          :model-value="activeColumn.collation ?? ''"
          size="sm"
          monospace
          :placeholder="mysql ? inherit : 'C / en_US.utf8'"
          @update:model-value="
            updateColumn(activeColumn.id, { collation: $event })
          "
        />
      </div>
      <div class="text-txt-4 col-span-2 grid gap-1">
        <span>{{ t('生成列表达式') }}</span>
        <div class="flex gap-1.5">
          <AppInput
            :model-value="activeColumn.generatedExpression ?? ''"
            size="sm"
            monospace
            :placeholder="t('留空表示普通字段，如 price * qty')"
            @update:model-value="
              updateColumn(activeColumn.id, {
                generatedExpression: $event,
                ...($event.trim()
                  ? { defaultValue: '', autoIncrement: false }
                  : {}),
              })
            "
          />
          <AppSelect
            v-if="mysql"
            class="w-28 shrink-0"
            :model-value="activeColumn.generatedStored ? 'stored' : 'virtual'"
            :label="t('生成列存储方式')"
            :options="[
              { value: 'virtual', label: 'VIRTUAL' },
              { value: 'stored', label: 'STORED' },
            ]"
            hide-label
            compact
            :disabled="!activeColumn.generatedExpression"
            @update:model-value="
              updateColumn(activeColumn.id, {
                generatedStored: $event === 'stored',
              })
            "
          />
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="reorder.dragging.value && draggedColumn"
        class="designer-drag-ghost text-txt pointer-events-none fixed z-200 flex max-w-155 -translate-y-1/2 items-center gap-2.5 rounded-lg py-1.5 pr-3 pl-1.5 text-[11px] leading-none whitespace-nowrap"
        :style="reorder.dragStyle.value"
        aria-hidden="true"
      >
        <span class="text-accent grid w-4 shrink-0 place-items-center">
          <AppIcon
            name="lucide:grip-vertical"
            :size="11"
          />
        </span>
        <span class="text-txt-2 min-w-0 overflow-hidden font-mono text-ellipsis tabular-nums">
          {{ draggedColumn.name }}
        </span>
        <span class="text-txt-2 min-w-0 overflow-hidden font-mono text-ellipsis tabular-nums">
          {{ draggedColumn.dataType
          }}{{ draggedColumn.length ? `(${draggedColumn.length})` : '' }}
        </span>
        <span
          v-if="draggedColumn.primaryKey"
          class="designer-ghost-badge"
        >
          PK
        </span>
        <span
          v-if="draggedColumn.unique"
          class="designer-ghost-badge"
        >
          UQ
        </span>
        <span
          v-if="draggedColumn.autoIncrement"
          class="designer-ghost-badge"
        >
          AI
        </span>
        <span
          v-if="draggedColumn.defaultValue"
          class="text-txt-2 min-w-0 overflow-hidden font-mono text-ellipsis tabular-nums"
        >
          {{ draggedColumn.defaultValue }}
        </span>
        <span
          v-if="draggedColumn.comment"
          class="text-txt-2 min-w-0 overflow-hidden text-ellipsis"
        >
          {{ draggedColumn.comment }}
        </span>
      </div>
    </Teleport>
  </section>
</template>
