<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { DatabaseKind } from '@/types/database'
import type { TableDesignerColumn } from '@/types/database-designer'
import { columnTypes } from '@/utils/database-ddl'

const props = defineProps<{
  modelValue: TableDesignerColumn[]
  databaseKind: DatabaseKind
}>()

const emit = defineEmits<{
  'update:modelValue': [columns: TableDesignerColumn[]]
}>()

const typeOptions = computed(() =>
  columnTypes(props.databaseKind).map(value => ({ value, label: value }))
)

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

function moveColumn(index: number, direction: -1 | 1): void {
  const target = index + direction
  if (target < 0 || target >= props.modelValue.length) return
  const columns = [...props.modelValue]
  const [column] = columns.splice(index, 1)
  if (!column) return
  columns.splice(target, 0, column)
  emit('update:modelValue', columns)
}
</script>

<template>
  <section class="designer-section">
    <div class="designer-section-heading">
      <div>
        <h3>字段定义</h3>
        <p>配置字段类型、长度、主键、默认值与自动递增。</p>
      </div>
      <AppButton
        size="sm"
        @click="addColumn"
      >
        <AppIcon
          name="lucide:plus"
          :size="11"
        />添加字段
      </AppButton>
    </div>

    <div class="designer-table-wrap scroll-thin">
      <table class="designer-table min-w-[1120px]">
        <thead>
          <tr>
            <th class="w-16">排序</th>
            <th class="min-w-36">字段名</th>
            <th class="min-w-38">类型</th>
            <th class="w-24">长度/精度</th>
            <th class="w-14">可空</th>
            <th class="w-14">主键</th>
            <th class="w-14">唯一</th>
            <th
              v-if="databaseKind === 'mysql'"
              class="w-16"
            >
              无符号
            </th>
            <th class="w-16">自增</th>
            <th class="min-w-40">默认值</th>
            <th class="min-w-44">备注</th>
            <th class="w-10" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(column, index) in modelValue"
            :key="column.id"
          >
            <td>
              <div class="flex justify-center gap-0.5">
                <IconButton
                  icon="lucide:chevron-up"
                  :size="11"
                  class="size-6"
                  title="上移"
                  :disabled="index === 0"
                  @click="moveColumn(index, -1)"
                />
                <IconButton
                  icon="lucide:chevron-down"
                  :size="11"
                  class="size-6"
                  title="下移"
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
                aria-label="字段名"
                @update:model-value="updateColumn(column.id, { name: $event })"
              />
            </td>
            <td>
              <AppSelect
                :model-value="column.dataType"
                label="字段类型"
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
                aria-label="长度或精度"
                @update:model-value="
                  updateColumn(column.id, { length: $event })
                "
              />
            </td>
            <td>
              <div class="flex justify-center">
                <AppCheckbox
                  :model-value="column.nullable"
                  label="允许为空"
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
                  label="主键"
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
                  label="唯一"
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
                  label="无符号"
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
                  label="自动递增"
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
                aria-label="默认值表达式"
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
                placeholder="字段说明"
                aria-label="字段备注"
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
                title="删除字段"
                @click="removeColumn(column.id)"
              />
            </td>
          </tr>
          <tr v-if="!modelValue.length">
            <td
              :colspan="databaseKind === 'mysql' ? 12 : 11"
              class="text-txt-4 h-28 text-center"
            >
              尚未添加字段
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
</style>
