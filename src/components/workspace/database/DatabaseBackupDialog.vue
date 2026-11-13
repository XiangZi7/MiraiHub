<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import * as database from '@/api/database'
import { toast } from '@/composables/useToast'
import type { DatabaseKind } from '@/types/database'
import type {
  BackupContent,
  BackupProgress,
  BackupRecord,
  BackupResult,
  BackupTools,
} from '@/types/database-ops'
import { cn } from '@/utils/cn'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  databaseName: string
  connectionId: string
  connectionName: string
}>()

const emit = defineEmits<{
  close: []
  /** 没有原生工具时改用自定义导出 */
  export: []
}>()

const HISTORY_LIMIT = 20

const isSqlite = computed(() => props.databaseKind === 'sqlite')
const isMysql = computed(() => props.databaseKind === 'mysql')
const dumpName = computed(() => (isMysql.value ? 'mysqldump' : 'pg_dump'))

// 工具目录按数据库类型分别记住
const toolDir = useStorage(`miraihub:db-backup-tool-dir:${props.databaseKind}`, '')
// 备份历史按连接分组
const history = useStorage<Record<string, BackupRecord[]>>(
  'miraihub:db-backup-history',
  {}
)

type LogTone = 'info' | 'success' | 'error'

const state = reactive({
  detecting: false,
  tools: null as BackupTools | null,
  databases: [] as string[],
  database: props.databaseName,
  /** 备份非当前库时 fork 出来的会话 */
  forkId: '',
  tables: [] as string[],
  tablesLoading: false,
  tableKeyword: '',
  selectedTables: [] as string[],
  content: 'all' as BackupContent,
  path: '',
  running: null as null | 'backup' | 'restore',
  taskId: '',
  builtin: false,
  bytes: 0,
  elapsedMs: 0,
  log: [] as { time: number; text: string; tone: LogTone }[],
  restoreTarget: null as null | { path: string; database: string },
})

let unlisten: UnlistenFn | null = null

const records = computed(() => history.value[props.connectionId] ?? [])
const hasDump = computed(() => isSqlite.value || !!state.tools?.dump)
const targetSessionId = computed(() => state.forkId || props.sessionId)

const databaseOptions = computed(() =>
  (state.databases.length ? state.databases : [props.databaseName]).map(
    name => ({ value: name, label: name })
  )
)

const contentOptions = computed<{ value: BackupContent; label: string }[]>(
  () => [
    { value: 'all', label: t('结构和数据') },
    { value: 'structure', label: t('仅结构') },
    { value: 'data', label: t('仅数据') },
  ]
)

const filteredTables = computed(() => {
  const keyword = state.tableKeyword.trim().toLowerCase()
  return keyword
    ? state.tables.filter(name => name.toLowerCase().includes(keyword))
    : state.tables
})

/** 追加一行带时间的日志 */
function log(text: string, tone: LogTone = 'info'): void {
  state.log.push({ time: Date.now(), text, tone })
}

/** 探测原生备份工具；目录变化或手动重试时调用 */
async function detect(): Promise<void> {
  if (isSqlite.value) return
  state.detecting = true
  try {
    state.tools = await database.detectBackupTools(
      props.sessionId,
      toolDir.value
    )
    if (!state.tools.dump) state.selectedTables = []
  } catch (error) {
    state.tools = null
    toast.error({
      title: t('检测备份工具失败'),
      description: database.errorMessage(error),
    })
  } finally {
    state.detecting = false
  }
}

/** 选择 mysqldump/pg_dump 所在目录并重新检测 */
async function pickToolDir(): Promise<void> {
  const picked = await open({ directory: true, multiple: false })
  if (typeof picked !== 'string') return
  toolDir.value = picked
  await detect()
}

/** 释放为其他库 fork 的会话 */
async function releaseFork(): Promise<void> {
  const id = state.forkId
  state.forkId = ''
  if (id) await database.disconnect(id).catch(() => undefined)
}

/** 读取目标库的表清单；MySQL 选了其他库时先 fork 会话 */
async function loadTables(): Promise<void> {
  if (isSqlite.value) return
  state.tablesLoading = true
  state.selectedTables = []
  try {
    await releaseFork()
    if (state.database !== props.databaseName) {
      const forked = await database.forkSession(props.sessionId, state.database)
      state.forkId = forked.sessionId
    }
    const objects = await database.listObjects(targetSessionId.value)
    state.tables = objects
      .filter(item => item.kind === 'table')
      .map(item => (isMysql.value ? item.name : `${item.schema}.${item.name}`))
  } catch (error) {
    state.tables = []
    toast.error({
      title: t('读取表清单失败'),
      description: database.errorMessage(error),
    })
  } finally {
    state.tablesLoading = false
  }
}

watch(
  () => state.database,
  () => {
    state.path = ''
    void loadTables()
  }
)

onMounted(async () => {
  void detect()
  if (isMysql.value)
    state.databases = await database
      .listDatabases(props.sessionId)
      .catch(() => [])
  void loadTables()
  unlisten = await listen<BackupProgress>('db-backup-progress', event => {
    if (event.payload.taskId !== state.taskId) return
    state.bytes = event.payload.bytes
    state.elapsedMs = event.payload.elapsedMs
  })
})

onBeforeUnmount(() => {
  unlisten?.()
  void releaseFork()
})

/** 勾选/取消一张表 */
function toggleTable(name: string, checked: boolean): void {
  state.selectedTables = checked
    ? [...state.selectedTables, name]
    : state.selectedTables.filter(item => item !== name)
}

/** 全选或清空当前过滤结果 */
function toggleAllTables(): void {
  const visible = filteredTables.value
  const allSelected = visible.every(name => state.selectedTables.includes(name))
  state.selectedTables = allSelected
    ? state.selectedTables.filter(name => !visible.includes(name))
    : [...new Set([...state.selectedTables, ...visible])]
}

/** 生成带时间戳的默认文件名 */
function defaultFileName(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = (state.database || props.connectionName || 'backup').replace(
    /[\\/:*?"<>|]/g,
    '_'
  )
  return `${base}-${stamp}.${isSqlite.value ? 'db' : 'sql'}`
}

/** 选择备份文件的保存位置 */
async function pickOutput(): Promise<boolean> {
  const picked = await save({
    defaultPath: state.path || defaultFileName(),
    filters: isSqlite.value
      ? [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }]
      : [{ name: 'SQL', extensions: ['sql'] }],
  })
  if (!picked) return false
  state.path = picked
  return true
}

/** 记录一次成功的备份，超出上限时丢弃最旧的 */
function remember(result: BackupResult): void {
  const record: BackupRecord = {
    id: crypto.randomUUID(),
    path: result.path,
    database: state.database,
    bytes: result.bytes,
    elapsedMs: result.elapsedMs,
    method: result.method,
    content: state.content,
    tables: state.selectedTables.length,
    createdAt: Date.now(),
  }
  history.value = {
    ...history.value,
    [props.connectionId]: [record, ...records.value].slice(0, HISTORY_LIMIT),
  }
}

/** 执行备份：有原生工具用工具，否则走内置导出；SQLite 直接复制文件 */
async function startBackup(): Promise<void> {
  if (state.running) return
  if (!state.path && !(await pickOutput())) return
  const builtin = !isSqlite.value && !state.tools?.dump
  if (builtin && state.selectedTables.length) {
    toast.warning(t('内置导出不支持按表备份，请清空表选择或配置备份工具'))
    return
  }
  Object.assign(state, {
    running: 'backup',
    taskId: crypto.randomUUID(),
    builtin,
    bytes: 0,
    elapsedMs: 0,
    log: [],
    restoreTarget: null,
  })
  log(
    isSqlite.value
      ? t('复制数据库文件到 {path}', { path: state.path })
      : builtin
        ? t('未找到 {tool}，使用内置导出', { tool: dumpName.value })
        : t('使用 {tool} 备份 {db}', {
            tool: state.tools?.dump?.version || dumpName.value,
            db: state.database,
          })
  )
  try {
    const result = await database.backupDatabase({
      sessionId: targetSessionId.value,
      path: state.path,
      taskId: state.taskId,
      toolDir: toolDir.value.trim() || undefined,
      content: isSqlite.value ? undefined : state.content,
      tables: state.selectedTables,
    })
    if (result.message) log(result.message)
    log(
      t('备份完成：{size}，耗时 {seconds} 秒', {
        size: formatBytes(result.bytes),
        seconds: (result.elapsedMs / 1000).toFixed(1),
      }),
      'success'
    )
    remember(result)
    toast.success(t('备份完成'))
    state.path = ''
  } catch (error) {
    const message = database.errorMessage(error)
    log(message, 'error')
    toast.error({ title: t('备份失败'), description: message })
  } finally {
    state.running = null
  }
}

/** 取消正在进行的任务；内置导出无法中途取消 */
async function cancelTask(): Promise<void> {
  if (!state.taskId) return
  const done = await database.cancelBackup(state.taskId).catch(() => false)
  log(done ? t('已请求取消') : t('任务无法取消'), done ? 'info' : 'error')
}

/** 选择一个 SQL 文件作为恢复来源 */
async function pickRestoreFile(): Promise<void> {
  const picked = await open({
    multiple: false,
    filters: [{ name: 'SQL', extensions: ['sql'] }],
  })
  if (typeof picked !== 'string') return
  state.restoreTarget = { path: picked, database: props.databaseName }
}

/** 恢复前先展示确认条，避免误点 */
function askRestore(record: BackupRecord): void {
  state.restoreTarget = { path: record.path, database: record.database }
}

/** 执行恢复：MySQL 恢复到记录所属的库，其余恢复到当前库 */
async function confirmRestore(): Promise<void> {
  const target = state.restoreTarget
  if (!target || state.running) return
  Object.assign(state, {
    running: 'restore',
    taskId: crypto.randomUUID(),
    builtin: !state.tools?.client,
    bytes: 0,
    elapsedMs: 0,
    log: [],
    restoreTarget: null,
  })
  let forkId = ''
  try {
    const restoreDb = isMysql.value ? target.database : props.databaseName
    if (isMysql.value && restoreDb && restoreDb !== props.databaseName)
      forkId = (await database.forkSession(props.sessionId, restoreDb))
        .sessionId
    log(t('恢复 {path} 到 {db}', { path: target.path, db: restoreDb }))
    const result = await database.restoreBackup({
      sessionId: forkId || props.sessionId,
      path: target.path,
      taskId: state.taskId,
      toolDir: toolDir.value.trim() || undefined,
    })
    if (result.message) log(result.message)
    log(
      t('恢复完成，耗时 {seconds} 秒', {
        seconds: (result.elapsedMs / 1000).toFixed(1),
      }),
      'success'
    )
    toast.success(t('恢复完成'))
  } catch (error) {
    const message = database.errorMessage(error)
    log(message, 'error')
    toast.error({ title: t('恢复失败'), description: message })
  } finally {
    if (forkId) await database.disconnect(forkId).catch(() => undefined)
    state.running = null
  }
}

/** 在系统文件管理器里定位备份文件 */
async function reveal(path: string): Promise<void> {
  try {
    await revealItemInDir(path)
  } catch (error) {
    toast.error({ title: t('无法打开所在文件夹'), description: String(error) })
  }
}

/** 从历史中移除一条记录（不删除文件） */
function forget(id: string): void {
  history.value = {
    ...history.value,
    [props.connectionId]: records.value.filter(record => record.id !== id),
  }
}

/** 任务进行中不允许关闭对话框 */
function requestClose(): void {
  if (state.running) {
    toast.info(t('任务进行中，请先取消或等待完成'))
    return
  }
  if (state.restoreTarget) {
    state.restoreTarget = null
    return
  }
  emit('close')
}

/** 备份内容的简短说明 */
function contentLabel(content: BackupContent): string {
  return contentOptions.value.find(item => item.value === content)?.label ?? ''
}
</script>

<template>
  <AppDialog
    wide
    :title="t('备份与恢复')"
    :description="
      isSqlite
        ? t('复制一份一致的数据库文件副本')
        : t('使用 {tool} 生成 SQL 备份，可随时恢复', { tool: dumpName })
    "
    @close="requestClose"
  >
    <div class="space-y-4">
      <!-- 备份工具 -->
      <section
        v-if="!isSqlite"
        class="space-y-2"
      >
        <div
          :class="
            cn(
              'flex items-start gap-2 rounded-md border px-3 py-2 text-[11.5px]',
              state.tools?.dump
                ? 'border-success/25 bg-success/8 text-success'
                : 'border-amber/25 bg-amber/8 text-amber'
            )
          "
        >
          <AppIcon
            :name="
              state.detecting
                ? 'lucide:loader-circle'
                : state.tools?.dump
                  ? 'lucide:circle-check'
                  : 'lucide:triangle-alert'
            "
            :size="13"
            :class="
              cn('mt-px shrink-0', state.detecting && 'motion-safe:animate-spin')
            "
          />
          <div class="min-w-0 flex-1 leading-4">
            <template v-if="state.detecting">{{ t('正在检测…') }}</template>
            <template v-else-if="state.tools?.dump">
              <p class="truncate">{{ state.tools.dump.version }}</p>
              <p class="text-txt-4 truncate font-mono text-[10.5px]">
                {{ state.tools.dump.path }}
              </p>
            </template>
            <template v-else>
              {{
                t('未找到 {tool}，将使用内置导出（不支持按表备份）', {
                  tool: dumpName,
                })
              }}
            </template>
          </div>
          <AppButton
            v-if="!state.detecting && !state.tools?.dump"
            size="sm"
            variant="ghost"
            class="shrink-0"
            @click="emit('export')"
          >
            {{ t('自定义导出…') }}
          </AppButton>
        </div>
        <div class="flex items-end gap-2">
          <div class="min-w-0 flex-1">
            <AppTextField
              v-model="toolDir"
              :label="t('工具目录（可选）')"
              :placeholder="t('留空时从 PATH 和常见安装位置查找')"
              action-icon="lucide:folder-open"
              :action-title="t('选择目录')"
              @action="pickToolDir"
              @blur="detect"
            />
          </div>
          <AppButton
            size="sm"
            class="mb-0.5"
            :disabled="state.detecting"
            @click="detect"
          >
            {{ t('重新检测') }}
          </AppButton>
        </div>
      </section>

      <!-- 范围 -->
      <section
        v-if="!isSqlite"
        class="space-y-2"
      >
        <div class="flex items-end gap-3">
          <div class="w-52 shrink-0">
            <AppSelect
              icon="lucide:database"
              v-model="state.database"
              :label="t('数据库')"
              :options="databaseOptions"
              :disabled="!isMysql || !!state.running"
              searchable
            />
          </div>
          <div
            class="bg-pane flex h-[34px] items-center gap-0.5 rounded-md px-1"
            role="radiogroup"
            :aria-label="t('备份内容')"
          >
            <button
              v-for="option in contentOptions"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="state.content === option.value"
              :class="cn('seg', state.content === option.value && 'seg-active')"
              :disabled="!!state.running"
              @click="state.content = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="border-line-soft rounded-md border">
          <div class="border-line-soft flex items-center gap-2 border-b p-1.5">
            <div class="min-w-0 flex-1">
              <SearchField
                v-model="state.tableKeyword"
                :placeholder="t('筛选表…')"
              />
            </div>
            <span class="text-txt-4 shrink-0 text-[11px]">{{
              state.selectedTables.length
                ? t('已选 {count} 张表', { count: state.selectedTables.length })
                : t('不选即备份全部表')
            }}</span>
            <AppButton
              size="sm"
              variant="ghost"
              :disabled="!hasDump || !filteredTables.length"
              @click="toggleAllTables"
            >
              {{ t('全选/清空') }}
            </AppButton>
          </div>
          <div
            :class="
              cn(
                'scroll-thin grid max-h-40 grid-cols-2 gap-x-3 gap-y-0.5 overflow-y-auto p-2',
                state.tablesLoading && 'stale-dim'
              )
            "
          >
            <AppCheckbox
              v-for="name in filteredTables"
              :key="name"
              :model-value="state.selectedTables.includes(name)"
              :label="name"
              :disabled="!hasDump || !!state.running"
              @update:model-value="toggleTable(name, $event)"
            />
            <p
              v-if="!filteredTables.length && !state.tablesLoading"
              class="text-txt-4 col-span-2 py-3 text-center text-xs"
            >
              {{ t('没有表') }}
            </p>
          </div>
        </div>
      </section>

      <!-- 输出 -->
      <AppTextField
        v-model="state.path"
        :label="t('保存到')"
        :placeholder="defaultFileName()"
        action-icon="lucide:folder-open"
        :action-title="t('选择保存位置')"
        :disabled="!!state.running"
        @action="pickOutput"
      />

      <!-- 进度与日志 -->
      <section
        v-if="state.running || state.log.length"
        class="border-line-soft bg-pane relative overflow-hidden rounded-md border"
      >
        <div
          v-if="state.running"
          class="progress-indeterminate"
        />
        <div
          v-if="state.running"
          class="text-txt-2 flex items-center gap-2 px-3 pt-2.5 text-[11.5px]"
        >
          <AppIcon
            name="lucide:loader-circle"
            :size="13"
            class="text-accent motion-safe:animate-spin"
          />
          <span>{{
            state.running === 'backup' ? t('正在备份…') : t('正在恢复…')
          }}</span>
          <span
            v-if="state.bytes"
            class="text-txt-3 font-mono tabular-nums"
            >{{ formatBytes(state.bytes) }} ·
            {{ (state.elapsedMs / 1000).toFixed(0) }} s</span
          >
        </div>
        <ol
          class="scroll-thin max-h-32 space-y-0.5 overflow-y-auto px-3 py-2 font-mono text-[10.5px] leading-4"
        >
          <li
            v-for="(entry, index) in state.log"
            :key="index"
            :class="
              cn(
                'flex gap-2 break-all',
                entry.tone === 'error'
                  ? 'text-danger'
                  : entry.tone === 'success'
                    ? 'text-success'
                    : 'text-txt-3'
              )
            "
          >
            <span class="text-txt-4 shrink-0">{{
              new Date(entry.time).toLocaleTimeString()
            }}</span>
            <span class="min-w-0">{{ entry.text }}</span>
          </li>
        </ol>
      </section>

      <!-- 恢复确认条 -->
      <Transition name="slide-up">
        <div
          v-if="state.restoreTarget"
          class="border-danger/30 bg-danger/8 flex items-start gap-2 rounded-md border px-3 py-2.5"
        >
          <AppIcon
            name="lucide:triangle-alert"
            :size="14"
            class="text-danger mt-0.5 shrink-0"
          />
          <div class="min-w-0 flex-1 text-[11.5px] leading-4">
            <p class="text-danger font-medium">
              {{
                t('将在 {db} 上执行该备份中的全部 SQL', {
                  db: isMysql
                    ? state.restoreTarget.database || databaseName
                    : databaseName,
                })
              }}
            </p>
            <p class="text-txt-3 mt-0.5 font-mono text-[10.5px] break-all">
              {{ state.restoreTarget.path }}
            </p>
            <p class="text-txt-3 mt-0.5">
              {{ t('同名表可能被删除重建，现有数据会被覆盖。') }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <AppButton
              size="sm"
              @click="state.restoreTarget = null"
            >
              {{ t('取消') }}
            </AppButton>
            <AppButton
              size="sm"
              variant="danger"
              @click="confirmRestore"
            >
              {{ t('恢复') }}
            </AppButton>
          </div>
        </div>
      </Transition>

      <!-- 历史 -->
      <section>
        <div class="mb-1.5 flex items-center">
          <p class="group-label flex-1 px-0">{{ t('备份历史') }}</p>
          <AppButton
            v-if="!isSqlite"
            size="sm"
            variant="ghost"
            :disabled="!!state.running"
            @click="pickRestoreFile"
          >
            <AppIcon
              name="lucide:file-up"
              :size="13"
            />
            {{ t('从文件恢复…') }}
          </AppButton>
        </div>
        <p
          v-if="!records.length"
          class="text-txt-4 py-2 text-xs"
        >
          {{ t('还没有备份记录') }}
        </p>
        <ul
          v-else
          class="space-y-1"
        >
          <li
            v-for="record in records"
            :key="record.id"
            class="row-item group h-auto py-1.5"
          >
            <AppIcon
              name="lucide:file-archive"
              :size="14"
              class="text-txt-3 shrink-0"
            />
            <div class="min-w-0 flex-1">
              <p
                class="text-txt-2 truncate font-mono text-[11px]"
                :title="record.path"
              >
                {{ record.path.split(/[\\/]/).pop() }}
              </p>
              <p class="text-txt-4 truncate text-[10.5px]">
                {{ new Date(record.createdAt).toLocaleString() }} ·
                {{ record.database }} · {{ formatBytes(record.bytes) }}
                <template v-if="record.method !== 'copy'">
                  · {{ contentLabel(record.content) }}
                  <template v-if="record.tables">
                    · {{ t('{count} 张表', { count: record.tables }) }}
                  </template>
                  <template v-if="record.method === 'builtin'">
                    · {{ t('内置导出') }}
                  </template>
                </template>
              </p>
            </div>
            <IconButton
              icon="lucide:folder-search"
              :size="13"
              :title="t('打开所在文件夹')"
              @click="reveal(record.path)"
            />
            <IconButton
              v-if="record.method !== 'copy'"
              icon="lucide:history"
              :size="13"
              :title="t('恢复')"
              :disabled="!!state.running"
              @click="askRestore(record)"
            />
            <IconButton
              icon="lucide:x"
              :size="13"
              :title="t('从历史中移除')"
              @click="forget(record.id)"
            />
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <span class="text-txt-4 min-w-0 flex-1 truncate text-[11px]">{{
        connectionName
      }}</span>
      <AppButton
        v-if="state.running"
        size="sm"
        :disabled="state.builtin"
        :title="state.builtin ? t('内置导出无法中途取消') : ''"
        @click="cancelTask"
      >
        {{ t('取消任务') }}
      </AppButton>
      <AppButton
        v-else
        size="sm"
        @click="requestClose"
      >
        {{ t('关闭') }}
      </AppButton>
      <AppButton
        size="sm"
        variant="primary"
        :disabled="!!state.running || state.detecting"
        @click="startBackup"
      >
        <AppIcon
          name="lucide:database-backup"
          :size="13"
        />
        {{ t('开始备份') }}
      </AppButton>
    </template>
  </AppDialog>
</template>
