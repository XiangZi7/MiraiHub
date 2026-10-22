<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, nextTick, reactive, toRefs, watch } from 'vue'
import {
  open as openFileDialog,
  save as saveFileDialog,
} from '@tauri-apps/plugin-dialog'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { toast } from '@/composables/useToast'
import type { SavedConnection } from '@/types/connection'
import { isSqlConnection } from '@/types/connection'
import type { DatabaseTransferContent } from '@/types/database'
import DatabaseTransferOptions from './DatabaseTransferOptions.vue'

const { t } = useI18n()

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
const busy = computed(() => state.running || state.pickingPath)

const isExport = computed(() => props.mode === 'export')
const title = computed(() =>
  isExport.value ? t('导出数据库') : t('导入 SQL 文件')
)
const databaseName = computed(() => {
  if (props.databaseName) return props.databaseName
  const connection = props.connection
  return connection && isSqlConnection(connection)
    ? connection.settings.database || connection.name
    : (connection?.name ?? 'database')
})

watch([() => props.open, () => props.mode], ([open]) => {
  if (!open) return

  state.path = ''
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

watch(
  () => state.content,
  content => {
    if (content !== 'data') return
    state.includeDatabase = false
    state.dropExisting = false
  }
)

function safeFileName(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'database'
  )
}

function defaultExportName(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `${safeFileName(databaseName.value)}-${date}.sql`
}

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
      title: t('选择要导入的 SQL 文件'),
      multiple: false,
      directory: false,
      filters: [{ name: t('SQL 文件'), extensions: ['sql'] }],
    })
    if (typeof selected === 'string') state.path = selected
  } catch (error) {
    state.error = database.errorMessage(error)
    toast.error(state.error)
  } finally {
    state.pickingPath = false
  }
}

function requestRun(): void {
  if (busy.value || state.finished || state.confirmingImport) return
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

async function confirmImport(): Promise<void> {
  state.confirmingImport = false
  await runTransfer()
}

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
      const result = await database.exportSql(props.sessionId, state.path, {
        content: state.content,
        includeDatabase: state.includeDatabase,
        dropExisting: state.dropExisting,
      })
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
      const result = await database.importSql(props.sessionId, state.path, {
        content: state.content,
        includeDatabase: state.includeDatabase,
      })
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
        title: t('SQL 导入完成'),
        description: state.resultSummary,
      })
    }
    state.finished = true
    emit('finished', props.mode)
  } catch (error) {
    state.error = database.errorMessage(error)
    toast.error({
      title: isExport.value ? t('数据库导出失败') : t('SQL 导入失败'),
      description: state.error,
    })
  } finally {
    state.running = false
    state.cancelling = false
  }
}

async function cancelImport(): Promise<void> {
  if (!state.running || isExport.value || state.cancelling) return

  state.cancelling = true
  try {
    await database.cancelQuery(props.sessionId)
  } catch (error) {
    toast.error({
      title: t('取消导入失败'),
      description: database.errorMessage(error),
    })
    state.cancelling = false
  }
}

function requestClose(): void {
  if (!busy.value && !state.confirmingImport) emit('close')
}

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
          :description="`${connection?.name ?? t('数据库')} · ${databaseName}`"
          @close="requestClose"
        >
          <div
            class="grid gap-3.5"
            :aria-busy="running"
          >
            <div class="space-y-1.5">
              <label class="text-txt-2 text-[11px] font-medium">
                {{ isExport ? t('保存位置') : t('SQL 文件') }}
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
                  {{ t('浏览…') }}
                </AppButton>
              </div>
            </div>

            <DatabaseTransferOptions
              v-model:content="content"
              v-model:include-database="includeDatabase"
              v-model:drop-existing="dropExisting"
              :mode="mode"
              :database-kind="connection?.kind"
              :disabled="busy || finished"
            />
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
                  t(
                    '将按所选内容导入 SQL。INSERT 会追加数据，REPLACE 可能替换已有行；主键或唯一键冲突可能导致导入失败。'
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
              :disabled="busy"
              @click="requestClose"
            >
              {{ finished ? t('完成') : t('取消') }}
            </AppButton>
            <AppButton
              v-if="!finished"
              variant="primary"
              :disabled="busy || !path"
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
    :title="t('确认导入 SQL')"
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
