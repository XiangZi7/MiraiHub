<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { DatabaseKind } from '@/types/database'
import type {
  TableDesignerColumn,
  TableDesignerIndex,
  TableDesignerIndexColumnOptions,
} from '@/types/database-designer'
import { cn } from '@/utils/cn'
import { columnTypeTraits, indexMethods } from '@/utils/database-ddl'

const { t } = useI18n()

const props = defineProps<{
  modelValue: TableDesignerIndex[]
  columns: readonly TableDesignerColumn[]
  databaseKind: DatabaseKind
  /** 按索引 ID 归类的校验错误。 */
  errors?: Record<string, string[]>
}>()

const emit = defineEmits<{
  'update:modelValue': [indexes: TableDesignerIndex[]]
}>()

const mysql = computed(() => props.databaseKind === 'mysql')
const kindOptions = computed(() => [
  { value: 'index', label: t('普通索引') },
  { value: 'unique', label: t('唯一索引') },
  ...(mysql.value
    ? [
        { value: 'fulltext', label: t('全文索引') },
        { value: 'spatial', label: t('空间索引') },
      ]
    : []),
])
const methodOptions = computed(() =>
  indexMethods(props.databaseKind).map(value => ({
    value,
    label: mysql.value ? value.toUpperCase() : value,
  }))
)

function newId(): string {
  return `index-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function addIndex(): void {
  const names = new Set(props.modelValue.map(index => index.name))
  let number = props.modelValue.length + 1
  while (names.has(`idx_${number}`)) number += 1
  emit('update:modelValue', [
    ...props.modelValue,
    {
      id: newId(),
      name: `idx_${number}`,
      kind: 'index',
      method: 'btree',
      columns: props.columns[0]?.name ? [props.columns[0].name] : [],
      columnOptions: {},
      comment: '',
      predicate: '',
    },
  ])
}

function updateIndex(id: string, patch: Partial<TableDesignerIndex>): void {
  emit(
    'update:modelValue',
    props.modelValue.map(index =>
      index.id === id ? { ...index, ...patch } : index
    )
  )
}

function setColumns(
  index: TableDesignerIndex,
  columns: string[],
  columnOptions = index.columnOptions ?? {}
): void {
  updateIndex(index.id, {
    columns,
    columnOptions: Object.fromEntries(
      columns.flatMap(column =>
        columnOptions[column] ? [[column, columnOptions[column]]] : []
      )
    ),
  })
}

function toggleColumn(index: TableDesignerIndex, column: string): void {
  setColumns(
    index,
    index.columns.includes(column)
      ? index.columns.filter(item => item !== column)
      : [...index.columns, column]
  )
}

function moveColumn(
  index: TableDesignerIndex,
  position: number,
  offset: -1 | 1
): void {
  const target = position + offset
  if (target < 0 || target >= index.columns.length) return
  const columns = [...index.columns]
  ;[columns[position], columns[target]] = [columns[target], columns[position]]
  setColumns(index, columns)
}

function updateOptions(
  index: TableDesignerIndex,
  column: string,
  patch: TableDesignerIndexColumnOptions
): void {
  updateIndex(index.id, {
    columnOptions: {
      ...index.columnOptions,
      [column]: { ...index.columnOptions?.[column], ...patch },
    },
  })
}

/** 表达式改写时 key 会变，需要整体替换这一项。 */
function renameExpression(
  index: TableDesignerIndex,
  position: number,
  value: string
): void {
  const previous = index.columns[position]
  if (value !== previous && index.columns.includes(value)) return
  const columns = index.columns.map((column, at) =>
    at === position ? value : column
  )
  const { [previous]: options, ...rest } = index.columnOptions ?? {}
  setColumns(index, columns, {
    ...rest,
    [value]: { ...options, expression: true },
  })
}

function addExpression(index: TableDesignerIndex): void {
  let expression = 'lower(column)'
  for (let number = 2; index.columns.includes(expression); number += 1)
    expression = `lower(column${number})`
  setColumns(index, [...index.columns, expression], {
    ...index.columnOptions,
    [expression]: { expression: true },
  })
}

function removeIndex(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter(index => index.id !== id)
  )
}

function changeKind(index: TableDesignerIndex, kind: string): void {
  const next = kind as TableDesignerIndex['kind']
  updateIndex(index.id, {
    kind: next,
    // 全文、空间索引没有方法和方向；PostgreSQL 的 HASH 不能做唯一。
    method:
      next === 'unique' && !mysql.value && index.method === 'hash'
        ? 'btree'
        : index.method,
  })
}

function ordered(index: TableDesignerIndex): boolean {
  return index.kind === 'index' || index.kind === 'unique'
}

function prefixAllowed(index: TableDesignerIndex, column: string): boolean {
  if (!ordered(index) || index.columnOptions?.[column]?.expression) return false
  const stored = props.columns.find(item => item.name === column)
  return Boolean(
    stored && columnTypeTraits(stored.dataType, props.databaseKind).prefix
  )
}

function indexErrors(index: TableDesignerIndex): string[] {
  return props.errors?.[index.id] ?? []
}

// 「添加索引」按钮住在设计器工具条上，不在本面板里。
defineExpose({ add: addIndex })
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="scroll-thin min-h-0 overflow-y-auto p-3">
      <article
        v-for="index in modelValue"
        :key="index.id"
        :class="
          cn(
            'designer-glass-card mb-2.25 rounded-[9px] p-2.75',
            indexErrors(index).length && 'border-danger/50!'
          )
        "
      >
        <div class="grid grid-cols-[32px_1fr_110px_28px] items-end gap-2 min-[901px]:grid-cols-[32px_minmax(150px,1fr)_130px_105px_28px]">
          <span class="border-[color-mix(in_oklch,var(--color-violet)_28%,var(--color-line))] bg-violet/9 text-violet grid size-7.5 place-items-center rounded-[7px] border"
            ><AppIcon
              name="lucide:list-tree"
              :size="14"
          /></span>
          <label class="text-txt-4 mt-0.5 grid gap-1 text-[9.5px]">
            {{ t('索引名') }}
            <AppInput
              :model-value="index.name"
              monospace
              @update:model-value="updateIndex(index.id, { name: $event })"
          /></label>
          <div class="text-txt-4 mt-0.5 grid gap-1 text-[9.5px]">
            <span> {{ t('类型') }} </span
            ><AppSelect
              :model-value="index.kind"
              :label="t('索引类型')"
              :options="kindOptions"
              hide-label
              compact
              @update:model-value="changeKind(index, $event)"
            />
          </div>
          <div class="text-txt-4 mt-0.5 hidden gap-1 text-[9.5px] min-[901px]:grid">
            <span> {{ t('方法') }} </span
            ><AppSelect
              :model-value="index.method"
              :label="t('索引方法')"
              :options="methodOptions"
              hide-label
              compact
              :disabled="!ordered(index)"
              @update:model-value="
                updateIndex(index.id, {
                  method: $event as TableDesignerIndex['method'],
                })
              "
            />
          </div>
          <IconButton
            icon="lucide:trash-2"
            :size="12"
            class="text-danger hover:text-danger size-7"
            :title="t('删除索引')"
            @click="removeIndex(index.id)"
          />
        </div>

        <div class="mt-2.5 grid gap-2 md:grid-cols-2">
          <label class="text-txt-4 mt-0.5 grid gap-1 text-[9.5px]">
            {{ t('索引备注') }}
            <AppInput
              :model-value="index.comment ?? ''"
              size="sm"
              @update:model-value="updateIndex(index.id, { comment: $event })"
          /></label>
          <label
            v-if="!mysql"
            class="text-txt-4 mt-0.5 grid gap-1 text-[9.5px]"
          >
            {{ t('条件（部分索引 WHERE）') }}
            <AppInput
              :model-value="index.predicate ?? ''"
              size="sm"
              monospace
              placeholder="deleted_at IS NULL"
              @update:model-value="
                updateIndex(index.id, { predicate: $event })
              "
          /></label>
        </div>

        <div
          v-if="index.columns.length"
          class="mt-3 grid gap-1"
        >
          <p class="text-txt-4 mt-0.5 grid gap-1 text-[9.5px]">{{ t('索引列（按顺序）') }}</p>
          <div
            v-for="(column, position) in index.columns"
            :key="column"
            class="border-line-soft bg-panel/50 flex h-8 items-center gap-1.5 rounded-md border px-1.5 text-[10px]"
          >
            <span
              class="text-accent bg-accent/15 grid size-4 shrink-0 place-items-center rounded-full font-mono text-[8px]"
              >{{ position + 1 }}</span
            >
            <AppInput
              v-if="index.columnOptions?.[column]?.expression"
              :model-value="column"
              variant="cell"
              monospace
              class="h-6!"
              :aria-label="t('索引表达式')"
              @update:model-value="renameExpression(index, position, $event)"
            />
            <span
              v-else
              :class="
                cn(
                  'text-txt-2 min-w-0 flex-1 truncate font-mono',
                  !columns.some(item => item.name === column) && 'text-danger'
                )
              "
              >{{ column }}</span
            >
            <label
              v-if="prefixAllowed(index, column)"
              class="text-txt-4 flex shrink-0 items-center gap-1"
            >
              {{ t('前缀') }}
              <AppInput
                :model-value="index.columnOptions?.[column]?.prefix ?? ''"
                size="sm"
                monospace
                class="h-6! w-14"
                placeholder="—"
                @update:model-value="
                  updateOptions(index, column, { prefix: $event.trim() })
                "
              />
            </label>
            <AppButton
              v-if="ordered(index)"
              variant="bare"
              :class="
                cn(
                  'border-line-soft text-txt-3 hover:text-txt h-6 shrink-0 rounded border px-1.5 font-mono text-[9px]',
                  index.columnOptions?.[column]?.descending &&
                    'border-accent/40 text-accent'
                )
              "
              :title="t('切换升序 / 降序')"
              @click="
                updateOptions(index, column, {
                  descending: !index.columnOptions?.[column]?.descending,
                })
              "
            >
              {{ index.columnOptions?.[column]?.descending ? 'DESC' : 'ASC' }}
            </AppButton>
            <IconButton
              icon="lucide:arrow-up"
              :size="11"
              class="size-6 shrink-0"
              :title="t('上移')"
              :disabled="position === 0"
              @click="moveColumn(index, position, -1)"
            />
            <IconButton
              icon="lucide:arrow-down"
              :size="11"
              class="size-6 shrink-0"
              :title="t('下移')"
              :disabled="position === index.columns.length - 1"
              @click="moveColumn(index, position, 1)"
            />
            <IconButton
              icon="lucide:x"
              :size="11"
              class="size-6 shrink-0"
              :title="t('移出索引')"
              @click="
                setColumns(
                  index,
                  index.columns.filter(item => item !== column)
                )
              "
            />
          </div>
        </div>

        <div class="mt-3">
          <p class="text-txt-4 mt-0.5 grid gap-1 text-[9.5px] mb-1.5">
            {{ t('索引字段（点击选择，选择顺序即索引顺序）') }}
          </p>
          <div class="flex min-h-7.25 flex-wrap gap-1.25">
            <AppButton
              v-for="column in columns"
              :key="column.id"
              variant="bare"
              class="designer-chip"
              :aria-pressed="index.columns.includes(column.name)"
              @click="toggleColumn(index, column.name)"
            >
              <AppIcon
                :name="
                  index.columns.includes(column.name)
                    ? 'lucide:check'
                    : 'lucide:plus'
                "
                :size="10"
              />{{ column.name || t('未命名字段') }}
              <span
                v-if="index.columns.includes(column.name)"
                class="bg-accent/15 grid h-3.5 min-w-3.5 place-items-center rounded-full text-[8px]"
                >{{ index.columns.indexOf(column.name) + 1 }}</span
              >
            </AppButton>
            <AppButton
              v-if="!mysql && ordered(index)"
              variant="bare"
              class="designer-chip"
              @click="addExpression(index)"
            >
              <AppIcon
                name="lucide:sigma"
                :size="10"
              />{{ t('添加表达式') }}
            </AppButton>
            <span
              v-if="!columns.length"
              class="text-txt-4 text-[10px]"
            >
              {{ t('请先添加字段') }}
            </span>
          </div>
        </div>
        <p
          v-if="indexErrors(index).length"
          class="text-danger mt-2 text-[10px]"
          role="alert"
        >
          {{ indexErrors(index)[0] }}
        </p>
      </article>
      <div
        v-if="!modelValue.length"
        class="text-txt-4 grid min-h-57.5 place-items-center content-center gap-1.75 text-center text-[11px]"
      >
        <AppIcon
          name="lucide:list-tree"
          :size="24"
        />
        <p>{{ t('尚未配置额外索引') }}</p>
        <span class="text-[9.5px]"> {{ t('主键和字段级唯一约束可直接在“字段”页配置。') }} </span>
      </div>
    </div>
  </section>
</template>
