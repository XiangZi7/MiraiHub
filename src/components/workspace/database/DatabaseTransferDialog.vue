<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, watch } from 'vue'
import {
  open as openFileDialog,
  save as saveFileDialog,
} from '@tauri-apps/plugin-dialog'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { toast } from '@/composables/useToast'
import type { SavedConnection } from '@/types/connection'
import { isDatabaseConnection } from '@/types/connection'

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

const state = reactive({
  path: '',
  includeData: true,
  dropExisting: false,
  running: false,
  cancelling: false,
  confirmingImport: false,
  finished: false,
})

const isExport = computed(() => props.mode === 'export')
const title = computed(() =>
  isExport.value ? t('导出数据库') : t('导入 SQL 文件')
)
const databaseName = computed(() => {
  if (props.databaseName) return props.databaseName
  const connection = props.connection
  return connection && isDatabaseConnection(connection)
    ? connection.settings.database || connection.name
    : (connection?.name ?? 'database')
})

watch([() => props.open, () => props.mode], ([open]) => {
  if (!open) return

  state.path = ''
  state.includeData = true
  state.dropExisting = false
  state.running = false
  state.cancelling = false
  state.confirmingImport = false
  state.finished = false
})

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
}

function requestRun(): void {
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
  state.running = true
  state.cancelling = false
  state.finished = false

  try {
    if (isExport.value) {
      const result = await database.exportSql(
        props.sessionId,
        state.path,
        state.includeData,
        state.dropExisting
      )
      toast.success({
        title: t('数据库导出完成'),
        description: t(
          '已导出 {value0} 个对象、{value1} 行数据（{value2}），耗时 {value3} ms。',
          {
            value0: result.objects,
            value1: result.rows,
            value2: formatBytes(result.bytes),
            value3: result.elapsedMs,
          }
        ),
      })
    } else {
      const result = await database.importSql(props.sessionId, state.path)
      toast.success({
        title: t('SQL 导入完成'),
        description: t(
          '已执行 {value0} 条 SQL，影响 {value1} 行，耗时 {value2} ms。',
          {
            value0: result.statements,
            value1: result.rowsAffected,
            value2: result.elapsedMs,
          }
        ),
      })
    }
    state.finished = true
    emit('finished', props.mode)
  } catch (error) {
    toast.error({
      title: isExport.value ? t('数据库导出失败') : t('SQL 导入失败'),
      description: database.errorMessage(error),
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
  if (!state.running) emit('close')
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
          <div class="grid gap-3.5">
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
                  <span class="truncate">{{
                    state.path || t('尚未选择文件')
                  }}</span>
                </div>
                <AppButton
                  :disabled="state.running"
                  @click="choosePath"
                >
                  {{ t('浏览…') }}
                </AppButton>
              </div>
            </div>

            <template v-if="isExport">
              <div class="card grid gap-3 px-3 py-2.5">
                <AppCheckbox
                  v-model="state.includeData"
                  :label="t('包含表数据')"
                  :description="
                    t('关闭后只导出表、索引、约束、视图和例程结构。')
                  "
                  :disabled="state.running"
                />
                <AppCheckbox
                  v-model="state.dropExisting"
                  :label="t('导入前删除同名对象')"
                  :description="
                    t('在导出文件中加入表、视图、存储过程和函数的 DROP 语句。')
                  "
                  :disabled="state.running"
                />
              </div>
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
                    'SQL 文件会直接在当前数据库会话中执行，可能创建、修改或删除数据。请确认文件来源可信并已做好备份。'
                  )
                }}
              </span>
            </p>

            <p
              v-if="state.running"
              class="card text-txt-2 flex items-center gap-2 px-3 py-2.5 text-[11px]"
              role="status"
            >
              <AppIcon
                name="lucide:loader-circle"
                :size="14"
                class="text-violet animate-spin"
              />
              {{
                state.cancelling
                  ? t('正在取消导入…')
                  : isExport
                    ? t('正在导出，请稍候…')
                    : t('正在导入，请稍候…')
              }}
            </p>
          </div>

          <template #footer>
            <div class="flex-1" />
            <AppButton
              v-if="state.running && !isExport"
              :disabled="state.cancelling"
              @click="cancelImport"
            >
              {{ state.cancelling ? t('取消中…') : t('取消导入') }}
            </AppButton>
            <AppButton
              v-else
              :disabled="state.running"
              @click="requestClose"
            >
              {{ state.finished ? t('完成') : t('取消') }}
            </AppButton>
            <AppButton
              v-if="!state.finished"
              variant="primary"
              :disabled="state.running"
              @click="requestRun"
            >
              {{
                state.running
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
    :open="state.confirmingImport"
    :title="t('确认导入 SQL')"
    :description="
      t(
        '将执行“{value0}”中的全部 SQL。该操作可能覆盖或删除 {value1} 中的现有数据。',
        { value0: state.path, value1: databaseName }
      )
    "
    :confirm-label="t('确认导入')"
    danger
    @close="state.confirmingImport = false"
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
