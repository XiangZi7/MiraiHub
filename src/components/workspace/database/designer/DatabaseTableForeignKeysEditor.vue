<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { DatabaseObject } from '@/types/database'
import type {
  ReferentialAction,
  TableDesignerColumn,
  TableDesignerForeignKey,
} from '@/types/database-designer'

const props = defineProps<{
  modelValue: TableDesignerForeignKey[]
  columns: readonly TableDesignerColumn[]
  schema: string
  tables: readonly DatabaseObject[]
  referencedColumns: Readonly<Record<string, string[]>>
  loadingReference: string
}>()

const emit = defineEmits<{
  'update:modelValue': [foreignKeys: TableDesignerForeignKey[]]
  'inspect-table': [schema: string, table: string]
}>()

const tableOptions = computed(() =>
  props.tables
    .filter(object => object.kind === 'table')
    .map(object => ({
      key: `${object.schema}.${object.name}`,
      schema: object.schema,
      name: object.name,
    }))
)

const referentialActions: readonly ReferentialAction[] = [
  'NO ACTION',
  'RESTRICT',
  'CASCADE',
  'SET NULL',
]
const localColumnOptions = computed(() =>
  props.columns.map(column => ({
    value: column.name,
    label: column.name || '未命名字段',
  }))
)
const tableSelectOptions = computed(() =>
  tableOptions.value.map(table => ({ value: table.key, label: table.key }))
)
const actionOptions = referentialActions.map(value => ({ value, label: value }))

function referencedColumnOptions(
  foreignKey: TableDesignerForeignKey
): Array<{ value: string; label: string }> {
  return (props.referencedColumns[referenceKey(foreignKey)] ?? []).map(
    value => ({ value, label: value })
  )
}

function newId(): string {
  return `foreign-key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function addForeignKey(): void {
  const firstTable = tableOptions.value[0]
  const foreignKey: TableDesignerForeignKey = {
    id: newId(),
    name: `fk_${props.modelValue.length + 1}`,
    column: props.columns[0]?.name ?? '',
    referencedSchema: firstTable?.schema ?? props.schema,
    referencedTable: firstTable?.name ?? '',
    referencedColumn: '',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  }
  emit('update:modelValue', [...props.modelValue, foreignKey])
  if (foreignKey.referencedTable)
    emit(
      'inspect-table',
      foreignKey.referencedSchema,
      foreignKey.referencedTable
    )
}

function updateForeignKey(
  id: string,
  patch: Partial<TableDesignerForeignKey>
): void {
  emit(
    'update:modelValue',
    props.modelValue.map(foreignKey =>
      foreignKey.id === id ? { ...foreignKey, ...patch } : foreignKey
    )
  )
}

function selectTable(foreignKey: TableDesignerForeignKey, value: string): void {
  const table = tableOptions.value.find(item => item.key === value)
  if (!table) {
    updateForeignKey(foreignKey.id, {
      referencedTable: value,
      referencedColumn: '',
    })
    return
  }
  updateForeignKey(foreignKey.id, {
    referencedSchema: table.schema,
    referencedTable: table.name,
    referencedColumn: '',
  })
  emit('inspect-table', table.schema, table.name)
}

function referenceKey(foreignKey: TableDesignerForeignKey): string {
  return `${foreignKey.referencedSchema}.${foreignKey.referencedTable}`
}

function removeForeignKey(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter(foreignKey => foreignKey.id !== id)
  )
}
</script>

<template>
  <section class="designer-section">
    <div class="designer-section-heading">
      <div>
        <h3>外键约束</h3>
        <p>关联已有表，并配置更新、删除时的参照行为。</p>
      </div>
      <AppButton
        size="sm"
        @click="addForeignKey"
        ><AppIcon
          name="lucide:plus"
          :size="11"
        />添加外键</AppButton
      >
    </div>

    <div class="foreign-key-list scroll-thin">
      <article
        v-for="foreignKey in modelValue"
        :key="foreignKey.id"
        class="foreign-key-card"
      >
        <div class="foreign-key-heading">
          <span class="foreign-key-icon"
            ><AppIcon
              name="lucide:link-2"
              :size="14"
          /></span>
          <label class="field-label"
            >约束名<AppInput
              :model-value="foreignKey.name"
              monospace
              @update:model-value="
                updateForeignKey(foreignKey.id, { name: $event })
              "
          /></label>
          <IconButton
            icon="lucide:trash-2"
            :size="12"
            class="text-danger hover:text-danger size-7"
            title="删除外键"
            @click="removeForeignKey(foreignKey.id)"
          />
        </div>

        <div class="reference-flow">
          <div class="field-label">
            <span>本地字段</span
            ><AppSelect
              :model-value="foreignKey.column"
              label="本地字段"
              :options="localColumnOptions"
              placeholder="请选择字段"
              hide-label
              compact
              @update:model-value="
                updateForeignKey(foreignKey.id, { column: $event })
              "
            />
          </div>
          <span class="flow-arrow"
            ><AppIcon
              name="lucide:arrow-right"
              :size="14"
          /></span>
          <div class="field-label">
            <span>引用表</span
            ><AppSelect
              :model-value="referenceKey(foreignKey)"
              label="引用表"
              :options="tableSelectOptions"
              placeholder="请选择引用表"
              hide-label
              compact
              searchable
              @update:model-value="selectTable(foreignKey, $event)"
            />
          </div>
          <span class="flow-arrow"
            ><AppIcon
              name="lucide:arrow-right"
              :size="14"
          /></span>
          <div class="field-label">
            <span>引用字段</span
            ><AppSelect
              :model-value="foreignKey.referencedColumn"
              label="引用字段"
              :options="referencedColumnOptions(foreignKey)"
              :placeholder="
                loadingReference === referenceKey(foreignKey)
                  ? '正在读取字段…'
                  : '请选择字段'
              "
              hide-label
              compact
              :disabled="
                !foreignKey.referencedTable ||
                loadingReference === referenceKey(foreignKey)
              "
              @update:model-value="
                updateForeignKey(foreignKey.id, { referencedColumn: $event })
              "
            />
          </div>
        </div>

        <div class="action-grid">
          <div class="field-label">
            <span>删除时</span
            ><AppSelect
              :model-value="foreignKey.onDelete"
              label="删除时"
              :options="actionOptions"
              hide-label
              compact
              @update:model-value="
                updateForeignKey(foreignKey.id, {
                  onDelete: $event as ReferentialAction,
                })
              "
            />
          </div>
          <div class="field-label">
            <span>更新时</span
            ><AppSelect
              :model-value="foreignKey.onUpdate"
              label="更新时"
              :options="actionOptions"
              hide-label
              compact
              @update:model-value="
                updateForeignKey(foreignKey.id, {
                  onUpdate: $event as ReferentialAction,
                })
              "
            />
          </div>
          <p class="action-hint">
            <AppIcon
              name="lucide:info"
              :size="11"
            />SET NULL 要求本地字段允许为空；CASCADE 会同步变更关联数据。
          </p>
        </div>
      </article>

      <div
        v-if="!modelValue.length"
        class="empty-state"
      >
        <AppIcon
          name="lucide:link-2"
          :size="24"
        />
        <p>尚未配置外键</p>
        <span>添加后可从当前数据库的已有表中选择引用字段。</span>
      </div>
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
.designer-section-heading p,
.field-label {
  margin-top: 2px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.foreign-key-list {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.foreign-key-card {
  margin-bottom: 9px;
  border: 1px solid var(--color-line-soft);
  border-radius: 9px;
  background:
    linear-gradient(145deg, rgb(255 255 255 / 3%), transparent),
    color-mix(in oklch, var(--color-card) 72%, transparent);
  padding: 11px;
  box-shadow: inset 0 1px rgb(255 255 255 / 3%);
}
.foreign-key-heading {
  display: grid;
  grid-template-columns: 32px minmax(180px, 360px) 28px;
  align-items: end;
  gap: 8px;
}
.foreign-key-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid
    color-mix(in oklch, var(--color-blue) 28%, var(--color-line));
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-blue) 9%, transparent);
  color: var(--color-blue);
}
.field-label {
  display: grid;
  gap: 4px;
}
.reference-flow {
  display: grid;
  grid-template-columns:
    minmax(140px, 1fr) 24px minmax(180px, 1.3fr)
    24px minmax(140px, 1fr);
  align-items: end;
  gap: 7px;
  margin-top: 12px;
}
.flow-arrow {
  display: grid;
  height: 32px;
  place-items: center;
  color: var(--color-txt-4);
}
.action-grid {
  display: grid;
  grid-template-columns: 150px 150px 1fr;
  align-items: end;
  gap: 8px;
  margin-top: 10px;
}
.action-hint {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 5px;
  color: var(--color-txt-4);
  font-size: 9px;
}
.empty-state {
  display: grid;
  min-height: 230px;
  place-items: center;
  align-content: center;
  gap: 7px;
  color: var(--color-txt-4);
  font-size: 11px;
  text-align: center;
}
.empty-state span {
  font-size: 9.5px;
}
@media (max-width: 900px) {
  .reference-flow {
    grid-template-columns: 1fr;
  }
  .flow-arrow {
    display: none;
  }
  .action-grid {
    grid-template-columns: 1fr 1fr;
  }
  .action-hint {
    grid-column: 1 / -1;
  }
}
</style>
