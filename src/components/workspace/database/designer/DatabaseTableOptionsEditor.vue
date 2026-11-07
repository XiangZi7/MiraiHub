<script setup lang="ts">
import { computed, onMounted, reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import * as database from '@/api/database'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { DatabaseKind, DatabaseTableDetail } from '@/types/database'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type {
  TableDesignerColumn,
  TableDesignerPartition,
  TablePartitionMethod,
} from '@/types/database-designer'

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
    class="options-panel scroll-thin"
    :aria-label="t('表选项')"
  >
    <div class="option-card">
      <h3>{{ t('自增设置') }}</h3>
      <dl class="current-values">
        <div>
          <dt>{{ t('自增字段') }}</dt>
          <dd>
            {{
              incrementColumns.map(column => column.name).join(', ') || t('无')
            }}
          </dd>
        </div>
        <div v-if="editing">
          <dt>{{ t('当前自增计数器') }}</dt>
          <dd data-testid="current-auto-increment">{{ currentValue }}</dd>
        </div>
      </dl>
      <label class="option-field">
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
        class="options-hint"
      >
        {{ t('设置自增值需要且只能有一个自增字段') }}
      </p>
      <p
        v-else-if="serialColumn"
        class="options-hint"
      >
        {{ t('serial 序列请在查询中使用 ALTER SEQUENCE 修改') }}
      </p>
      <p
        v-else
        class="options-hint"
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
      class="option-card"
    >
      <h3>{{ t('存储与字符集') }}</h3>
      <p
        v-if="catalogError"
        class="options-hint"
      >
        {{ t('未能读取服务器可选项，可手动输入受支持的值。') }}
      </p>
      <div class="options-grid">
        <label
          v-if="catalogError"
          class="option-field"
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
          class="option-field"
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
          class="option-field"
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
      <p class="options-hint">
        {{
          t(
            '字符集与排序规则设置表的默认值，不转换已有字段；修改引擎或行格式可能重建表。'
          )
        }}
      </p>
    </div>
    <div
      v-if="databaseKind === 'mysql'"
      class="option-card"
    >
      <h3>{{ t('分区') }}</h3>
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
          v-else
          class="options-hint"
        >
          {{ t('当前表未分区') }}
        </p>
        <p class="options-hint">
          {{ t('已有表的分区仅供查看，调整分区请在查询中执行 ALTER TABLE … PARTITION。') }}
        </p>
      </template>
      <div
        v-else
        class="grid gap-3"
      >
        <div class="options-grid">
          <AppSelect
            :model-value="partition?.method ?? ''"
            compact
            :label="t('分区方式')"
            :options="partitionMethodOptions"
            @update:model-value="changePartitionMethod"
          />
          <label
            v-if="partition"
            class="option-field"
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
            class="option-field"
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
        <p class="options-hint">
          {{ t('分区表达式涉及的字段必须包含在主键和所有唯一索引中，且分区表不支持外键。') }}
        </p>
      </div>
    </div>
    <div class="option-card">
      <h3>{{ t('表备注') }}</h3>
      <AppInput
        v-model="comment"
        size="sm"
        :aria-label="t('表备注')"
        :placeholder="t('可选，用于说明表的用途')"
      />
    </div>
    <p class="options-hint">
      {{ t('修改后可在 SQL 预览中检查，点击保存修改后生效。') }}
    </p>
  </section>
</template>

<style scoped>
.options-panel {
  min-height: 0;
  overflow: auto;
  padding: 16px;
}
.option-card {
  max-width: 780px;
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid var(--color-line-soft);
  border-radius: 8px;
  background: var(--color-panel);
}
h3 {
  margin: 0 0 12px;
  color: var(--color-txt-2);
  font-size: 11px;
  font-weight: 600;
}
.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.option-field {
  display: grid;
  gap: 6px;
  font-size: 10px;
  color: var(--color-txt-3);
}
.current-values {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 32px;
  margin: 0 0 14px;
}
.current-values div {
  display: grid;
  gap: 5px;
}
dt {
  color: var(--color-txt-4);
  font-size: 10px;
}
dd {
  margin: 0;
  color: var(--color-txt);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.options-hint {
  margin: 10px 0 0;
  color: var(--color-txt-4);
  font-size: 10px;
  line-height: 1.7;
}
</style>
