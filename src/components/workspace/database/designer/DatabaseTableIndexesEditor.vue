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
  <section class="designer-section">
    <div class="index-list scroll-thin">
      <article
        v-for="index in modelValue"
        :key="index.id"
        :class="
          cn(
            'index-card',
            indexErrors(index).length && 'border-danger/50!'
          )
        "
      >
        <div class="index-card-heading">
          <span class="index-icon"
            ><AppIcon
              name="lucide:list-tree"
              :size="14"
          /></span>
          <label class="field-label">
            {{ t('索引名') }}
            <AppInput
              :model-value="index.name"
              monospace
              @update:model-value="updateIndex(index.id, { name: $event })"
          /></label>
          <div class="field-label">
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
          <div class="field-label">
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
          <label class="field-label">
            {{ t('索引备注') }}
            <AppInput
              :model-value="index.comment ?? ''"
              size="sm"
              @update:model-value="updateIndex(index.id, { comment: $event })"
          /></label>
          <label
            v-if="!mysql"
            class="field-label"
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
          <p class="field-label">{{ t('索引列（按顺序）') }}</p>
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
          <p class="field-label mb-1.5">
            {{ t('索引字段（点击选择，选择顺序即索引顺序）') }}
          </p>
          <div class="column-picker">
            <AppButton
              v-for="column in columns"
              :key="column.id"
              variant="bare"
              :class="[
                'column-chip',
                index.columns.includes(column.name) && 'column-chip-active',
              ]"
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
                class="order-badge"
                >{{ index.columns.indexOf(column.name) + 1 }}</span
              >
            </AppButton>
            <AppButton
              v-if="!mysql && ordered(index)"
              variant="bare"
              class="column-chip"
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
        class="empty-state"
      >
        <AppIcon
          name="lucide:list-tree"
          :size="24"
        />
        <p>{{ t('尚未配置额外索引') }}</p>
        <span> {{ t('主键和字段级唯一约束可直接在“字段”页配置。') }} </span>
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
.field-label {
  margin-top: 2px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.index-list {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.index-card {
  margin-bottom: 9px;
  border: 1px solid var(--color-line-soft);
  border-radius: 9px;
  background:
    linear-gradient(145deg, var(--glass-highlight), transparent),
    color-mix(in oklch, var(--color-card) 72%, transparent);
  padding: 11px;
  box-shadow: inset 0 1px var(--glass-highlight);
}
.index-card-heading {
  display: grid;
  grid-template-columns: 32px minmax(150px, 1fr) 130px 105px 28px;
  align-items: end;
  gap: 8px;
}
.index-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid
    color-mix(in oklch, var(--color-violet) 28%, var(--color-line));
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-violet) 9%, transparent);
  color: var(--color-violet);
}
.field-label {
  display: grid;
  gap: 4px;
}
.column-picker {
  display: flex;
  min-height: 29px;
  flex-wrap: wrap;
  gap: 5px;
}
.column-chip {
  display: flex;
  height: 27px;
  cursor: pointer;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--color-line-soft);
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-panel) 58%, transparent);
  padding: 0 7px;
  color: var(--color-txt-3);
  font-family: var(--font-mono);
  font-size: 9.5px;
  outline: none;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease;
}
.column-chip:hover,
.column-chip:focus-visible {
  border-color: var(--color-line-strong);
  color: var(--color-txt);
}
.column-chip-active {
  border-color: color-mix(in oklch, var(--color-accent) 38%, transparent);
  background: color-mix(in oklch, var(--color-accent) 9%, transparent);
  color: var(--color-accent);
}
.order-badge {
  display: grid;
  min-width: 14px;
  height: 14px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-accent) 15%, transparent);
  font-size: 8px;
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
  .index-card-heading {
    grid-template-columns: 32px 1fr 110px 28px;
  }
  .index-card-heading > :nth-child(4) {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .column-chip {
    transition: none;
  }
}
</style>
