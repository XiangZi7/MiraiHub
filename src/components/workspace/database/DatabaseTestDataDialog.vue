<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, onMounted, reactive, shallowRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import * as agent from '@/api/agent'
import * as database from '@/api/database'
import { cancelTransfer } from '@/api/ssh'
import { toast } from '@/composables/useToast'
import { withDatabaseExportTransfer } from '@/services/database-export'
import { useTransfersStore } from '@/stores/transfers'
import type {
  CellValue,
  DatabaseKind,
  DatabaseObject,
  DatabaseTableDetail,
} from '@/types/database'
import {
  defaultTestDataRules,
  generateTestRows,
  parseTestDataRules,
  TEST_DATA_FAKERS,
  testDataBlocker,
  testDataSchemaPayload,
  type TestDataFaker,
  type TestDataPools,
  type TestDataRule,
  type TestDataRuleKind,
} from '@/utils/database-test-data'

const MAX_ROWS = 100_000
const PREVIEW_ROWS = 20
const POOL_ROWS = 1000

const { t, locale } = useI18n()

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  /** 对象所属的库；MySQL 的 schema 就是库名。 */
  databaseName: string
  connectionName?: string
  object: DatabaseObject
  readOnly?: boolean
  /** AI 规则走当前目标，保持与对话相同的会话绑定校验。 */
  target: { kind: 'database'; sessionId: string; database: string }
}>()

const emit = defineEmits<{
  close: []
  finished: []
}>()

const transfers = useTransfersStore()

const state = reactive({
  count: '1000',
  loading: true,
  aiLoading: false,
  generating: false,
  inserting: false,
  taskId: '',
  rules: [] as TestDataRule[],
  error: '',
})
const table = shallowRef<DatabaseTableDetail | null>(null)
const pools = shallowRef<TestDataPools>({})
const preview = shallowRef<CellValue[][]>([])
// 换种子才换数据：预览与写入用同一份随机序列
const seed = shallowRef(Math.floor(Math.random() * 2 ** 32))
const objects = shallowRef(new Map<string, string>())
let disposed = false
let aiToken = 0
let previewToken = 0

const chinese = computed(() => locale.value.startsWith('zh'))
const rowCount = computed(() => {
  const value = Number(state.count)
  return Number.isInteger(value) ? value : 0
})
const countValid = computed(
  () => rowCount.value >= 1 && rowCount.value <= MAX_ROWS
)
const blocker = computed(() =>
  table.value ? testDataBlocker(table.value, state.rules, pools.value) : null
)
const previewColumns = computed(
  () => preview.value[0]?.map(cell => cell.column) ?? []
)
const task = computed(() =>
  transfers.tasks.find(item => item.id === state.taskId)
)
const processed = computed(() => task.value?.processedRows ?? 0)
const percent = computed(() =>
  rowCount.value
    ? Math.min(100, Math.round((processed.value / rowCount.value) * 100))
    : 0
)
const busy = computed(
  () => state.loading || state.aiLoading || state.inserting
)

const kindOptions = computed(() => {
  const labels: Record<TestDataRuleKind, string> = {
    default: t('数据库默认值'),
    sequence: t('递增序列'),
    integer: t('随机整数'),
    decimal: t('随机小数'),
    boolean: t('布尔'),
    enum: t('枚举'),
    datetime: t('日期时间'),
    faker: t('仿真文本'),
    foreignKey: t('引用其他表'),
  }
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
})
const fakerOptions = computed(() => {
  const labels: Record<TestDataFaker, string> = {
    fullName: t('姓名'),
    firstName: t('名字'),
    username: t('用户名'),
    email: t('邮箱'),
    phone: t('电话'),
    company: t('公司'),
    city: t('城市'),
    address: t('地址'),
    url: t('网址'),
    ipv4: 'IPv4',
    uuid: 'UUID',
    word: t('词语'),
    sentence: t('句子'),
    paragraph: t('段落'),
    json: 'JSON',
  }
  return TEST_DATA_FAKERS.map(value => ({ value, label: labels[value] }))
})

onMounted(async () => {
  try {
    const [detail, list] = await Promise.all([
      database.tableDetail(
        props.sessionId,
        props.object.schema,
        props.object.name,
        'table'
      ),
      database.listObjects(props.sessionId),
    ])
    if (disposed) return
    table.value = detail
    objects.value = new Map(
      list
        .filter(item => item.kind === 'table' && item.name !== detail.name)
        .map(item => [item.name, item.schema])
    )
    await applyRules(defaultTestDataRules(detail))
  } catch (error) {
    state.error = database.errorMessage(error)
  } finally {
    state.loading = false
  }
})

onBeforeUnmount(() => {
  disposed = true
  aiToken += 1
  previewToken += 1
})

/** 取被引用表的现有值作为外键值池；这些值只留在本地，不发送给 AI。 */
async function loadPools(rules: TestDataRule[]): Promise<TestDataRule[]> {
  const next: TestDataPools = {}
  const groups = new Map<string, TestDataRule[]>()
  for (const rule of rules)
    if (rule.kind === 'foreignKey')
      groups.set(rule.pool!, [...(groups.get(rule.pool!) ?? []), rule])
  const invalid = new Set<string>()
  for (const [pool, group] of groups) {
    const first = group[0]!
    const page = await database.fetchRows(props.sessionId, {
      schema: first.referenceSchema!,
      table: first.referenceTable!,
      limit: POOL_ROWS,
    })
    const names = page.columns.map(column => column.name)
    const positions = new Map(
      group.map(rule => [
        rule.poolIndex ?? 0,
        names.indexOf(rule.referenceColumn!),
      ])
    )
    if ([...positions.values()].includes(-1)) {
      invalid.add(pool)
      continue
    }
    const width = Math.max(...positions.keys()) + 1
    next[pool] = page.rows.map(row =>
      Array.from({ length: width }, (_, index) =>
        positions.has(index) ? (row[positions.get(index)!] ?? null) : null
      )
    )
  }
  pools.value = next
  if (!invalid.size) return rules
  // AI 猜的隐式引用可能指向不存在的列，退回本地推断
  const fallback = defaultTestDataRules(table.value!)
  return rules.map(rule =>
    rule.pool && invalid.has(rule.pool)
      ? fallback.find(item => item.column === rule.column)!
      : rule
  )
}

/** 自增以外的整数主键续接现有最大值，避免和已有行冲突。 */
async function alignSequences(rules: TestDataRule[]): Promise<void> {
  for (const rule of rules) {
    if (
      rule.kind !== 'sequence' ||
      !table.value?.primaryKey.includes(rule.column)
    )
      continue
    const page = await database.fetchRows(props.sessionId, {
      schema: props.object.schema,
      table: props.object.name,
      limit: 1,
      sort: { column: rule.column, descending: true },
    })
    const position = page.columns.findIndex(
      column => column.name === rule.column
    )
    const top = Number(page.rows[0]?.[position] ?? 0)
    if (Number.isSafeInteger(top) && top >= (rule.start ?? 1))
      rule.start = top + 1
  }
}

async function applyRules(rules: TestDataRule[]): Promise<void> {
  const resolved = await loadPools(rules)
  await alignSequences(resolved)
  state.rules = resolved
  await refreshPreview()
}

/** 前 20 行就是实际写入的前 20 行。 */
async function refreshPreview(): Promise<void> {
  if (!table.value) return
  const token = ++previewToken
  state.error = ''
  if (blocker.value) {
    preview.value = []
    return
  }
  try {
    const rows = await generateTestRows({
      table: table.value,
      rules: state.rules,
      count: Math.min(PREVIEW_ROWS, Math.max(rowCount.value, 1)),
      seed: seed.value,
      kind: props.databaseKind,
      chinese: chinese.value,
      pools: pools.value,
    })
    if (token === previewToken) preview.value = rows
  } catch (error) {
    if (token === previewToken) {
      preview.value = []
      state.error = database.errorMessage(error)
    }
  }
}

function reshuffle(): void {
  seed.value = Math.floor(Math.random() * 2 ** 32)
  void refreshPreview()
}

async function generateRules(): Promise<void> {
  if (!table.value || state.aiLoading) return
  const token = ++aiToken
  state.aiLoading = true
  state.error = ''
  try {
    const text = await agent.testDataRules(
      props.target,
      testDataSchemaPayload(table.value, [...objects.value.keys()]),
      chinese.value ? 'Simplified Chinese' : 'English'
    )
    if (token !== aiToken) return
    await applyRules(parseTestDataRules(text, table.value, objects.value))
  } catch (error) {
    if (token === aiToken) state.error = database.errorMessage(error)
  } finally {
    if (token === aiToken) state.aiLoading = false
  }
}

/** 切换类型时重建该列规则，保留空值比例；外键类型不可手动选到无值池的列。 */
function setKind(rule: TestDataRule, kind: TestDataRuleKind): void {
  const now = new Date()
  const from = new Date(now)
  from.setFullYear(now.getFullYear() - 1)
  const preset: Partial<TestDataRule> = {
    sequence: { start: 1, step: 1 },
    integer: { min: 0, max: 1000 },
    decimal: { min: 0, max: 1000, scale: 2 },
    boolean: { trueRate: 0.5 },
    enum: { values: [] },
    datetime: { from: from.toISOString(), to: now.toISOString() },
    faker: { faker: 'word' as const },
    default: {},
    foreignKey: {},
  }[kind]
  Object.assign(rule, {
    start: undefined,
    step: undefined,
    min: undefined,
    max: undefined,
    scale: undefined,
    trueRate: undefined,
    values: undefined,
    weights: undefined,
    from: undefined,
    to: undefined,
    faker: undefined,
    ...preset,
    kind,
  })
  void refreshPreview()
}

const kindsFor = (rule: TestDataRule) =>
  kindOptions.value.filter(
    option => option.value !== 'foreignKey' || rule.kind === 'foreignKey'
  )

function setNumber(
  rule: TestDataRule,
  key: 'min' | 'max' | 'start' | 'step',
  value: string
): void {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed)) return
  rule[key] = parsed
  void refreshPreview()
}

function setValues(rule: TestDataRule, value: string): void {
  rule.values = value
    .split(/[,，\n]/u)
    .map(item => item.trim())
    .filter(Boolean)
  rule.weights = undefined
  void refreshPreview()
}

function setNullRate(rule: TestDataRule, value: string): void {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return
  rule.nullRate = Math.min(1, Math.max(0, parsed / 100))
  void refreshPreview()
}

const nullable = (rule: TestDataRule): boolean =>
  table.value?.columns.find(column => column.name === rule.column)?.nullable ??
  false

const columnType = (rule: TestDataRule): string =>
  table.value?.columns.find(column => column.name === rule.column)?.dataType ??
  ''

/** 走传输中心的事务导入：单个事务内逐批写入，取消或失败整体回滚。 */
async function insert(): Promise<void> {
  if (!table.value || !countValid.value || blocker.value || busy.value) return
  state.generating = true
  state.error = ''
  try {
    const rows = await generateTestRows({
      table: table.value,
      rules: state.rules,
      count: rowCount.value,
      seed: seed.value,
      kind: props.databaseKind,
      chinese: chinese.value,
      pools: pools.value,
    })
    if (disposed) return
    state.generating = false
    state.inserting = true
    let rowsAffected: number | null = null
    await transfers.exportFile({
      kind: 'database-import',
      onQueued: id => {
        state.taskId = id
      },
      fileName: t('测试数据 · {table}', { table: props.object.name }),
      source: t('本地生成'),
      target: `${props.object.schema}.${props.object.name}`,
      connectionName: props.connectionName || props.databaseName,
      run: context =>
        withDatabaseExportTransfer(context, async () => {
          state.taskId = context.taskId
          // 独立会话写入，主会话的查询和当前库不受影响
          const owned = await database.forkSession(
            props.sessionId,
            props.databaseName
          )
          context.bindCancel(async () => {
            await Promise.all([
              cancelTransfer(context.taskId),
              database.cancelQuery(owned.sessionId),
            ])
          })
          try {
            context.signal.throwIfAborted()
            context.progress({ phase: 'writing', processedRows: 0 })
            const result = await database.importRows(
              owned.sessionId,
              [
                {
                  schema: props.object.schema,
                  table: props.object.name,
                  rows,
                },
              ],
              context.taskId
            )
            rowsAffected = result.rowsAffected
            context.progress({ processedRows: result.rowsAffected })
            return props.object.name
          } finally {
            await database.disconnect(owned.sessionId)
          }
        }),
    })
    if (rowsAffected === null) {
      if (!disposed)
        state.error = task.value?.error || t('已取消，事务已回滚')
      return
    }
    toast.success(t('已写入 {count} 行测试数据', { count: rowsAffected }))
    emit('finished')
    emit('close')
  } catch (error) {
    if (!disposed) state.error = database.errorMessage(error)
  } finally {
    state.generating = false
    state.inserting = false
  }
}

function cancelInsert(): void {
  if (state.taskId) void transfers.cancel(state.taskId)
}
</script>

<template>
  <AppDialog
    wide
    :title="t('生成测试数据 · {table}', { table: object.name })"
    :description="
      t('AI 只读取表结构并给出生成规则，行数据在本地生成，不会发送给模型。')
    "
    @close="emit('close')"
  >
    <AppSkeleton
      v-if="state.loading"
      :rows="6"
    />
    <template v-else-if="table">
      <div class="flex items-end gap-2">
        <label class="flex w-28 flex-col gap-1">
          <span class="text-txt-3 text-[11px]">{{ t('生成行数') }}</span>
          <AppInput
            v-model="state.count"
            size="sm"
            monospace
            inputmode="numeric"
            :disabled="state.inserting"
            :aria-invalid="!countValid"
          />
        </label>
        <span class="flex-1" />
        <AppButton
          size="sm"
          :disabled="busy"
          @click="reshuffle"
        >
          <AppIcon
            name="lucide:dices"
            :size="12"
          />
          {{ t('换一批') }}
        </AppButton>
        <AppButton
          size="sm"
          :disabled="busy"
          @click="generateRules"
        >
          <AppIcon
            :name="state.aiLoading ? 'lucide:loader-2' : 'lucide:sparkles'"
            :size="12"
            :class="state.aiLoading && 'motion-safe:animate-spin'"
          />
          {{ state.aiLoading ? t('AI 分析中…') : t('AI 生成规则') }}
        </AppButton>
      </div>

      <p
        v-if="!countValid"
        class="text-danger mt-1 text-[11px]"
      >
        {{ t('行数需在 1 到 {max} 之间', { max: MAX_ROWS }) }}
      </p>

      <ul class="mt-3 flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
        <li
          v-for="rule in state.rules"
          :key="rule.column"
          class="flex items-center gap-2"
        >
          <span class="w-32 min-w-0 shrink-0">
            <span
              class="text-txt block truncate font-mono text-[11px]"
              :title="rule.column"
              >{{ rule.column }}</span
            >
            <span
              class="text-txt-4 block truncate font-mono text-[10px]"
              :title="columnType(rule)"
              >{{ columnType(rule) }}</span
            >
          </span>
          <span class="w-28 shrink-0">
            <AppSelect
              icon="lucide:wand-sparkles"
              :model-value="rule.kind"
              :label="t('生成方式')"
              :options="kindsFor(rule)"
              hide-label
              compact
              :disabled="state.inserting"
              @update:model-value="setKind(rule, $event as TestDataRuleKind)"
            />
          </span>
          <span class="flex min-w-0 flex-1 items-center gap-1">
            <template v-if="rule.kind === 'integer' || rule.kind === 'decimal'">
              <AppInput
                :model-value="String(rule.min ?? 0)"
                size="sm"
                monospace
                :aria-label="t('最小值')"
                @update:model-value="setNumber(rule, 'min', $event)"
              />
              <span class="text-txt-4 text-[11px]">~</span>
              <AppInput
                :model-value="String(rule.max ?? 0)"
                size="sm"
                monospace
                :aria-label="t('最大值')"
                @update:model-value="setNumber(rule, 'max', $event)"
              />
            </template>
            <template v-else-if="rule.kind === 'sequence'">
              <AppInput
                :model-value="String(rule.start ?? 1)"
                size="sm"
                monospace
                :aria-label="t('起始值')"
                @update:model-value="setNumber(rule, 'start', $event)"
              />
              <AppInput
                :model-value="String(rule.step ?? 1)"
                size="sm"
                monospace
                :aria-label="t('步长')"
                @update:model-value="setNumber(rule, 'step', $event)"
              />
            </template>
            <AppInput
              v-else-if="rule.kind === 'enum'"
              :model-value="(rule.values ?? []).join(', ')"
              size="sm"
              :placeholder="t('用逗号分隔')"
              :aria-label="t('枚举值')"
              @update:model-value="setValues(rule, $event)"
            />
            <AppSelect
              icon="lucide:type"
              v-else-if="rule.kind === 'faker'"
              :model-value="rule.faker ?? 'word'"
              :label="t('文本类型')"
              :options="fakerOptions"
              hide-label
              compact
              @update:model-value="
                rule.faker = $event as TestDataFaker;
                refreshPreview()
              "
            />
            <span
              v-else-if="rule.kind === 'foreignKey'"
              class="text-txt-3 truncate font-mono text-[11px]"
              >→ {{ rule.referenceTable }}.{{ rule.referenceColumn }}
              <template v-if="rule.pool">
                ({{ pools[rule.pool]?.length ?? 0 }})
              </template>
            </span>
            <span
              v-else-if="rule.kind === 'datetime'"
              class="text-txt-3 truncate font-mono text-[11px]"
              >{{ rule.from?.slice(0, 10) }} ~ {{ rule.to?.slice(0, 10) }}</span
            >
          </span>
          <span class="w-14 shrink-0">
            <AppInput
              v-if="nullable(rule) && rule.kind !== 'default'"
              :model-value="String(Math.round(rule.nullRate * 100))"
              size="sm"
              monospace
              :title="t('空值比例（%）')"
              :aria-label="t('空值比例（%）')"
              @update:model-value="setNullRate(rule, $event)"
            />
          </span>
        </li>
      </ul>

      <p
        v-if="blocker || state.error"
        class="text-danger mt-2 text-[11px] break-all"
        role="alert"
      >
        {{ blocker || state.error }}
      </p>

      <div
        v-if="preview.length"
        class="mt-3"
      >
        <div class="text-txt-3 mb-1 text-[11px]">
          {{ t('预览前 {count} 行', { count: preview.length }) }}
        </div>
        <div class="border-line-soft max-h-44 overflow-auto rounded-md border">
          <table class="w-full text-left font-mono text-[10.5px]">
            <thead class="bg-panel text-txt-3 sticky top-0">
              <tr>
                <th
                  v-for="column in previewColumns"
                  :key="column"
                  class="px-2 py-1 font-medium whitespace-nowrap"
                >
                  {{ column }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in preview"
                :key="index"
                class="border-line-soft border-t"
              >
                <td
                  v-for="cell in row"
                  :key="cell.column"
                  class="text-txt-2 max-w-48 truncate px-2 py-1 whitespace-nowrap"
                >
                  <span
                    v-if="cell.value === null"
                    class="text-txt-4 italic"
                    >NULL</span
                  >
                  <template v-else>{{ cell.value }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div
        v-if="state.inserting"
        class="mt-3"
      >
        <div class="text-txt-3 mb-1 flex text-[11px] tabular-nums">
          <span>{{ t('正在事务中写入…') }}</span>
          <span class="flex-1" />
          <span>{{ processed }} / {{ rowCount }}</span>
        </div>
        <div
          class="bg-line-soft h-1 overflow-hidden rounded-full"
          role="progressbar"
          :aria-valuenow="percent"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="bg-accent h-full rounded-full motion-safe:transition-[width] motion-safe:duration-200"
            :style="{ width: `${percent}%` }"
          />
        </div>
      </div>
    </template>
    <p
      v-else
      class="text-danger text-[11px] break-all"
      role="alert"
    >
      {{ state.error }}
    </p>

    <template #footer>
      <span
        v-if="readOnly"
        class="text-amber text-[11px]"
        >{{ t('当前连接为只读，无法写入') }}</span
      >
      <span class="flex-1" />
      <AppButton
        v-if="state.inserting"
        size="sm"
        variant="danger"
        @click="cancelInsert"
      >
        {{ t('取消并回滚') }}
      </AppButton>
      <AppButton
        v-else
        size="sm"
        variant="primary"
        :disabled="
          readOnly ||
          busy ||
          state.generating ||
          !countValid ||
          !table ||
          Boolean(blocker)
        "
        @click="insert"
      >
        {{
          state.generating
            ? t('生成中…')
            : t('写入 {count} 行', { count: rowCount })
        }}
      </AppButton>
    </template>
  </AppDialog>
</template>
