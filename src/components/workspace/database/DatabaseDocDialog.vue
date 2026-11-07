<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { save } from '@tauri-apps/plugin-dialog'
import { computed, onBeforeUnmount, onMounted, reactive, shallowRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import * as agent from '@/api/agent'
import * as database from '@/api/database'
import { toast } from '@/composables/useToast'
import type { DatabaseObject, DatabaseTableDetail } from '@/types/database'
import { copyText } from '@/utils/clipboard'
import {
  dataDictionaryText,
  type DataDictionaryDescriptions,
  type DataDictionaryFormat,
  type DataDictionaryLabels,
} from '@/utils/database-export-text'
import { extractJsonObject } from '@/utils/database-test-data'

/** 单次 AI 请求的表数；再多模型容易截断 JSON。 */
const AI_BATCH = 12
const SAMPLE_ROWS = 5
const SAMPLE_LENGTH = 48
// 这些字段即使用户同意抽样也不发送
const SENSITIVE_COLUMN =
  /(pass(word|wd)?|pwd|secret|token|api_?key|private|credential|salt|hash|otp|cvv|card|ssn|id_?card)/iu

const { t, locale } = useI18n()

const props = defineProps<{
  sessionId: string
  databaseName: string
  /** 打开时预选的表，来自右键菜单。 */
  initial?: DatabaseObject | null
  target: { kind: 'database'; sessionId: string; database: string }
}>()

const emit = defineEmits<{ close: [] }>()

const state = reactive({
  loading: true,
  search: '',
  format: 'markdown' as DataDictionaryFormat,
  useAi: false,
  allowSamples: false,
  running: false,
  progress: '',
  output: '',
  outputCount: 0,
  error: '',
})
const tables = shallowRef<DatabaseObject[]>([])
const selected = shallowRef(new Set<string>())
let generation = 0

const keyOf = (object: DatabaseObject): string =>
  `${object.schema}\u0000${object.name}`

const formatOptions = computed(() => [
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
])
const visible = computed(() => {
  const keyword = state.search.trim().toLowerCase()
  return keyword
    ? tables.value.filter(table =>
        `${table.name} ${table.comment ?? ''}`.toLowerCase().includes(keyword)
      )
    : tables.value
})
const allVisibleSelected = computed(
  () =>
    visible.value.length > 0 &&
    visible.value.every(table => selected.value.has(keyOf(table)))
)

onMounted(async () => {
  try {
    tables.value = (await database.listObjects(props.sessionId)).filter(
      object => object.kind === 'table'
    )
    selected.value = new Set(
      props.initial
        ? [keyOf(props.initial)]
        : tables.value.map(table => keyOf(table))
    )
  } catch (error) {
    state.error = database.errorMessage(error)
  } finally {
    state.loading = false
  }
})

onBeforeUnmount(() => {
  generation += 1
})

function toggle(object: DatabaseObject): void {
  const next = new Set(selected.value)
  if (next.has(keyOf(object))) next.delete(keyOf(object))
  else next.add(keyOf(object))
  selected.value = next
}

function toggleVisible(): void {
  const next = new Set(selected.value)
  const clear = allVisibleSelected.value
  for (const table of visible.value)
    if (clear) next.delete(keyOf(table))
    else next.add(keyOf(table))
  selected.value = next
}

/** 只有用户勾选同意才读取样本；敏感字段名和超长值不进入样本。 */
async function sampleValues(
  table: DatabaseTableDetail
): Promise<Record<string, string[]>> {
  const page = await database.fetchRows(props.sessionId, {
    schema: table.schema,
    table: table.name,
    limit: SAMPLE_ROWS,
  })
  const samples: Record<string, string[]> = {}
  page.columns.forEach((column, index) => {
    if (SENSITIVE_COLUMN.test(column.name)) return
    const values = page.rows
      .map(row => row[index])
      .filter((value): value is string => Boolean(value))
      .filter(value => !value.startsWith('base64:'))
      .map(value => value.slice(0, SAMPLE_LENGTH))
    if (values.length) samples[column.name] = [...new Set(values)]
  })
  return samples
}

async function describeBatch(
  batch: DatabaseTableDetail[],
  descriptions: DataDictionaryDescriptions,
  token: number
): Promise<void> {
  const payload = []
  for (const table of batch)
    payload.push({
      name: table.name,
      comment: table.options?.comment ?? null,
      columns: table.columns.map(column => ({
        name: column.name,
        type: column.dataType,
        comment: column.comment,
      })),
      undocumented: table.columns
        .filter(column => !column.comment)
        .map(column => column.name),
      foreignKeys: table.foreignKeys.map(
        key => `${key.columns.join(', ')} -> ${key.referencedTable}`
      ),
      ...(state.allowSamples ? { samples: await sampleValues(table) } : {}),
    })
  const text = await agent.describeTables(
    props.target,
    JSON.stringify(payload),
    locale.value.startsWith('zh') ? 'Simplified Chinese' : 'English'
  )
  if (token !== generation) return
  const parsed = extractJsonObject(text) as { tables?: unknown }
  if (!Array.isArray(parsed.tables)) return
  const names = new Set(batch.map(table => table.name))
  for (const entry of parsed.tables as Array<Record<string, unknown>>) {
    if (typeof entry?.name !== 'string' || !names.has(entry.name)) continue
    const columns: Record<string, string> = {}
    if (entry.columns && typeof entry.columns === 'object')
      for (const [name, value] of Object.entries(entry.columns))
        if (typeof value === 'string') columns[name] = value
    descriptions[entry.name] = {
      table: typeof entry.description === 'string' ? entry.description : '',
      columns,
    }
  }
}

function labels(): DataDictionaryLabels {
  return {
    title: t('数据字典'),
    tableCount: t('{count} 张表', { count: state.outputCount }),
    contents: t('目录'),
    columns: t('字段'),
    indexes: t('索引'),
    foreignKeys: t('外键'),
    name: t('字段名'),
    type: t('类型'),
    nullable: t('允许空值'),
    primaryKey: t('主键'),
    defaultValue: t('默认值'),
    comment: t('备注'),
    aiNote: t('（AI 推断）'),
    unique: t('唯一'),
    yes: t('是'),
    no: t('否'),
    indexColumns: t('索引字段'),
    references: t('引用'),
  }
}

async function generate(): Promise<void> {
  if (state.running || !selected.value.size) return
  const token = ++generation
  state.running = true
  state.error = ''
  state.output = ''
  try {
    const targets = tables.value.filter(table =>
      selected.value.has(keyOf(table))
    )
    const details: DatabaseTableDetail[] = []
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const object = targets[cursor++]!
        const detail = await database.tableDetail(
          props.sessionId,
          object.schema,
          object.name,
          'table'
        )
        details.push(detail)
        if (token === generation)
          state.progress = t('读取结构 {done}/{total}', {
            done: details.length,
            total: targets.length,
          })
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    if (token !== generation) return
    details.sort((a, b) => a.name.localeCompare(b.name))

    const descriptions: DataDictionaryDescriptions = {}
    if (state.useAi)
      for (let index = 0; index < details.length; index += AI_BATCH) {
        state.progress = t('AI 补全描述 {done}/{total}', {
          done: index,
          total: details.length,
        })
        try {
          await describeBatch(
            details.slice(index, index + AI_BATCH),
            descriptions,
            token
          )
        } catch (error) {
          // 已写好的结构不因 AI 失败作废，停止后续批次并提示
          toast.error({
            title: t('AI 补全描述失败，已保留结构信息'),
            description: database.errorMessage(error),
          })
          break
        }
        if (token !== generation) return
      }
    state.outputCount = details.length
    state.output = dataDictionaryText(
      state.format,
      props.databaseName,
      details,
      descriptions,
      labels()
    )
  } catch (error) {
    if (token === generation) state.error = database.errorMessage(error)
  } finally {
    if (token === generation) {
      state.running = false
      state.progress = ''
    }
  }
}

async function copyOutput(): Promise<void> {
  try {
    await copyText(state.output)
    toast.success(t('已复制到剪贴板'))
  } catch (error) {
    toast.error({ title: t('复制失败'), description: String(error) })
  }
}

async function saveOutput(): Promise<void> {
  const extension = state.format === 'markdown' ? 'md' : 'html'
  try {
    const path = await save({
      defaultPath: `${props.databaseName}-data-dictionary.${extension}`,
      filters: [{ name: t('数据字典'), extensions: [extension] }],
    })
    if (!path) return
    const taskId = crypto.randomUUID()
    const bytes = new TextEncoder().encode(state.output)
    await database.beginExportFile(taskId)
    try {
      for (let offset = 0; offset < bytes.length; offset += 256 * 1024)
        await database.writeExportChunk(
          path,
          bytes.subarray(offset, offset + 256 * 1024),
          taskId
        )
      await database.writeExportChunk(path, new Uint8Array(), taskId, true)
    } finally {
      await database.finishExportFile(taskId)
    }
    toast.success(t('数据字典已保存'))
  } catch (error) {
    toast.error({
      title: t('保存失败'),
      description: database.errorMessage(error),
    })
  }
}
</script>

<template>
  <AppDialog
    wide
    :title="t('生成数据字典 · {database}', { database: databaseName })"
    :description="t('选择要写入文档的表，导出 Markdown 或 HTML。')"
    @close="emit('close')"
  >
    <AppSkeleton
      v-if="state.loading"
      :rows="6"
    />
    <template v-else>
      <div class="flex items-end gap-2">
        <div class="min-w-0 flex-1">
          <SearchField
            v-model="state.search"
            :placeholder="t('搜索表')"
          />
        </div>
        <AppButton
          size="sm"
          @click="toggleVisible"
        >
          {{ allVisibleSelected ? t('取消全选') : t('全选') }}
        </AppButton>
        <div class="w-32 shrink-0">
          <AppSelect
            v-model="state.format"
            :label="t('格式')"
            :options="formatOptions"
            hide-label
            compact
          />
        </div>
      </div>

      <ul class="mt-2 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
        <li
          v-for="table in visible"
          :key="keyOf(table)"
        >
          <label class="row-item">
            <input
              type="checkbox"
              class="accent-accent"
              :checked="selected.has(keyOf(table))"
              @change="toggle(table)"
            />
            <span class="text-txt min-w-0 truncate font-mono text-[11.5px]">{{
              table.name
            }}</span>
            <span class="flex-1" />
            <span class="text-txt-4 min-w-0 truncate text-[10.5px]">{{
              table.comment
            }}</span>
          </label>
        </li>
      </ul>

      <div class="mt-3 flex flex-col gap-2">
        <AppCheckbox
          v-model="state.useAi"
          :label="t('AI 补全描述')"
          :description="t('把表名、字段和类型发送给当前 AI 配置，推断缺失的说明。')"
        />
        <AppCheckbox
          v-if="state.useAi"
          v-model="state.allowSamples"
          :label="t('同意发送抽样值')"
          :description="
            t(
              '每张表最多发送 {rows} 行抽样值，帮助 AI 判断含义；密码、令牌等敏感字段名会被跳过，但其他字段可能仍含真实数据。',
              { rows: SAMPLE_ROWS }
            )
          "
        />
      </div>

      <p
        v-if="state.error"
        class="text-danger mt-2 text-[11px] break-all"
        role="alert"
      >
        {{ state.error }}
      </p>

      <textarea
        v-if="state.output"
        :value="state.output"
        readonly
        :aria-label="t('数据字典')"
        class="border-line-soft bg-panel text-txt-2 mt-3 h-40 w-full resize-none rounded-md border p-2 font-mono text-[10.5px] outline-none"
      />
    </template>

    <template #footer>
      <span class="text-txt-3 text-[11px] tabular-nums">{{
        state.progress || t('已选 {count} 项', { count: selected.size })
      }}</span>
      <span class="flex-1" />
      <template v-if="state.output && !state.running">
        <AppButton
          size="sm"
          @click="copyOutput"
        >
          {{ t('复制') }}
        </AppButton>
        <AppButton
          size="sm"
          @click="saveOutput"
        >
          {{ t('保存文件') }}
        </AppButton>
      </template>
      <AppButton
        size="sm"
        variant="primary"
        :disabled="state.running || !selected.size"
        @click="generate"
      >
        <AppIcon
          v-if="state.running"
          name="lucide:loader-2"
          :size="12"
          class="motion-safe:animate-spin"
        />
        {{ state.output ? t('重新生成') : t('生成文档') }}
      </AppButton>
    </template>
  </AppDialog>
</template>
