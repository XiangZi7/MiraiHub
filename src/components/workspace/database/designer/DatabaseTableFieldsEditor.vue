<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, useTemplateRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useTabReorder } from '@/composables/useTabReorder'
import { cn } from '@/utils/cn'
import type { DatabaseKind } from '@/types/database'
import type { TableDesignerColumn } from '@/types/database-designer'
import { columnTypes } from '@/utils/database-ddl'

const { t } = useI18n()

const props = defineProps<{
  modelValue: TableDesignerColumn[]
  databaseKind: DatabaseKind
  /** 编辑模式下当前表已有的非标准类型（如 ENUM），合并进类型下拉框。 */
  extraTypes?: readonly string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [columns: TableDesignerColumn[]]
}>()

const tableWrap = useTemplateRef<HTMLElement>('tableWrap')
const reorder = useTabReorder({
  tabs: () => props.modelValue,
  container: () => tableWrap.value,
  onReorder: moveColumnFromIndex,
})
const draggedColumn = computed(() =>
  props.modelValue.find(column => column.id === reorder.draggedId.value)
)

const typeOptions = computed(() => {
  const base = columnTypes(props.databaseKind).map(value => ({
    value,
    label: value,
  }))
  const known = new Set(base.map(option => option.value))
  const extra = (props.extraTypes ?? [])
    .filter(value => !known.has(value))
    .map(value => ({ value, label: value }))
  return [...base, ...extra]
})

function newId(): string {
  return `column-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function addColumn(): void {
  const first = props.modelValue.length === 0
  emit('update:modelValue', [
    ...props.modelValue,
    {
      id: newId(),
      name: first ? 'id' : `column_${props.modelValue.length + 1}`,
      dataType: first ? 'BIGINT' : 'VARCHAR',
      length: first ? '' : '255',
      nullable: !first,
      primaryKey: first,
      unique: false,
      unsigned: false,
      autoIncrement: first,
      defaultValue: '',
      comment: '',
    },
  ])
}

function updateColumn(id: string, patch: Partial<TableDesignerColumn>): void {
  emit(
    'update:modelValue',
    props.modelValue.map(column =>
      column.id === id ? { ...column, ...patch } : column
    )
  )
}

function removeColumn(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter(column => column.id !== id)
  )
}

/** 把某列从一个索引移动到另一个索引（拖拽与上下按钮共用）。 */
function moveColumnFromIndex(fromIndex: number, toIndex: number): void {
  const target = Math.max(0, Math.min(toIndex, props.modelValue.length - 1))
  if (fromIndex < 0 || fromIndex === target) return
  const columns = [...props.modelValue]
  const [column] = columns.splice(fromIndex, 1)
  if (!column) return
  columns.splice(target, 0, column)
  emit('update:modelValue', columns)
}

function moveColumn(index: number, direction: -1 | 1): void {
  moveColumnFromIndex(index, index + direction)
}
</script>

<template>
  <section class="designer-section">
    <div class="designer-section-heading">
      <div>
        <h3>{{ t('字段定义') }}</h3>
        <p>{{ t('配置字段类型、长度、主键、默认值与自动递增。') }}</p>
      </div>
      <AppButton
        size="sm"
        @click="addColumn"
      >
        <AppIcon
          name="lucide:plus"
          :size="11"
        />
        {{ t('添加字段') }}
      </AppButton>
    </div>

    <div class="designer-table-wrap scroll-thin">
      <table class="designer-table min-w-[1120px]">
        <thead>
          <tr>
            <th class="w-16">{{ t('排序') }}</th>
            <th class="min-w-36">{{ t('字段名') }}</th>
            <th class="min-w-38">{{ t('类型') }}</th>
            <th class="w-24">{{ t('长度/精度') }}</th>
            <th class="w-14">{{ t('可空') }}</th>
            <th class="w-14">{{ t('主键') }}</th>
            <th class="w-14">{{ t('唯一') }}</th>
            <th
              v-if="databaseKind === 'mysql'"
              class="w-16"
            >
              {{ t('无符号') }}
            </th>
            <th class="w-16">{{ t('自增') }}</th>
            <th class="min-w-40">{{ t('默认值') }}</th>
            <th class="min-w-44">{{ t('备注') }}</th>
            <th class="w-10" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(column, index) in modelValue"
            :key="column.id"
            :data-reorderable-tab-id="column.id"
            :class="
              cn(
                reorder.draggedId.value === column.id && 'field-dragging',
                reorder.targetId.value === column.id &&
                  reorder.targetPosition.value === 'before' &&
                  'field-drop-before',
                reorder.targetId.value === column.id &&
                  reorder.targetPosition.value === 'after' &&
                  'field-drop-after'
              )
            "
            @pointerdown="reorder.start($event, column.id)"
          >
            <td>
              <div class="flex items-center justify-center gap-0.5">
                <span
                  class="field-grip"
                  :title="t('拖动排序')"
                >
                  <AppIcon
                    name="lucide:grip-vertical"
                    :size="11"
                  />
                </span>
                <IconButton
                  icon="lucide:chevron-up"
                  :size="11"
                  class="size-6"
                  :title="t('上移')"
                  :disabled="index === 0"
                  @click="moveColumn(index, -1)"
                />
                <IconButton
                  icon="lucide:chevron-down"
                  :size="11"
                  class="size-6"
                  :title="t('下移')"
                  :disabled="index === modelValue.length - 1"
                  @click="moveColumn(index, 1)"
                />
              </div>
            </td>
            <td>
              <AppInput
                :model-value="column.name"
                variant="cell"
                monospace
                :aria-label="t('字段名')"
                @update:model-value="updateColumn(column.id, { name: $event })"
              />
            </td>
            <td>
              <AppSelect
                :model-value="column.dataType"
                :label="t('字段类型')"
                :options="typeOptions"
                hide-label
                compact
                @update:model-value="
                  updateColumn(column.id, { dataType: $event })
                "
              />
            </td>
            <td>
              <AppInput
                :model-value="column.length"
                variant="cell"
                monospace
                placeholder="255 / 10,2"
                :aria-label="t('长度或精度')"
                @update:model-value="
                  updateColumn(column.id, { length: $event })
                "
              />
            </td>
            <td>
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
            <td>
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="column.primaryKey"
                  :label="t('主键')"
                  hide-label
                  @update:model-value="
                    updateColumn(column.id, {
                      primaryKey: $event,
                      nullable: $event ? false : column.nullable,
                    })
                  "
                />
              </div>
            </td>
            <td>
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
            <td v-if="databaseKind === 'mysql'">
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="column.unsigned"
                  :label="t('无符号')"
                  hide-label
                  @update:model-value="
                    updateColumn(column.id, { unsigned: $event })
                  "
                />
              </div>
            </td>
            <td>
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="column.autoIncrement"
                  :label="t('自动递增')"
                  hide-label
                  @update:model-value="
                    updateColumn(column.id, { autoIncrement: $event })
                  "
                />
              </div>
            </td>
            <td>
              <AppInput
                :model-value="column.defaultValue"
                variant="cell"
                monospace
                placeholder="NULL / CURRENT_TIMESTAMP"
                :aria-label="t('默认值表达式')"
                :disabled="column.autoIncrement"
                @update:model-value="
                  updateColumn(column.id, { defaultValue: $event })
                "
              />
            </td>
            <td>
              <AppInput
                :model-value="column.comment"
                variant="cell"
                :placeholder="t('字段说明')"
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
                @click="removeColumn(column.id)"
              />
            </td>
          </tr>
          <tr v-if="!modelValue.length">
            <td
              :colspan="databaseKind === 'mysql' ? 12 : 11"
              class="text-txt-4 h-28 text-center"
            >
              {{ t('尚未添加字段') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div
        v-if="reorder.dragging.value && draggedColumn"
        class="field-drag-ghost"
        :style="reorder.dragStyle.value"
        aria-hidden="true"
      >
        <AppIcon
          name="lucide:grip-vertical"
          :size="12"
          class="text-accent shrink-0"
        />
        <span class="min-w-0 truncate">{{ draggedColumn.name }}</span>
        <span class="text-txt-4 shrink-0">{{ draggedColumn.dataType }}</span>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.designer-section {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.designer-section-heading {
  display: flex;
  min-height: 58px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 9px 12px;
}
.designer-section-heading h3 {
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 600;
}
.designer-section-heading p {
  margin-top: 2px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.designer-table-wrap {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 10px;
}
.designer-table {
  width: 100%;
  border-collapse: separate;
  border: 1px solid var(--color-line-soft);
  border-spacing: 0;
  overflow: hidden;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-card) 72%, transparent);
  font-size: 10.5px;
}
.designer-table th {
  position: sticky;
  z-index: 2;
  top: 0;
  border-right: 1px solid var(--color-line-soft);
  border-bottom: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  padding: 7px 6px;
  color: var(--color-txt-3);
  font-weight: 500;
  text-align: left;
}
.designer-table td {
  height: 36px;
  border-right: 1px solid var(--color-line-soft);
  border-bottom: 1px solid var(--color-line-soft);
  padding: 3px;
  color: var(--color-txt-2);
}
.designer-table tr:hover td {
  background: color-mix(in oklch, var(--color-hover) 72%, transparent);
}
/* 行内拖拽排序：行本身不选中文字，第一个单元格承担落点指示器 */
.designer-table tbody tr {
  user-select: none;
}
.designer-table tbody td:first-child {
  position: relative;
}
.field-grip {
  display: grid;
  place-items: center;
  width: 14px;
  height: 22px;
  color: var(--color-txt-4);
  cursor: grab;
  touch-action: none;
}
.field-grip:hover {
  color: var(--color-txt-2);
}
.designer-table tbody tr:active .field-grip {
  cursor: grabbing;
}
.designer-table tr.field-dragging td {
  opacity: 0.42;
}
/* 落点指示器：与标签栏同款的紫色光条 */
.designer-table tr.field-drop-before td:first-child::before,
.designer-table tr.field-drop-after td:first-child::after {
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 2px;
  border-radius: 999px;
  background: var(--color-violet);
  box-shadow: 0 0 9px color-mix(in oklch, var(--color-violet) 55%, transparent);
  content: '';
}
.designer-table tr.field-drop-before td:first-child::before {
  left: 0;
}
.designer-table tr.field-drop-after td:first-child::after {
  right: 0;
}
/* 拖拽幽灵：与标签栏 / 侧栏连接的拖拽样式一致 */
.field-drag-ghost {
  position: fixed;
  z-index: 200;
  display: flex;
  max-width: 260px;
  pointer-events: none;
  align-items: center;
  gap: 7px;
  border: 1px solid
    color-mix(in oklch, var(--color-violet) 48%, var(--color-line));
  border-radius: 7px;
  background: var(--color-panel);
  box-shadow: 0 10px 28px rgb(0 0 0 / 28%);
  padding: 7px 10px;
  color: var(--color-txt);
  font-size: 11.5px;
  line-height: 1;
  transform: translateY(-50%);
  white-space: nowrap;
}
</style>
