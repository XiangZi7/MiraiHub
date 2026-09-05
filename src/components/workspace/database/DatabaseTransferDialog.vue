<script setup lang="ts">
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

export type DatabaseTransferMode = 'export' | 'import'

const props = defineProps<{
  open: boolean
  mode: DatabaseTransferMode
  connection: SavedConnection | null
  sessionId: string
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
const title = computed(() => (isExport.value ? '导出数据库' : '导入 SQL 文件'))
const databaseName = computed(() => {
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
      title: '选择 SQL 导出位置',
      defaultPath: defaultExportName(),
      filters: [{ name: 'SQL 文件', extensions: ['sql'] }],
    })
    if (selected) state.path = selected
    return
  }

  const selected = await openFileDialog({
    title: '选择要导入的 SQL 文件',
    multiple: false,
    directory: false,
    filters: [{ name: 'SQL 文件', extensions: ['sql'] }],
  })
  if (typeof selected === 'string') state.path = selected
}

function requestRun(): void {
  if (!state.path) {
    toast.warning(isExport.value ? '请先选择导出位置' : '请先选择 SQL 文件')
    return
  }
  if (!props.sessionId) {
    toast.error('数据库连接已断开，请重新连接后再试')
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
        title: '数据库导出完成',
        description: `已导出 ${result.objects} 个对象、${result.rows} 行数据（${formatBytes(result.bytes)}），耗时 ${result.elapsedMs} ms。`,
      })
    } else {
      const result = await database.importSql(props.sessionId, state.path)
      toast.success({
        title: 'SQL 导入完成',
        description: `已执行 ${result.statements} 条 SQL，影响 ${result.rowsAffected} 行，耗时 ${result.elapsedMs} ms。`,
      })
    }
    state.finished = true
    emit('finished', props.mode)
  } catch (error) {
    toast.error({
      title: isExport.value ? '数据库导出失败' : 'SQL 导入失败',
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
      title: '取消导入失败',
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
          :description="`${connection?.name ?? '数据库'} · ${databaseName}`"
          @close="requestClose"
        >
          <div class="grid gap-3.5">
            <div class="space-y-1.5">
              <label class="text-txt-2 text-[11px] font-medium">
                {{ isExport ? '保存位置' : 'SQL 文件' }}
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
                    state.path || '尚未选择文件'
                  }}</span>
                </div>
                <AppButton
                  :disabled="state.running"
                  @click="choosePath"
                >
                  浏览…
                </AppButton>
              </div>
            </div>

            <template v-if="isExport">
              <div class="card grid gap-3 px-3 py-2.5">
                <AppCheckbox
                  v-model="state.includeData"
                  label="包含表数据"
                  description="关闭后只导出表、索引、约束、视图和例程结构。"
                  :disabled="state.running"
                />
                <AppCheckbox
                  v-model="state.dropExisting"
                  label="导入前删除同名对象"
                  description="在导出文件中加入表、视图、存储过程和函数的 DROP 语句。"
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
                导出为可再次导入的 SQL
                文件；大表会分页读取，避免一次载入全部数据。
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
              <span
                >SQL
                文件会直接在当前数据库会话中执行，可能创建、修改或删除数据。请确认文件来源可信并已做好备份。</span
              >
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
                  ? '正在取消导入…'
                  : isExport
                    ? '正在导出，请稍候…'
                    : '正在导入，请稍候…'
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
              {{ state.cancelling ? '取消中…' : '取消导入' }}
            </AppButton>
            <AppButton
              v-else
              :disabled="state.running"
              @click="requestClose"
            >
              {{ state.finished ? '完成' : '取消' }}
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
                    ? '导出中…'
                    : '导入中…'
                  : isExport
                    ? '开始导出'
                    : '开始导入'
              }}
            </AppButton>
          </template>
        </AppDialog>
      </div>
    </Transition>
  </Teleport>

  <AppConfirmDialog
    :open="state.confirmingImport"
    title="确认导入 SQL"
    :description="`将执行“${state.path}”中的全部 SQL。该操作可能覆盖或删除 ${databaseName} 中的现有数据。`"
    confirm-label="确认导入"
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
