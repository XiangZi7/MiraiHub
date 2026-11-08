<script setup lang="ts">
import { computed, onMounted, reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { DatabaseKind, DatabaseTableDetail } from '@/types/database'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type {
  TableDesignerColumn,
  TableDesignerPartition,
  TableDesignerPartitionChange,
  TablePartitionAction,
  TablePartitionMethod,
} from '@/types/database-designer'
import { partitionEditSupport } from '@/utils/database-ddl'

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  columns: TableDesignerColumn[]
  current: DatabaseTableDetail | null
  editing: boolean
}>()
const engine = defineModel<string>('engine', { required: true })
const charset = defineModel<string>('charset', { required: true })
const collation = defineModel<string>('collation', { required: true })
const rowFormat = defineModel<string>('rowFormat', { required: true })
const comment = defineModel<string>('comment', { required: true })
const autoIncrement = defineModel<string | null>('autoIncrement', {
  required: true,
})
const partition = defineModel<TableDesignerPartition | null>('partition', {
  default: null,
})
const partitionChanges = defineModel<TableDesignerPartitionChange[] | undefined>(
  'partitionChanges',
  { default: undefined }
)
const { t } = useI18n()

// 响应式状态
const state = reactive({
  // 服务器实际支持的存储引擎
  engines: [] as string[],
  // 排序规则与所属字符集
  collations: [] as { name: string; charset: string }[],
  // 可选项读取失败时保留手动输入
  catalogError: false,
})
const { catalogError } = toRefs(state)
const options = (values: string[]) =>
  [...new Set(values.filter(Boolean))].map(value => ({ value, label: value }))
const engineOptions = computed(() => options([engine.value, ...state.engines]))
const charsetOptions = computed(() =>
  options([charset.value, ...state.collations.map(item => item.charset)])
)
const collationOptions = computed(() => [
  { value: '', label: t('使用字符集默认排序规则') },
  ...options([
    collation.value,
    ...state.collations
      .filter(item => item.charset === charset.value)
      .map(item => item.name),
  ]),
])
const rowFormatOptions = computed(() => [
  ...(props.editing ? [] : [{ value: '', label: t('保持默认') }]),
  ...options([
    rowFormat.value,
    'DEFAULT',
    ...(engine.value.toLowerCase() === 'innodb'
      ? ['DYNAMIC', 'COMPACT', 'REDUNDANT', 'COMPRESSED']
      : engine.value.toLowerCase() === 'myisam'
        ? ['DYNAMIC', 'FIXED', 'COMPRESSED']
        : []),
  ]),
])
const incrementColumns = computed(() =>
  props.columns.filter(column => column.autoIncrement)
)
const serialColumn = computed(() =>
  props.current?.columns.some(
    column =>
      incrementColumns.value.some(item => item.name === column.name) &&
      /\bnextval\s*\(/iu.test(column.defaultValue ?? '')
  )
)
const incrementDisabled = computed(
  () => incrementColumns.value.length !== 1 || Boolean(serialColumn.value)
)
const incrementInput = computed({
  get: () => autoIncrement.value ?? '',
  set: (value: string) => {
    autoIncrement.value = value.trim() || null
  },
})
const currentValue = computed(
  () => props.current?.options?.autoIncrement ?? t('未读取')
)

const partitionMethodOptions = computed(() => [
  { value: '', label: t('不分区') },
  ...(['RANGE', 'LIST', 'HASH', 'KEY'] as const).map(value => ({
    value,
    label: value,
  })),
])

/** 切换分区方式：首次选择时创建分区草稿，选“不分区”时清空。 */
function changePartitionMethod(value: string): void {
  const method = value as TablePartitionMethod
  if (!method) {
    partition.value = null
    return
  }
  const base = partition.value ?? { method, expression: '', count: '4', items: [] }
  const items =
    (method === 'RANGE' || method === 'LIST') && !base.items.length
      ? [newPartitionItem(0)]
      : base.items
  partition.value = { ...base, method, items }
}

/** 合并修改分区草稿的表达式或分区数。 */
function patchPartition(patch: Partial<TableDesignerPartition>): void {
  if (partition.value) partition.value = { ...partition.value, ...patch }
}

/** 生成一个 RANGE / LIST 分区项。 */
function newPartitionItem(index: number) {
  return {
    id: `partition-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `p${index}`,
    value: '',
  }
}

/** 追加分区项。 */
function addPartitionItem(): void {
  if (!partition.value) return
  patchPartition({
    items: [
      ...partition.value.items,
      newPartitionItem(partition.value.items.length),
    ],
  })
}

/** 修改分区项的名称或取值。 */
function updatePartitionItem(
  id: string,
  patch: { name?: string; value?: string }
): void {
  if (!partition.value) return
  patchPartition({
    items: partition.value.items.map(item =>
      item.id === id ? { ...item, ...patch } : item
    ),
  })
}

/** 删除分区项。 */
function removePartitionItem(id: string): void {
  if (!partition.value) return
  patchPartition({
    items: partition.value.items.filter(item => item.id !== id),
  })
}

// 已有分区表可做的维护操作；不支持时 reason 说明原因
const partitionSupport = computed(() =>
  partitionEditSupport(props.databaseKind, props.current?.partition)
)
const partitionActionLabels: Record<TablePartitionAction, string> = {
  add: 'ADD PARTITION',
  drop: 'DROP PARTITION',
  truncate: 'TRUNCATE PARTITION',
  reorganize: 'REORGANIZE PARTITION',
}
const partitionActionOptions = computed(() =>
  partitionSupport.value.actions.map(value => ({
    value,
    label: partitionActionLabels[value],
  }))
)
const existingPartitionNames = computed(() =>
  (props.current?.partition?.partitions ?? []).map(item => item.name)
)

/** 生成已有表分区维护操作里的新分区项，名称顺延现有分区数避免重名。 */
function newChangeItem(offset: number) {
  return newPartitionItem(existingPartitionNames.value.length + offset)
}

/** 追加一项分区维护操作，默认取当前分区方式支持的第一个操作。 */
function addPartitionChange(): void {
  const action = partitionSupport.value.actions[0]
  if (!action) return
  partitionChanges.value = [
    ...(partitionChanges.value ?? []),
    {
      id: `partition-change-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,
      partitions: [],
      items: action === 'add' || action === 'reorganize' ? [newChangeItem(0)] : [],
    },
  ]
}

/** 合并修改某项分区维护操作。 */
function patchPartitionChange(
  id: string,
  patch: Partial<TableDesignerPartitionChange>
): void {
  partitionChanges.value = (partitionChanges.value ?? []).map(change =>
    change.id === id ? { ...change, ...patch } : change
  )
}

/** 删除一项分区维护操作。 */
function removePartitionChange(id: string): void {
  partitionChanges.value = (partitionChanges.value ?? []).filter(
    change => change.id !== id
  )
}

/** 切换操作类型：清掉新类型用不到的分区选择或新分区项。 */
function changePartitionAction(change: TableDesignerPartitionChange, value: string): void {
  const action = value as TablePartitionAction
  const needsItems = action === 'add' || action === 'reorganize'
  patchPartitionChange(change.id, {
    action,
    partitions: action === 'add' ? [] : change.partitions,
    items: needsItems
      ? change.items.length
        ? change.items
        : [newChangeItem(0)]
      : [],
  })
}

/** 勾选或取消操作作用的现有分区，保持与表中分区相同的顺序。 */
function togglePartitionTarget(change: TableDesignerPartitionChange, name: string): void {
  const selected = change.partitions.includes(name)
    ? change.partitions.filter(item => item !== name)
    : [...change.partitions, name]
  patchPartitionChange(change.id, {
    partitions: existingPartitionNames.value.filter(item => selected.includes(item)),
  })
}

/** 为 ADD / REORGANIZE 操作追加一个新分区项。 */
function addChangeItem(change: TableDesignerPartitionChange): void {
  patchPartitionChange(change.id, {
    items: [...change.items, newChangeItem(change.items.length)],
  })
}

/** 修改分区维护操作里新分区项的名称或取值。 */
function updateChangeItem(
  change: TableDesignerPartitionChange,
  id: string,
  patch: { name?: string; value?: string }
): void {
  patchPartitionChange(change.id, {
    items: change.items.map(item => (item.id === id ? { ...item, ...patch } : item)),
  })
}

/** 删除分区维护操作里的新分区项。 */
function removeChangeItem(change: TableDesignerPartitionChange, id: string): void {
  patchPartitionChange(change.id, {
    items: change.items.filter(item => item.id !== id),
  })
}

/** 字符集变化时，清掉不属于新字符集的排序规则。 */
function changeCharset(value: string): void {
  charset.value = value
  if (!collation.value.startsWith(`${value}_`)) collation.value = ''
}

onMounted(async () => {
  if (props.databaseKind !== 'mysql' || !props.sessionId) return
  try {
    const result = await database.tableOptionChoices(props.sessionId)
    state.engines = result.engines
    state.collations = result.collations.map(([name, charset]) => ({
      name,
      charset,
    }))
    state.catalogError = !state.engines.length || !state.collations.length
  } catch {
    state.catalogError = true
  }
})
</script>

<template>
  <section
    class="scroll-thin min-h-0 overflow-auto p-4"
    :aria-label="t('表选项')"
  >
    <div class="border-line-soft bg-panel mb-3 max-w-195 rounded-lg border p-3.5">
      <h3 class="text-txt-2 mb-3 text-[11px] font-semibold">{{ t('自增设置') }}</h3>
      <dl class="mb-3.5 flex flex-wrap gap-x-8 gap-y-3">
        <div class="grid gap-1.25">
          <dt class="text-txt-4 text-[10px]">{{ t('自增字段') }}</dt>
          <dd class="text-txt font-mono text-[12px] wrap-anywhere">
            {{
              incrementColumns.map(column => column.name).join(', ') || t('无')
            }}
          </dd>
        </div>
        <div
          v-if="editing"
          class="grid gap-1.25"
        >
          <dt class="text-txt-4 text-[10px]">{{ t('当前自增计数器') }}</dt>
          <dd
            class="text-txt font-mono text-[12px] wrap-anywhere"
            data-testid="current-auto-increment"
          >{{ currentValue }}</dd>
        </div>
      </dl>
      <label class="text-txt-3 grid gap-1.5 text-[10px]">
        <span>{{
          databaseKind === 'mysql'
            ? t('自增值（AUTO_INCREMENT）')
            : t('自增值（RESTART WITH）')
        }}</span>
        <AppInput
          v-model="incrementInput"
          size="sm"
          monospace
          inputmode="numeric"
          :disabled="incrementDisabled"
          :placeholder="t('留空表示不指定')"
          :aria-label="t('自增值')"
        />
      </label>
      <p
        v-if="incrementColumns.length !== 1"
        class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]"
      >
        {{ t('设置自增值需要且只能有一个自增字段') }}
      </p>
      <p
        v-else-if="serialColumn"
        class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]"
      >
        {{ t('serial 序列请在查询中使用 ALTER SEQUENCE 修改') }}
      </p>
      <p
        v-else
        class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]"
      >
        {{
          databaseKind === 'mysql'
            ? t(
                '这是下一次分配的自增计数器，不是最大主键；服务器会根据现有数据和自增步长决定实际值。'
              )
            : t(
                'RESTART WITH 设置 identity 列的下次值；当前序列值请在查询中查看。'
              )
        }}
      </p>
    </div>
    <div
      v-if="databaseKind === 'mysql'"
      class="border-line-soft bg-panel mb-3 max-w-195 rounded-lg border p-3.5"
    >
      <h3 class="text-txt-2 mb-3 text-[11px] font-semibold">{{ t('存储与字符集') }}</h3>
      <p
        v-if="catalogError"
        class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]"
      >
        {{ t('未能读取服务器可选项，可手动输入受支持的值。') }}
      </p>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <label
          v-if="catalogError"
          class="text-txt-3 grid gap-1.5 text-[10px]"
          ><span>{{ t('存储引擎') }}</span
          ><AppInput
            v-model="engine"
            size="sm"
            :aria-label="t('存储引擎')"
        /></label>
        <AppSelect
          v-else
          v-model="engine"
          compact
          :label="t('存储引擎')"
          :options="engineOptions"
        />
        <label
          v-if="catalogError"
          class="text-txt-3 grid gap-1.5 text-[10px]"
          ><span>{{ t('字符集') }}</span
          ><AppInput
            :model-value="charset"
            size="sm"
            :aria-label="t('字符集')"
            @update:model-value="changeCharset"
        /></label>
        <AppSelect
          v-else
          :model-value="charset"
          compact
          searchable
          :label="t('字符集')"
          :options="charsetOptions"
          @update:model-value="changeCharset"
        />
        <label
          v-if="catalogError"
          class="text-txt-3 grid gap-1.5 text-[10px]"
          ><span>{{ t('排序规则') }}</span
          ><AppInput
            v-model="collation"
            size="sm"
            :aria-label="t('排序规则')"
        /></label>
        <AppSelect
          v-else
          v-model="collation"
          compact
          searchable
          :label="t('排序规则')"
          :options="collationOptions"
        />
        <AppSelect
          v-model="rowFormat"
          compact
          :label="t('行格式')"
          :options="rowFormatOptions"
        />
      </div>
      <p class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]">
        {{
          t(
            '字符集与排序规则设置表的默认值，不转换已有字段；修改引擎或行格式可能重建表。'
          )
        }}
      </p>
    </div>
    <div
      v-if="databaseKind === 'mysql'"
      class="border-line-soft bg-panel mb-3 max-w-195 rounded-lg border p-3.5"
    >
      <h3 class="text-txt-2 mb-3 text-[11px] font-semibold">{{ t('分区') }}</h3>
      <template v-if="editing">
        <div
          v-if="current?.partition?.method"
          class="grid gap-2"
        >
          <p class="text-txt-3 font-mono text-[11px]">
            PARTITION BY {{ current.partition.method }} ({{
              current.partition.expression
            }})
          </p>
          <table class="text-txt-2 w-full max-w-130 text-left text-[10.5px]">
            <thead class="text-txt-4">
              <tr>
                <th class="py-1 font-normal">{{ t('分区名') }}</th>
                <th class="py-1 font-normal">{{ t('分区值') }}</th>
                <th class="py-1 font-normal">{{ t('行数') }}</th>
              </tr>
            </thead>
            <tbody class="font-mono">
              <tr
                v-for="item in current.partition.partitions"
                :key="item.name"
                class="border-line-soft border-t"
              >
                <td class="py-1">{{ item.name }}</td>
                <td class="py-1">{{ item.description || '-' }}</td>
                <td class="py-1">{{ item.rows ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p
          v-else-if="!partitionSupport.reason"
          class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]"
        >
          {{ t('当前表未分区') }}
        </p>
        <p
          v-if="partitionSupport.reason"
          class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]"
        >
          {{ partitionSupport.reason }}
        </p>
        <div
          v-if="partitionSupport.actions.length"
          class="mt-3 grid gap-2"
        >
          <div
            v-for="change in partitionChanges ?? []"
            :key="change.id"
            class="border-line-soft grid gap-2 rounded-md border p-2.5"
          >
            <div class="grid grid-cols-[minmax(0,240px)_1fr_28px] items-center gap-2">
              <AppSelect
                :model-value="change.action"
                compact
                hide-label
                :label="t('分区操作')"
                :options="partitionActionOptions"
                @update:model-value="changePartitionAction(change, $event)"
              />
              <span />
              <IconButton
                icon="lucide:trash-2"
                :size="12"
                class="text-danger hover:text-danger size-7"
                :title="t('删除分区操作')"
                @click="removePartitionChange(change.id)"
              />
            </div>
            <div
              v-if="change.action !== 'add'"
              class="flex flex-wrap gap-1.5"
              role="group"
              :aria-label="t('作用的分区')"
            >
              <AppButton
                v-for="name in existingPartitionNames"
                :key="name"
                variant="bare"
                class="designer-chip"
                :aria-pressed="change.partitions.includes(name)"
                @click="togglePartitionTarget(change, name)"
              >
                <AppIcon
                  :name="change.partitions.includes(name) ? 'lucide:check' : 'lucide:plus'"
                  :size="10"
                />{{ name }}
              </AppButton>
            </div>
            <div
              v-if="change.action === 'add' || change.action === 'reorganize'"
              class="grid gap-1.5"
            >
              <span class="text-txt-4 text-[10px]">{{
                change.action === 'add' ? t('新增的分区') : t('重组为以下分区')
              }}</span>
              <div
                v-for="item in change.items"
                :key="item.id"
                class="grid grid-cols-[140px_1fr_28px] items-center gap-2"
              >
                <AppInput
                  :model-value="item.name"
                  size="sm"
                  monospace
                  :aria-label="t('分区名')"
                  @update:model-value="updateChangeItem(change, item.id, { name: $event })"
                />
                <AppInput
                  :model-value="item.value"
                  size="sm"
                  monospace
                  :aria-label="t('分区值')"
                  :placeholder="
                    partitionSupport.family === 'RANGE' ? '2025 / MAXVALUE' : '1, 2, 3'
                  "
                  @update:model-value="updateChangeItem(change, item.id, { value: $event })"
                />
                <IconButton
                  icon="lucide:trash-2"
                  :size="12"
                  class="text-danger hover:text-danger size-7"
                  :title="t('删除分区')"
                  @click="removeChangeItem(change, item.id)"
                />
              </div>
              <button
                type="button"
                class="text-blue hover:bg-blue/10 flex w-fit items-center gap-1 rounded px-1.5 py-1 text-[10px] motion-safe:transition-colors"
                @click="addChangeItem(change)"
              >
                <AppIcon
                  name="lucide:plus"
                  :size="11"
                />
                {{ t('添加分区') }}
              </button>
            </div>
          </div>
          <button
            type="button"
            class="text-blue hover:bg-blue/10 flex w-fit items-center gap-1 rounded px-1.5 py-1 text-[10px] motion-safe:transition-colors"
            @click="addPartitionChange"
          >
            <AppIcon
              name="lucide:plus"
              :size="11"
            />
            {{ t('添加分区操作') }}
          </button>
          <p class="text-txt-4 text-[10px] leading-[1.7]">
            {{
              t(
                '每项操作生成一条独立的 ALTER TABLE 语句；MySQL 分区操作不支持事务，失败前已执行的语句不会回滚。删除或清空分区会丢弃其中的数据。'
              )
            }}
          </p>
        </div>
      </template>
      <div
        v-else
        class="grid gap-3"
      >
        <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <AppSelect
            :model-value="partition?.method ?? ''"
            compact
            :label="t('分区方式')"
            :options="partitionMethodOptions"
            @update:model-value="changePartitionMethod"
          />
          <label
            v-if="partition"
            class="text-txt-3 grid gap-1.5 text-[10px]"
            ><span>{{
              partition.method === 'KEY' ? t('分区字段') : t('分区表达式')
            }}</span
            ><AppInput
              :model-value="partition.expression"
              size="sm"
              monospace
              :placeholder="partition.method === 'KEY' ? 'id' : 'YEAR(created_at)'"
              @update:model-value="patchPartition({ expression: $event })"
          /></label>
          <label
            v-if="partition && (partition.method === 'HASH' || partition.method === 'KEY')"
            class="text-txt-3 grid gap-1.5 text-[10px]"
            ><span>{{ t('分区数') }}</span
            ><AppInput
              :model-value="partition.count"
              size="sm"
              monospace
              inputmode="numeric"
              @update:model-value="patchPartition({ count: $event })"
          /></label>
        </div>
        <div
          v-if="partition && (partition.method === 'RANGE' || partition.method === 'LIST')"
          class="grid gap-1.5"
        >
          <div
            v-for="item in partition.items"
            :key="item.id"
            class="grid grid-cols-[140px_1fr_28px] items-center gap-2"
          >
            <AppInput
              :model-value="item.name"
              size="sm"
              monospace
              :aria-label="t('分区名')"
              @update:model-value="updatePartitionItem(item.id, { name: $event })"
            />
            <AppInput
              :model-value="item.value"
              size="sm"
              monospace
              :aria-label="t('分区值')"
              :placeholder="partition.method === 'RANGE' ? '2025 / MAXVALUE' : '1, 2, 3'"
              @update:model-value="updatePartitionItem(item.id, { value: $event })"
            />
            <IconButton
              icon="lucide:trash-2"
              :size="12"
              class="text-danger hover:text-danger size-7"
              :title="t('删除分区')"
              @click="removePartitionItem(item.id)"
            />
          </div>
          <button
            type="button"
            class="text-blue hover:bg-blue/10 flex w-fit items-center gap-1 rounded px-1.5 py-1 text-[10px] motion-safe:transition-colors"
            @click="addPartitionItem"
          >
            <AppIcon
              name="lucide:plus"
              :size="11"
            />
            {{ t('添加分区') }}
          </button>
        </div>
        <p class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]">
          {{ t('分区表达式涉及的字段必须包含在主键和所有唯一索引中，且分区表不支持外键。') }}
        </p>
      </div>
    </div>
    <div class="border-line-soft bg-panel mb-3 max-w-195 rounded-lg border p-3.5">
      <h3 class="text-txt-2 mb-3 text-[11px] font-semibold">{{ t('表备注') }}</h3>
      <AppInput
        v-model="comment"
        size="sm"
        :aria-label="t('表备注')"
        :placeholder="t('可选，用于说明表的用途')"
      />
    </div>
    <p class="text-txt-4 mt-2.5 text-[10px] leading-[1.7]">
      {{ t('修改后可在 SQL 预览中检查，点击保存修改后生效。') }}
    </p>
  </section>
</template>
