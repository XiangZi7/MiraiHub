<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { DatabaseKind, DatabaseObject } from '@/types/database'
import type {
  ReferentialAction,
  TableDesignerColumn,
  TableDesignerForeignKey,
} from '@/types/database-designer'

const { t } = useI18n()

const props = defineProps<{
  modelValue: TableDesignerForeignKey[]
  columns: readonly TableDesignerColumn[]
  schema: string
  tables: readonly DatabaseObject[]
  referencedColumns: Readonly<Record<string, string[]>>
  loadingReference: string
  databaseKind?: DatabaseKind
  /** 按外键 id 归档的校验错误。 */
  errors?: Readonly<Record<string, string[]>>
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

const actionOptions = computed(() =>
  (
    [
      'NO ACTION',
      'RESTRICT',
      'CASCADE',
      'SET NULL',
      ...(props.databaseKind === 'mysql' ? [] : ['SET DEFAULT']),
    ] as ReferentialAction[]
  ).map(value => ({ value, label: value }))
)
const localColumnOptions = computed(() =>
  props.columns.map(column => ({
    value: column.name,
    label: column.name || t('未命名字段'),
  }))
)
const tableSelectOptions = computed(() =>
  tableOptions.value.map(table => ({ value: table.key, label: table.key }))
)

/** 引用表已读取到的字段，作为引用字段下拉选项。 */
function referencedColumnOptions(
  foreignKey: TableDesignerForeignKey
): Array<{ value: string; label: string }> {
  return (props.referencedColumns[referenceKey(foreignKey)] ?? []).map(
    value => ({ value, label: value })
  )
}

/** 生成外键草稿 id。 */
function newId(): string {
  return `foreign-key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** 新增一个外键，默认引用第一张表并读取其字段。 */
function addForeignKey(): void {
  const firstTable = tableOptions.value[0]
  const foreignKey: TableDesignerForeignKey = {
    id: newId(),
    name: `fk_${props.modelValue.length + 1}`,
    columns: [props.columns[0]?.name ?? ''],
    referencedSchema: firstTable?.schema ?? props.schema,
    referencedTable: firstTable?.name ?? '',
    referencedColumns: [''],
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

/** 按 id 合并修改一个外键。 */
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

/** 切换引用表：清空引用字段（保持列对数量）并联动读取新表字段。 */
function selectTable(foreignKey: TableDesignerForeignKey, value: string): void {
  const cleared = foreignKey.referencedColumns.map(() => '')
  const table = tableOptions.value.find(item => item.key === value)
  if (!table) {
    updateForeignKey(foreignKey.id, {
      referencedTable: value,
      referencedColumns: cleared,
    })
    return
  }
  updateForeignKey(foreignKey.id, {
    referencedSchema: table.schema,
    referencedTable: table.name,
    referencedColumns: cleared,
  })
  emit('inspect-table', table.schema, table.name)
}

/** 修改第 index 对列映射中的本地字段或引用字段。 */
function updatePair(
  foreignKey: TableDesignerForeignKey,
  index: number,
  side: 'columns' | 'referencedColumns',
  value: string
): void {
  const list = [...foreignKey[side]]
  list[index] = value
  updateForeignKey(foreignKey.id, { [side]: list })
}

/** 追加一对列映射，组成多列外键。 */
function addPair(foreignKey: TableDesignerForeignKey): void {
  updateForeignKey(foreignKey.id, {
    columns: [...foreignKey.columns, ''],
    referencedColumns: [...foreignKey.referencedColumns, ''],
  })
}

/** 删除一对列映射，至少保留一对。 */
function removePair(foreignKey: TableDesignerForeignKey, index: number): void {
  if (foreignKey.columns.length <= 1) return
  updateForeignKey(foreignKey.id, {
    columns: foreignKey.columns.filter((_, i) => i !== index),
    referencedColumns: foreignKey.referencedColumns.filter(
      (_, i) => i !== index
    ),
  })
}

/** 引用表在字段缓存中的键。 */
function referenceKey(foreignKey: TableDesignerForeignKey): string {
  return `${foreignKey.referencedSchema}.${foreignKey.referencedTable}`
}

/** 删除外键。 */
function removeForeignKey(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter(foreignKey => foreignKey.id !== id)
  )
}

// 「添加外键」按钮住在设计器工具条上，不在本面板里。
defineExpose({ add: addForeignKey })
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="scroll-thin min-h-0 overflow-y-auto p-3">
      <article
        v-for="foreignKey in modelValue"
        :key="foreignKey.id"
        class="border-line-soft bg-card/70 mb-2.5 rounded-[9px] border p-3"
        :class="errors?.[foreignKey.id]?.length ? 'border-danger/50' : ''"
      >
        <div class="grid grid-cols-[32px_minmax(180px,360px)_28px] items-end gap-2">
          <span
            class="border-blue/30 bg-blue/10 text-blue grid size-[30px] place-items-center rounded-[7px] border"
            ><AppIcon
              name="lucide:link-2"
              :size="14"
          /></span>
          <label class="text-txt-4 grid gap-1 text-[9.5px]">
            {{ t('约束名') }}
            <AppInput
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
            :title="t('删除外键')"
            @click="removeForeignKey(foreignKey.id)"
          />
        </div>

        <div class="text-txt-4 mt-3 grid gap-1 text-[9.5px]">
          <span>{{ t('引用表') }}</span>
          <div class="max-w-[420px]">
            <AppSelect
              :model-value="referenceKey(foreignKey)"
              :label="t('引用表')"
              :options="tableSelectOptions"
              :placeholder="t('请选择引用表')"
              hide-label
              compact
              searchable
              @update:model-value="selectTable(foreignKey, $event)"
            />
          </div>
        </div>

        <div class="mt-2.5 grid gap-1.5">
          <div
            class="text-txt-4 grid grid-cols-[minmax(140px,1fr)_24px_minmax(140px,1fr)_28px] gap-1.5 text-[9.5px]"
          >
            <span>{{ t('本地字段') }}</span>
            <span />
            <span>{{ t('引用字段') }}</span>
            <span />
          </div>
          <div
            v-for="(column, index) in foreignKey.columns"
            :key="index"
            class="grid grid-cols-[minmax(140px,1fr)_24px_minmax(140px,1fr)_28px] items-center gap-1.5"
          >
            <AppSelect
              :model-value="column"
              :label="t('本地字段')"
              :options="localColumnOptions"
              :placeholder="t('请选择字段')"
              hide-label
              compact
              @update:model-value="
                updatePair(foreignKey, index, 'columns', $event)
              "
            />
            <span class="text-txt-4 grid place-items-center"
              ><AppIcon
                name="lucide:arrow-right"
                :size="14"
            /></span>
            <AppSelect
              :model-value="foreignKey.referencedColumns[index] ?? ''"
              :label="t('引用字段')"
              :options="referencedColumnOptions(foreignKey)"
              :placeholder="
                loadingReference === referenceKey(foreignKey)
                  ? t('正在读取字段…')
                  : t('请选择字段')
              "
              hide-label
              compact
              :disabled="
                !foreignKey.referencedTable ||
                loadingReference === referenceKey(foreignKey)
              "
              @update:model-value="
                updatePair(foreignKey, index, 'referencedColumns', $event)
              "
            />
            <IconButton
              icon="lucide:minus"
              :size="12"
              class="size-7"
              :title="t('移除字段对')"
              :disabled="foreignKey.columns.length <= 1"
              @click="removePair(foreignKey, index)"
            />
          </div>
          <button
            type="button"
            class="text-blue hover:bg-blue/10 flex w-fit items-center gap-1 rounded px-1.5 py-1 text-[10px] motion-safe:transition-colors"
            @click="addPair(foreignKey)"
          >
            <AppIcon
              name="lucide:plus"
              :size="11"
            />
            {{ t('添加字段对（多列外键）') }}
          </button>
        </div>

        <div class="mt-2.5 grid grid-cols-[150px_150px_1fr] items-end gap-2 max-[900px]:grid-cols-2">
          <div class="text-txt-4 grid gap-1 text-[9.5px]">
            <span> {{ t('删除时') }} </span
            ><AppSelect
              :model-value="foreignKey.onDelete"
              :label="t('删除时')"
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
          <div class="text-txt-4 grid gap-1 text-[9.5px]">
            <span> {{ t('更新时') }} </span
            ><AppSelect
              :model-value="foreignKey.onUpdate"
              :label="t('更新时')"
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
          <p
            class="text-txt-4 flex min-h-8 items-center gap-1.5 text-[9px] max-[900px]:col-span-full"
          >
            <AppIcon
              name="lucide:info"
              :size="11"
            />
            {{
              t('SET NULL 要求本地字段允许为空；CASCADE 会同步变更关联数据。')
            }}
          </p>
        </div>
        <ul
          v-if="errors?.[foreignKey.id]?.length"
          class="text-danger mt-2 grid gap-0.5 text-[10px]"
        >
          <li
            v-for="message in errors[foreignKey.id]"
            :key="message"
          >
            {{ message }}
          </li>
        </ul>
      </article>

      <div
        v-if="!modelValue.length"
        class="text-txt-4 grid min-h-[230px] place-items-center content-center gap-2 text-center text-[11px]"
      >
        <AppIcon
          name="lucide:link-2"
          :size="24"
        />
        <p>{{ t('尚未配置外键') }}</p>
        <span class="text-[9.5px]">
          {{ t('添加后可从当前数据库的已有表中选择引用字段。') }}
        </span>
      </div>
    </div>
  </section>
</template>
