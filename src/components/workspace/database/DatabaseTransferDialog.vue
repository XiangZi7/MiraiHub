<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  reactive,
  toRefs,
  watch,
} from 'vue'
import {
  open as openFileDialog,
  save as saveFileDialog,
} from '@tauri-apps/plugin-dialog'
import * as database from '@/api/database'
import { useTransfersStore } from '@/stores/transfers'
import { withDatabaseExportTransfer } from '@/services/database-export'
import type { DatabaseExportResult } from '@/types/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import { cancelTransfer } from '@/api/ssh'
import type {
  DatabaseImportSource,
  DatabaseImportTarget,
  DatabaseImportRowsTable,
} from '@/types/database-import'
import {
  importTargetKey,
  matchImportColumns,
  matchImportTarget,
  importMappingError,
  prepareImportRows,
} from '@/utils/database-import'
import { databaseExportFileName } from '@/utils/database-export'
import { toast } from '@/composables/useToast'
import type { SavedConnection } from '@/types/connection'
import { isSqlConnection } from '@/types/connection'
import type { DatabaseTransferContent } from '@/types/database'
import DatabaseTransferOptions from './DatabaseTransferOptions.vue'

const { t } = useI18n()
const transfers = useTransfersStore()

export type DatabaseTransferMode = 'export' | 'import'

const props = defineProps<{
  open: boolean
  mode: DatabaseTransferMode
  connection: SavedConnection | null
  sessionId: string
  databaseName?: string
}>()

const emit = defineEmits<{
  close: []
  finished: [mode: DatabaseTransferMode]
}>()

// 响应式状态
const state = reactive({
  // 上传格式、只读预览及用户确认的表和字段映射。
  importFormat: 'sql' as 'sql' | 'xlsx',
  targets: [] as DatabaseImportTarget[],
  sources: [] as DatabaseImportSource[],
  selectedTargets: {} as Record<string, string>,
  selectedColumns: {} as Record<string, string[]>,
  preparing: false,
  catalogLoaded: false,
  templateTarget: '*',
  taskId: '',
  // 整库 SQL 导出沿用相同的可选文件名后缀。
  fileBase: '',
  includeDate: true,
  includeTime: false,
  fileTime: new Date(),
  // SQL 文件路径
  path: '',
  // 导入或导出的内容范围
  content: 'all' as DatabaseTransferContent,
  // 是否包含建库与切库语句
  includeDatabase: false,
  // 是否生成同名对象的删除语句
  dropExisting: false,
  // 文件选择器是否仍在打开
  pickingPath: false,
  // 传输任务是否正在执行
  running: false,
  // 导入任务是否正在取消
  cancelling: false,
  // 是否展示导入确认
  confirmingImport: false,
  // 当前任务是否已经完成
  finished: false,
  // 完成后的统计信息
  resultSummary: '',
  // 失败后的可重试错误信息
  error: '',
})
const {
  path,
  content,
  includeDatabase,
  dropExisting,
  pickingPath,
  running,
  cancelling,
  confirmingImport,
  finished,
  resultSummary,
  error,
} = toRefs(state)
const busy = computed(
  () => state.running || state.pickingPath || state.preparing
)

const isExport = computed(() => props.mode === 'export')
const title = computed(() => (isExport.value ? t('导出数据库') : t('导入数据')))
const databaseName = computed(() => {
  if (props.databaseName) return props.databaseName
  const connection = props.connection
  return connection && isSqlConnection(connection)
    ? connection.settings.database || connection.name
    : (connection?.name ?? 'database')
})

const needsMapping = computed(
  () =>
    !isExport.value &&
    (state.importFormat === 'xlsx' || state.content === 'data')
)
const targetOptions = computed(() => [
  { value: '', label: t('请选择目标表') },
  ...state.targets.map(target => ({
    value: importTargetKey(target),
    label: `${target.schema}.${target.name}`,
  })),
])
const templateOptions = computed(() => [
  { value: '*', label: t('全部表（每表一个工作表）') },
  ...targetOptions.value.slice(1),
])
const mappingErrors = computed(() =>
  state.sources.map(source => {
    const columns = state.selectedColumns[source.id] || []
    if (state.importFormat === 'sql' && columns.some(column => !column))
      return t('SQL 的所有源字段都需要映射')
    return importMappingError(
      source,
      state.targets.find(
        target => importTargetKey(target) === state.selectedTargets[source.id]
      ),
      columns
    )
  })
)
const ready = computed(
  () =>
    !needsMapping.value ||
    (state.sources.length > 0 && !mappingErrors.value.some(Boolean))
)
let planRevision = 0
let workbookWorker: Worker | undefined

/** 同一弹窗处理上传、模板与字段预览；重型 Excel 解析和压缩放到 Worker，任务结束立即释放。 */
async function workbookTask(
  action: 'parse' | 'template',
  payload: Record<string, unknown>
): Promise<{ sources?: DatabaseImportSource[]; bytes?: Uint8Array }> {
  const worker = new Worker(
    new URL('../../../services/database-import.worker.ts', import.meta.url),
    { type: 'module' }
  )
  workbookWorker = worker
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = event =>
        event.data.error
          ? reject(new Error(event.data.error))
          : resolve(event.data)
      worker.onerror = event => reject(new Error(event.message))
      worker.postMessage({ action, ...payload })
    })
  } finally {
    worker.terminate()
    if (workbookWorker === worker) workbookWorker = undefined
  }
}

/** 切换导入格式时清空旧文件路径，避免把 Excel 交给 SQL 解析或反过来处理。 */
function changeImportFormat(format: 'sql' | 'xlsx'): void {
  state.path = ''
  state.importFormat = format
}

/** 表选择变更时按真实字段名重新匹配；不保留上一张表的映射，避免误写列。 */
function selectTarget(source: DatabaseImportSource, value: string): void {
  state.selectedTargets[source.id] = value
  const target = state.targets.find(target => importTargetKey(target) === value)
  state.selectedColumns[source.id] = target
    ? matchImportColumns(source, target)
    : source.columns.map(() => '')
}

/** 文件、格式或导入范围改变后重新只读预检；过期请求不会覆盖新文件的预览。 */
async function prepareImport(): Promise<void> {
  const revision = ++planRevision
  state.sources = []
  state.selectedTargets = {}
  state.selectedColumns = {}
  state.error = ''
  state.preparing = false
  if (!props.open || !needsMapping.value || !props.sessionId) return
  state.preparing = true
  try {
    if (!state.catalogLoaded) {
      const targets = await database.importCatalog(props.sessionId)
      if (revision !== planRevision) return
      state.targets = markRaw(targets)
      state.catalogLoaded = true
    }
    if (!state.path) return
    const sources =
      state.importFormat === 'xlsx'
        ? (
            await workbookTask('parse', {
              bytes: await database.readImportFile(state.path),
            })
          ).sources!
        : (await database.previewImportSql(props.sessionId, state.path)).sources
    if (revision !== planRevision) return
    state.sources = markRaw(sources)
    for (const source of sources) {
      const target = matchImportTarget(source, state.targets)
      selectTarget(source, target ? importTargetKey(target) : '')
    }
  } catch (error) {
    if (revision === planRevision) state.error = database.errorMessage(error)
  } finally {
    if (revision === planRevision) state.preparing = false
  }
}

/** 下载当前目标表或整库的空白 Excel 模板；每张表保留真实字段名和填写说明，并通过传输中心保存。 */
async function downloadTemplate(): Promise<void> {
  if (busy.value || !state.targets.length) return
  const targets = state.targets.filter(
    target =>
      state.templateTarget === '*' ||
      importTargetKey(target) === state.templateTarget
  )
  state.pickingPath = true
  state.error = ''
  try {
    const path = await saveFileDialog({
      title: t('下载 Excel 导入模板'),
      defaultPath: `${safeFileName(databaseName.value)}_template.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })
    if (!path) return
    // 用户可关闭弹窗，模板任务自己的 Worker 不参与上传预检的生命周期。
    void transfers.exportFile({
      fileName: path.split(/[\\/]/u).at(-1)!,
      source: databaseName.value,
      target: path,
      connectionName: props.connection?.name || databaseName.value,
      run: context =>
        withDatabaseExportTransfer(context, async () => {
          const worker = new Worker(
            new URL(
              '../../../services/database-import.worker.ts',
              import.meta.url
            ),
            { type: 'module' }
          )
          /** 取消模板生成时释放压缩 Worker。 */
          const abort = (): void => worker.terminate()
          context.signal.addEventListener('abort', abort, { once: true })
          try {
            context.signal.throwIfAborted()
            context.progress({ phase: 'encoding' })
            const bytes = await new Promise<Uint8Array>((resolve, reject) => {
              worker.onmessage = event =>
                event.data.error
                  ? reject(new Error(event.data.error))
                  : resolve(event.data.bytes)
              worker.onerror = event => reject(new Error(event.message))
              context.signal.addEventListener(
                'abort',
                () => reject(new DOMException('Cancelled', 'AbortError')),
                { once: true }
              )
              worker.postMessage({
                action: 'template',
                targets: JSON.parse(JSON.stringify(targets)),
              })
            })
            for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
              context.signal.throwIfAborted()
              await database.writeExportChunk(
                path,
                bytes.subarray(offset, offset + 256 * 1024),
                context.taskId
              )
              context.progress({
                phase: 'writing',
                totalBytes: bytes.length,
                transferredBytes: Math.min(bytes.length, offset + 256 * 1024),
              })
            }
            await database.writeExportChunk(
              path,
              new Uint8Array(),
              context.taskId,
              true
            )
            return path
          } finally {
            worker.terminate()
            context.signal.removeEventListener('abort', abort)
          }
        }),
    })
  } catch (error) {
    state.error = database.errorMessage(error)
  } finally {
    state.pickingPath = false
  }
}

// 组件销毁时释放上传预检 Worker，已入队的导入导出任务独立运行。
onBeforeUnmount(() => {
  planRevision++
  workbookWorker?.terminate()
})

// 每次打开重置上一次文件和映射，目标库的元数据在本次弹窗内复用。
watch([() => props.open, () => props.mode], ([open]) => {
  if (!open) return

  state.path = ''
  state.taskId = ''
  state.importFormat = 'sql'
  state.sources = []
  state.targets = []
  state.selectedTargets = {}
  state.selectedColumns = {}
  state.catalogLoaded = false
  state.preparing = false
  state.fileBase = databaseName.value
  state.fileTime = new Date()
  state.content = 'all'
  state.includeDatabase = false
  state.dropExisting = false
  state.pickingPath = false
  state.running = false
  state.cancelling = false
  state.confirmingImport = false
  state.finished = false
  state.resultSummary = ''
  state.error = ''
})

// 上传格式或数据范围改变后清空旧预览，Excel 始终按纯数据方式导入。
watch(
  [
    () => props.open,
    () => state.path,
    () => state.importFormat,
    () => state.content,
  ],
  () => {
    if (state.importFormat === 'xlsx') state.content = 'data'
    void prepareImport()
  }
)

// 纯数据模式不生成或执行数据库创建和删除选项。
watch(
  () => state.content,
  content => {
    if (content !== 'data') return
    state.includeDatabase = false
    state.dropExisting = false
  }
)

/** 清理模板文件名中的系统保留字符，避免保存对话框使用无效路径。 */
function safeFileName(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'database'
  )
}

/** 整库导出文件名使用本地日期，用户可决定是否附上日期和时间。 */
function defaultExportName(): string {
  return databaseExportFileName(
    state.fileBase,
    'sql',
    { date: state.includeDate, time: state.includeTime },
    state.fileTime
  )
}

/** 选择导出位置或待上传文件；选择完成后由预检监听器生成表和字段匹配。 */
async function choosePath(): Promise<void> {
  if (busy.value) return
  state.pickingPath = true
  state.error = ''
  try {
    if (isExport.value) {
      const selected = await saveFileDialog({
        title: t('选择 SQL 导出位置'),
        defaultPath: defaultExportName(),
        filters: [{ name: t('SQL 文件'), extensions: ['sql'] }],
      })
      if (selected) state.path = selected
      return
    }

    const selected = await openFileDialog({
      title:
        state.importFormat === 'xlsx'
          ? t('上传 Excel 文件')
          : t('选择要导入的 SQL 文件'),
      multiple: false,
      directory: false,
      filters:
        state.importFormat === 'xlsx'
          ? [{ name: 'Excel', extensions: ['xlsx'] }]
          : [{ name: t('SQL 文件'), extensions: ['sql'] }],
    })
    if (typeof selected === 'string') state.path = selected
  } catch (error) {
    state.error = database.errorMessage(error)
    toast.error(state.error)
  } finally {
    state.pickingPath = false
  }
}

/** 全部映射有效后才允许确认导入；导出直接入队，导入还需核对目标数据库。 */
function requestRun(): void {
  if (busy.value || !ready.value || state.finished || state.confirmingImport)
    return
  if (!state.path) {
    toast.warning(
      isExport.value ? t('请先选择导出位置') : t('请先选择 SQL 文件')
    )
    return
  }
  if (!props.sessionId) {
    toast.error(t('数据库连接已断开，请重新连接后再试'))
    return
  }

  if (isExport.value) void runTransfer()
  else state.confirmingImport = true
}

/** 用户确认目标库和映射后开始写入；预览阶段不会修改数据库。 */
async function confirmImport(): Promise<void> {
  state.confirmingImport = false
  await runTransfer()
}

/** 通过现有文件传输队列执行导入导出；使用独立连接固定目标库，结束后始终释放连接。 */
async function runTransfer(): Promise<void> {
  if (state.running) return
  state.running = true
  state.cancelling = false
  state.finished = false
  state.error = ''
  state.resultSummary = ''
  // 先刷新禁用与加载状态，再发起原生任务。
  await nextTick()

  try {
    if (isExport.value) {
      const sessionId = props.sessionId
      const path = state.path
      const source = databaseName.value
      const options = {
        content: state.content,
        includeDatabase: state.includeDatabase,
        dropExisting: state.dropExisting,
      }
      let result: DatabaseExportResult | undefined
      let taskId = ''
      const saved = await transfers.exportFile({
        fileName: path.split(/[\\/]/u).at(-1) || 'database.sql',
        source,
        target: path,
        connectionName: props.connection?.name ?? source,
        run: context =>
          withDatabaseExportTransfer(context, async () => {
            taskId = context.taskId
            const owned = await database.forkSession(sessionId, source)
            try {
              context.signal.throwIfAborted()
              result = await database.exportSql(
                owned.sessionId,
                path,
                options,
                context.taskId
              )
              context.progress({
                totalBytes: result.bytes,
                transferredBytes: result.bytes,
                processedRows: result.rows,
              })
              return path
            } finally {
              await database.disconnect(owned.sessionId)
            }
          }),
      })
      if (!saved || !result)
        throw new Error(
          transfers.tasks.find(task => task.id === taskId)?.error ||
            t('导出已取消')
        )
      state.resultSummary = t(
        '已导出 {value0} 个对象、{value1} 行数据（{value2}），耗时 {value3} ms。',
        {
          value0: result.objects,
          value1: result.rows,
          value2: formatBytes(result.bytes),
          value3: result.elapsedMs,
        }
      )
      toast.success({
        title: t('数据库导出完成'),
        description: state.resultSummary,
      })
    } else {
      const sourcePath = state.path
      const rootSession = props.sessionId
      const targetDatabase = databaseName.value
      const excel = state.importFormat === 'xlsx'
      // 写入前一次性验证所有工作表，避免运行到后半段才发现必填字段缺失。
      const tables: DatabaseImportRowsTable[] = excel
        ? state.sources.map(source => {
            const target = state.targets.find(
              target =>
                importTargetKey(target) === state.selectedTargets[source.id]
            )!
            return prepareImportRows(
              source,
              target,
              state.selectedColumns[source.id]!
            )
          })
        : []
      const options = {
        content: state.content,
        includeDatabase: state.includeDatabase,
        ...(needsMapping.value && !excel
          ? {
              mappings: state.sources.map(source => {
                const target = state.targets.find(
                  target =>
                    importTargetKey(target) === state.selectedTargets[source.id]
                )!
                return {
                  sourceId: source.id,
                  targetSchema: target.schema,
                  targetTable: target.name,
                  columns: Object.fromEntries(
                    source.columns.map((name, index) => [
                      name,
                      state.selectedColumns[source.id]![index]!,
                    ])
                  ),
                }
              }),
            }
          : {}),
      }
      let result: Awaited<ReturnType<typeof database.importSql>> | undefined
      const saved = await transfers.exportFile({
        kind: 'database-import',
        onQueued: id => {
          state.taskId = id
        },
        fileName: sourcePath.split(/[\\/]/u).at(-1)!,
        source: sourcePath,
        target: targetDatabase,
        connectionName: props.connection?.name || targetDatabase,
        run: context =>
          withDatabaseExportTransfer(context, async () => {
            state.taskId = context.taskId
            const owned = await database.forkSession(
              rootSession,
              targetDatabase
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
              result = excel
                ? await database.importRows(
                    owned.sessionId,
                    tables,
                    context.taskId
                  )
                : await database.importSql(owned.sessionId, sourcePath, options)
              context.progress({ processedRows: result.rowsAffected })
              return sourcePath
            } finally {
              await database.disconnect(owned.sessionId)
            }
          }),
      })
      if (!saved || !result)
        throw new Error(
          transfers.tasks.find(task => task.id === state.taskId)?.error ||
            t('导入已取消')
        )
      state.resultSummary = t(
        '已执行 {value0} 条 SQL，影响 {value1} 行，耗时 {value2} ms。',
        {
          value0: result.statements,
          value1: result.rowsAffected,
          value2: result.elapsedMs,
        }
      )
      if (result.skippedStatements > 0)
        state.resultSummary +=
          ' ' +
          t('已按选项跳过 {count} 条 SQL。', {
            count: result.skippedStatements,
          })
      toast.success({
        title: t('数据导入完成'),
        description: state.resultSummary,
      })
    }
    state.finished = true
    emit('finished', props.mode)
  } catch (error) {
    state.error = database.errorMessage(error)
    toast.error({
      title: isExport.value ? t('数据库导出失败') : t('数据导入失败'),
      description: state.error,
    })
  } finally {
    state.running = false
    state.cancelling = false
  }
}

/** 取消当前入队或运行的导入，Excel 会在事务提交前回滚全部行。 */
async function cancelImport(): Promise<void> {
  if (!state.running || isExport.value || state.cancelling) return

  state.cancelling = true
  try {
    if (state.taskId) await transfers.cancel(state.taskId)
  } catch (error) {
    toast.error({
      title: t('取消导入失败'),
      description: database.errorMessage(error),
    })
    state.cancelling = false
  }
}

/** 正在预检或导入时保留弹窗；后台导出可关闭弹窗继续执行。 */
function requestClose(): void {
  if (
    (!busy.value || (isExport.value && state.running)) &&
    !state.confirmingImport
  )
    emit('close')
}

/** 将导出字节数显示为便于阅读的体积。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <Teleport to="body">
    <Transition name="database-transfer-dialog">
      <div
        v-if="open"
        class="database-transfer-backdrop"
      >
        <AppDialog
          :title="title"
          :wide="needsMapping"
          :description="`${connection?.name ?? t('数据库')} · ${databaseName}`"
          @close="requestClose"
        >
          <div
            class="grid gap-3.5"
            :aria-busy="running"
          >
            <div
              v-if="!isExport"
              class="grid grid-cols-2 gap-2"
              role="group"
              :aria-label="t('导入格式')"
            >
              <button
                v-for="format in ['sql', 'xlsx'] as const"
                :key="format"
                type="button"
                :disabled="busy || finished"
                :aria-pressed="state.importFormat === format"
                class="border-line-soft flex items-center gap-2 rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-50"
                :class="
                  state.importFormat === format
                    ? 'border-violet/50 bg-violet/10'
                    : 'hover:bg-hover'
                "
                @click="changeImportFormat(format)"
              >
                <AppIcon
                  :name="
                    format === 'xlsx'
                      ? 'lucide:file-spreadsheet'
                      : 'lucide:database'
                  "
                  :size="22"
                  :class="format === 'xlsx' ? 'text-success' : 'text-blue'"
                />
                <span class="text-txt-2 text-xs">{{
                  format === 'xlsx' ? 'Excel .xlsx' : 'SQL .sql'
                }}</span>
              </button>
            </div>
            <div
              v-if="isExport"
              class="border-line-soft grid gap-3 rounded-lg border p-3"
            >
              <div class="text-blue flex items-center gap-2 text-xs">
                <AppIcon
                  name="lucide:database-backup"
                  :size="19"
                />SQL
              </div>
              <AppTextField
                v-model="state.fileBase"
                :label="t('文件名')"
                :disabled="busy || finished || !!path"
              />
              <div class="flex gap-4">
                <AppCheckbox
                  v-model="state.includeDate"
                  :label="t('附加日期')"
                  :disabled="busy || finished || !!path"
                /><AppCheckbox
                  v-model="state.includeTime"
                  :label="t('附加时间')"
                  :disabled="busy || finished || !!path"
                />
              </div>
              <p class="text-txt-3 font-mono text-[11px] break-all">
                {{ defaultExportName() }}
              </p>
            </div>
            <div
              v-if="!isExport && state.importFormat === 'xlsx'"
              class="border-line-soft grid gap-2 rounded-lg border p-3"
            >
              <p class="text-txt-3 text-[11px] leading-5">
                {{
                  t(
                    '先下载模板填写数据，或上传第一行为字段名的 Excel。每张工作表对应一张表，导入前可调整映射。'
                  )
                }}
              </p>
              <div class="flex items-end gap-2">
                <AppSelect
                  v-model="state.templateTarget"
                  :label="t('模板范围')"
                  :options="templateOptions"
                  :disabled="busy || finished"
                  class="min-w-0 flex-1"
                /><AppButton
                  :disabled="busy || finished || !state.targets.length"
                  @click="downloadTemplate"
                  ><AppIcon
                    name="lucide:download"
                    :size="13"
                  />{{ t('下载模板') }}</AppButton
                >
              </div>
            </div>
            <div class="space-y-1.5">
              <label class="text-txt-2 text-[11px] font-medium">
                {{
                  isExport
                    ? t('保存位置')
                    : state.importFormat === 'xlsx'
                      ? t('Excel 文件')
                      : t('SQL 文件')
                }}
              </label>
              <div class="flex gap-2">
                <div
                  class="input text-txt-3 flex min-w-0 flex-1 items-center gap-2 px-2.5 font-mono text-[10.5px]"
                >
                  <AppIcon
                    :name="
                      isExport ? 'lucide:file-output' : 'lucide:file-input'
                    "
                    :size="13"
                    class="shrink-0"
                  />
                  <span class="truncate">{{ path || t('尚未选择文件') }}</span>
                </div>
                <AppButton
                  :disabled="busy || finished"
                  @click="choosePath"
                >
                  <AppIcon
                    v-if="pickingPath"
                    name="lucide:loader-circle"
                    :size="13"
                    class="animate-spin"
                  />
                  <AppIcon
                    v-else
                    :name="isExport ? 'lucide:folder-open' : 'lucide:upload'"
                    :size="13"
                  />
                  {{
                    !isExport && state.importFormat === 'xlsx'
                      ? t('上传 Excel')
                      : t('浏览…')
                  }}
                </AppButton>
              </div>
            </div>

            <DatabaseTransferOptions
              v-if="isExport || state.importFormat === 'sql'"
              v-model:content="content"
              v-model:include-database="includeDatabase"
              v-model:drop-existing="dropExisting"
              :mode="mode"
              :database-kind="connection?.kind"
              :disabled="busy || finished"
            />
            <div
              v-if="state.preparing"
              class="text-violet flex items-center gap-2 py-3 text-xs"
              role="status"
            >
              <AppIcon
                name="lucide:loader-circle"
                :size="15"
                class="animate-spin"
              />{{ t('正在读取文件和匹配表结构…') }}
            </div>
            <div
              v-else-if="needsMapping && state.sources.length"
              class="grid gap-3"
            >
              <p class="text-txt-2 flex items-center gap-2 text-xs font-medium">
                <AppIcon
                  name="lucide:git-compare-arrows"
                  :size="15"
                  class="text-cyan"
                />{{ t('核对表和字段映射') }}
              </p>
              <section
                v-for="(source, sourceIndex) in state.sources"
                :key="source.id"
                class="border-line-soft min-w-0 space-y-3 rounded-lg border p-3"
              >
                <div class="flex items-center gap-2">
                  <AppIcon
                    name="lucide:table-2"
                    :size="15"
                    class="text-blue"
                  /><span
                    class="text-txt-2 min-w-0 flex-1 truncate font-mono text-xs"
                    >{{ source.name }}</span
                  ><span class="text-txt-4 text-[10px]">{{
                    state.importFormat === 'xlsx'
                      ? t('common.rows', { count: source.rows.length })
                      : t('{count} 条 SQL', {
                          count: source.statementCount || 0,
                        })
                  }}</span>
                </div>
                <AppSelect
                  :model-value="state.selectedTargets[source.id] || ''"
                  :label="t('目标表')"
                  :options="targetOptions"
                  :disabled="busy || finished"
                  @update:model-value="selectTarget(source, $event)"
                />
                <details
                  class="text-txt-3 text-[11px]"
                  :open="!!mappingErrors[sourceIndex]"
                >
                  <summary class="cursor-pointer py-1">
                    {{ t('字段映射') }} · {{ source.columns.length }}
                  </summary>
                  <div class="mt-2 grid gap-2">
                    <div
                      v-for="(column, index) in source.columns"
                      :key="column"
                      class="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-2"
                    >
                      <span
                        class="truncate font-mono"
                        :title="column"
                        >{{ column }}</span
                      ><AppIcon
                        name="lucide:arrow-right"
                        :size="12"
                      />
                      <AppSelect
                        v-if="state.selectedColumns[source.id]"
                        v-model="state.selectedColumns[source.id]![index]"
                        :label="t('目标字段')"
                        hide-label
                        :options="[
                          {
                            value: '',
                            label:
                              state.importFormat === 'xlsx'
                                ? t('忽略此字段')
                                : t('请选择字段'),
                          },
                          ...(
                            state.targets.find(
                              target =>
                                importTargetKey(target) ===
                                state.selectedTargets[source.id]
                            )?.columns || []
                          ).map(column => ({
                            value: column.name,
                            label: column.name,
                            description: column.dataType,
                          })),
                        ]"
                        :disabled="busy || finished"
                      />
                    </div>
                  </div>
                </details>
                <div
                  v-if="source.rows.length"
                  class="scroll-thin border-line-soft overflow-auto rounded border"
                >
                  <table class="w-full text-left font-mono text-[10px]">
                    <thead class="bg-surface text-txt-3">
                      <tr>
                        <th
                          v-for="column in source.columns.slice(0, 6)"
                          :key="column"
                          class="max-w-40 truncate px-2 py-1.5"
                        >
                          {{ column }}
                        </th>
                      </tr>
                    </thead>
                    <tbody class="text-txt-2">
                      <tr
                        v-for="(row, index) in source.rows.slice(0, 3)"
                        :key="index"
                      >
                        <td
                          v-for="(value, cell) in row.slice(0, 6)"
                          :key="cell"
                          class="border-line-soft max-w-40 truncate border-t px-2 py-1.5"
                        >
                          {{ value === null ? 'NULL' : value }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p
                  v-if="mappingErrors[sourceIndex]"
                  class="text-amber text-[11px]"
                  role="alert"
                >
                  {{ mappingErrors[sourceIndex] }}
                </p>
                <p
                  v-else
                  class="text-success flex items-center gap-1.5 text-[10.5px]"
                >
                  <AppIcon
                    name="lucide:circle-check"
                    :size="12"
                  />{{ t('映射完整，确认后追加数据') }}
                </p>
              </section>
            </div>
            <template v-if="isExport">
              <p
                class="text-txt-4 flex items-start gap-1.5 text-[10.5px] leading-4"
              >
                <AppIcon
                  name="lucide:info"
                  :size="12"
                  class="mt-0.5 shrink-0"
                />
                {{
                  t(
                    '导出为可再次导入的 SQL 文件；大表会分页读取，避免一次载入全部数据。'
                  )
                }}
              </p>
            </template>

            <p
              v-else
              class="card border-amber/25 bg-amber/8 text-amber flex items-start gap-2 px-3 py-2.5 text-[10.5px] leading-4"
            >
              <AppIcon
                name="lucide:triangle-alert"
                :size="14"
                class="mt-0.5 shrink-0"
              />
              <span>
                {{
                  state.importFormat === 'xlsx'
                    ? t(
                        'Excel 仅追加数据，不会创建或清空表。全部工作表在同一事务内写入，失败或取消会回滚。'
                      )
                    : t(
                        '将按所选内容导入 SQL。INSERT 会追加数据，REPLACE 可能替换已有行；主键或唯一键冲突可能导致导入失败。SQL 失败前已提交的语句不会自动回滚。'
                      )
                }}
              </span>
            </p>

            <p
              v-if="running"
              class="card text-txt-2 flex items-center gap-2 px-3 py-2.5 text-[11px]"
              role="status"
            >
              <AppIcon
                name="lucide:loader-circle"
                :size="14"
                class="text-violet animate-spin"
              />
              {{
                cancelling
                  ? t('正在取消导入…')
                  : isExport
                    ? t('正在导出，请稍候…')
                    : t('正在导入，请稍候…')
              }}
            </p>
            <p
              v-else-if="finished"
              class="card text-green flex items-start gap-2 px-3 py-2.5 text-[11px] leading-5"
              role="status"
            >
              <AppIcon
                name="lucide:circle-check"
                :size="14"
                class="mt-0.5 shrink-0"
              />
              {{ resultSummary }}
            </p>
            <p
              v-else-if="error"
              class="card text-danger px-3 py-2.5 text-[11px] leading-5 break-words"
              role="alert"
            >
              {{ error }}
            </p>
          </div>

          <template #footer>
            <div class="flex-1" />
            <AppButton
              v-if="running && !isExport"
              :disabled="cancelling"
              @click="cancelImport"
            >
              {{ cancelling ? t('取消中…') : t('取消导入') }}
            </AppButton>
            <AppButton
              v-else
              :disabled="busy && !(isExport && running)"
              @click="requestClose"
            >
              {{
                finished
                  ? t('完成')
                  : isExport && running
                    ? t('后台运行')
                    : t('取消')
              }}
            </AppButton>
            <AppButton
              v-if="!finished"
              variant="primary"
              :disabled="busy || !path || !ready"
              @click="requestRun"
            >
              <AppIcon
                v-if="running"
                name="lucide:loader-circle"
                :size="13"
                class="animate-spin"
              />
              {{
                running
                  ? isExport
                    ? t('导出中…')
                    : t('导入中…')
                  : isExport
                    ? t('开始导出')
                    : t('开始导入')
              }}
            </AppButton>
          </template>
        </AppDialog>
      </div>
    </Transition>
  </Teleport>

  <AppConfirmDialog
    :open="confirmingImport"
    :title="t('确认导入数据')"
    :description="
      t(
        '将按所选内容导入“{value0}”，目标数据库：{value1}。该操作可能修改现有数据。',
        { value0: path, value1: databaseName }
      )
    "
    :confirm-label="t('确认导入')"
    danger
    @close="confirmingImport = false"
    @confirm="confirmImport"
  />
</template>

<style scoped>
.database-transfer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.database-transfer-dialog-enter-active,
.database-transfer-dialog-leave-active {
  transition: opacity 120ms ease;
}

.database-transfer-dialog-enter-from,
.database-transfer-dialog-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .database-transfer-dialog-enter-active,
  .database-transfer-dialog-leave-active {
    transition: none;
  }
}
</style>
