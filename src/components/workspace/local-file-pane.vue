<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useI18n } from 'vue-i18n'
import {
  copyLocalEntries,
  listLocalDirectory,
  openLocalFile,
  type LocalListing,
} from '@/api/workspace-files'
import { errorMessage } from '@/api/ssh'
import { translateNativeMessage } from '@/i18n/native'
import { useFileTransfers } from '@/composables/useFileTransfers'
import { useNativeFileDrop } from '@/composables/useNativeFileDrop'
import { toast } from '@/composables/useToast'
import { useSettings } from '@/composables/useSettings'
import IconButton from '@/components/ui/IconButton.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import RemoteFileList from '@/components/workspace/RemoteFileList.vue'
import FileBrowserControls from '@/components/workspace/file-browser-controls.vue'
import FileConflictDialog from '@/components/workspace/FileConflictDialog.vue'
import FileDropOverlay from '@/components/workspace/file-drop-overlay.vue'
import DirectorySyncDialog from '@/components/workspace/directory-sync-dialog.vue'
import type { FilePaneDrop } from '@/components/workspace/useFilePaneDrag'
import type { SshDirectoryListing, SshRemoteFile } from '@/types/ssh'
const props = defineProps<{
  sessionId: string
  remotePath?: string
  initialPath?: string
}>()
const emit = defineEmits<{
  upload: [paths: string[]]
  refreshed: []
}>()
const transferMode = computed(() => props.remotePath !== undefined)
const { t } = useI18n()
const transfers = useFileTransfers()
const { settings } = useSettings()
const state = reactive({
  listing: null as LocalListing | null,
  path: '',
  loading: false,
  syncing: false,
  filter: '',
  selected: '',
  selection: [] as string[],
  history: [] as string[],
  historyIndex: -1,
  conflictOpen: false,
  conflictName: '',
  conflictRemaining: 0,
  conflictAlways: false,
})
const { listing, path, loading, syncing } = toRefs(state)
const dropZone = useTemplateRef<HTMLElement>('dropZone')
const { isDragging } = useNativeFileDrop(
  computed(() => (state.listing && !state.loading ? dropZone.value : null)),
  copyDroppedFiles
)
let generation = 0
let disposed = false
let pendingDownloads = Promise.resolve()
let conflictResolver:
  ((action: 'overwrite' | 'skip' | 'cancel') => void) | undefined
/** 将本地列表转为双栏共用的只读目录项，地址补全和文件列表使用相同路径来源。 */
function localEntries(listing: LocalListing | null): SshRemoteFile[] {
  return (listing?.entries ?? []).map(entry => ({
    ...entry,
    kind: entry.directory ? 'directory' : 'file',
    permissions: '',
    owner: '',
    group: '',
    linkTarget: null,
  }))
}
const entries = computed(() => localEntries(state.listing))

/** 地址栏读取实际父目录但不导航，支持跨盘符、UNC 和多级路径补齐。 */
async function listPathDirectory(
  directory: string
): Promise<SshDirectoryListing> {
  const listing = await listLocalDirectory(directory)
  return { path: listing.path, entries: localEntries(listing) }
}
const visibleEntries = computed(() =>
  entries.value.filter(
    file =>
      (settings.showHiddenFiles || !file.name.startsWith('.')) &&
      file.name
        .toLocaleLowerCase()
        .includes(state.filter.trim().toLocaleLowerCase())
  )
)
// 筛选或隐藏文件开关变化后撤销不可见项，避免上传用户已经看不到的旧选择。
watch(visibleEntries, files => {
  const visible = new Set(files.map(file => file.path))
  state.selection = state.selection.filter(path => visible.has(path))
  if (!visible.has(state.selected))
    state.selected = state.selection.at(-1) ?? ''
})
/** 浏览本地目录并丢弃过期响应，默认使用系统桌面。 */
async function load(
  path = '',
  history = true,
  preserveView = false
): Promise<void> {
  const token = ++generation
  state.loading = !preserveView
  try {
    const result = await listLocalDirectory(path)
    if (disposed || token !== generation) return
    state.listing = result
    state.path = result.path
    if (!preserveView) {
      state.filter = ''
      selectFiles([], '')
    }
    if (history && state.history[state.historyIndex] !== result.path) {
      state.history.splice(state.historyIndex + 1)
      state.history.push(result.path)
      state.historyIndex = state.history.length - 1
    }
  } catch (error) {
    if (!disposed && token === generation)
      toast.error({ title: t('读取本地目录失败'), description: String(error) })
  } finally {
    if (token === generation) state.loading = false
  }
}
/** 拖放时固定目标目录；后台复制完成后只更新仍在浏览的列表。 */
async function copyDroppedFiles(paths: string[]): Promise<void> {
  const directory = state.listing?.path
  if (!directory || state.loading) return
  try {
    const { copied, failed } = await copyLocalEntries(paths, directory)
    if (disposed) return
    if (failed.length) {
      const first = failed[0]
      toast.error({
        title: t('已复制 {copied} 项，{failed} 项失败', {
          copied: copied.length,
          failed: failed.length,
        }),
        description: `${first.path} · ${translateNativeMessage(first.message)}`,
      })
    } else {
      toast.success({
        title: t('files.copiedCount', { count: copied.length }),
        description: directory,
      })
    }
    if (copied.length && state.path === directory && !state.loading)
      await load(directory, false, true)
  } catch (error) {
    if (!disposed)
      toast.error({
        title: t('复制失败'),
        description: translateNativeMessage(errorMessage(error)),
      })
  }
}
/** 本地目录前进后退不重复写入历史。 */
async function navigateHistory(delta: number): Promise<void> {
  const next = state.historyIndex + delta
  if (!state.history[next] || state.loading) return
  await load(state.history[next], false)
  if (state.path === state.history[next]) state.historyIndex = next
}
/** 通过原生选择器跨盘符选择目录。 */
async function chooseDirectory(): Promise<void> {
  try {
    const result = await open({ directory: true, multiple: false })
    if (!disposed && typeof result === 'string') await load(result)
  } catch (error) {
    toast.error(String(error))
  }
}
/** 两栏共用同一套 Ctrl、Shift、键盘和框选逻辑。 */
function selectFiles(paths: string[], focus: string): void {
  state.selection = paths
  state.selected = focus
}
/** 双击或按 Enter 进入目录，在本地终端的文件面板中用系统默认应用打开文件。 */
async function openFile(file: SshRemoteFile): Promise<void> {
  if (file.kind === 'directory') {
    await load(file.path)
  } else if (transferMode.value) {
    emit('upload', [file.path])
  } else {
    try {
      await openLocalFile(file.path)
    } catch (error) {
      toast.error({
        title: t('打开文件失败'),
        description: translateNativeMessage(errorMessage(error)),
      })
    }
  }
}
/** 完成同名冲突决策，卸载面板时也会取消等待。 */
function settleConflict(action: 'overwrite' | 'skip' | 'cancel'): void {
  const resolve = conflictResolver
  conflictResolver = undefined
  state.conflictOpen = false
  resolve?.(action)
}
/** 下载按批次排队，使用拖放时的目录快照，不随浏览目录变化。 */
async function downloadBatch(detail: FilePaneDrop): Promise<void> {
  const directory = detail.directory
  const snapshot = await listLocalDirectory(directory)
  const names = new Set(
    snapshot.entries.map(entry => entry.name.toLocaleLowerCase())
  )
  let policy: 'overwrite' | 'skip' | undefined
  for (const [index, file] of detail.files.entries()) {
    if (disposed) break
    if (
      !file.name ||
      /[\\/:<>"|?*\u0000-\u001f]/u.test(file.name) ||
      file.name === '.' ||
      file.name === '..'
    )
      continue
    let name = file.name
    let overwrite = false
    if (names.has(name.toLocaleLowerCase())) {
      if (settings.overwriteBehavior === 'rename') {
        const dot = file.kind === 'directory' ? -1 : name.lastIndexOf('.')
        const base = dot > 0 ? name.slice(0, dot) : name
        const ext = dot > 0 ? name.slice(dot) : ''
        let count = 1
        while (names.has(name.toLocaleLowerCase()))
          name = `${base} (${count++})${ext}`
      } else {
        let action: 'overwrite' | 'skip' | 'cancel' =
          settings.overwriteBehavior === 'overwrite'
            ? 'overwrite'
            : (policy ?? 'cancel')
        if (settings.overwriteBehavior !== 'overwrite' && !policy) {
          state.conflictName = file.name
          state.conflictRemaining = detail.files.length - index - 1
          state.conflictAlways = false
          state.conflictOpen = true
          action = await new Promise(resolve => {
            conflictResolver = resolve
          })
          if (state.conflictAlways && action !== 'cancel') policy = action
        }
        if (action === 'cancel' || disposed) break
        if (action === 'skip') continue
        overwrite = true
      }
    }
    names.add(name.toLocaleLowerCase())
    await transfers.download({
      sessionId: detail.sessionId,
      remotePath: file.path,
      localPath: `${directory}/${name}`,
      overwrite,
    })
  }
  if (!disposed && state.listing?.path === directory)
    await load(directory, false)
}
/** 只接收同会话另一侧的文件，批次异常交给公共通知。 */
function receiveDrop(event: Event): void {
  const detail = (event as CustomEvent<FilePaneDrop>).detail
  if (
    !transferMode.value ||
    detail.source !== 'remote' ||
    detail.sessionId !== props.sessionId ||
    detail.directory !== state.listing?.path
  )
    return
  pendingDownloads = pendingDownloads
    .then(() => (disposed ? undefined : downloadBatch(detail)))
    .catch(error => {
      if (!disposed) toast.error(String(error))
    })
}
/** 同步完成后刷新双端列表。 */
function syncCompleted(): void {
  void load(state.path, false)
  emit('refreshed')
}
onMounted(() => void load(props.initialPath?.trim() || ''))
// 本地连接的配置工作目录变更后，同步文件面板的起点。
watch(
  () => props.initialPath,
  path => {
    if (!transferMode.value) void load(path?.trim() || '')
  }
)
onBeforeUnmount(() => {
  disposed = true
  generation += 1
  settleConflict('cancel')
})
</script>
<template>
  <section
    ref="dropZone"
    class="file-pane border-line relative flex min-h-0 min-w-0 flex-1 flex-col"
    :class="{ 'border-r': transferMode }"
    :data-file-drop-target="transferMode ? 'local' : undefined"
    :data-file-session-id="sessionId"
    :data-file-directory="listing?.path"
    @mirai-file-drop="receiveDrop"
    @dragover.prevent.stop
    @drop.prevent.stop
  >
    <header
      class="scroll-none border-line-soft flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2"
    >
      <IconButton
        icon="lucide:house"
        :size="14"
        :title="t('桌面')"
        :disabled="loading"
        @click="load('')"
      />
      <IconButton
        icon="lucide:arrow-left"
        :size="14"
        :title="t('后退')"
        :disabled="loading || state.historyIndex <= 0"
        @click="navigateHistory(-1)"
      />
      <IconButton
        icon="lucide:arrow-right"
        :size="14"
        :title="t('前进')"
        :disabled="loading || state.historyIndex >= state.history.length - 1"
        @click="navigateHistory(1)"
      />
      <IconButton
        icon="lucide:arrow-up"
        :size="14"
        :title="t('上一级')"
        :disabled="loading || !listing?.parent"
        @click="load(listing?.parent || '')"
      />
      <span
        v-if="transferMode"
        class="text-txt-3 min-w-0 flex-1 truncate px-1 text-[11px]"
        >{{ t('本地文件') }}</span
      >
      <div
        v-else
        class="flex-1"
      />
      <IconButton
        icon="lucide:folder-open"
        :size="14"
        :title="t('选择本地目录')"
        @click="chooseDirectory"
      />
      <IconButton
        v-if="transferMode"
        icon="lucide:upload"
        :size="14"
        :title="t('上传选中文件')"
        :disabled="!state.selection.length || !sessionId"
        @click="emit('upload', state.selection.slice())"
      />
      <IconButton
        v-if="transferMode"
        icon="lucide:folder-sync"
        :size="14"
        :title="t('目录同步')"
        :disabled="!listing || !sessionId || !remotePath"
        @click="syncing = true"
      />
      <IconButton
        icon="lucide:rotate-cw"
        :size="14"
        :title="t('刷新')"
        :disabled="loading"
        @click="load(path, false)"
      />
    </header>
    <FileBrowserControls
      v-model:filter="state.filter"
      :path="path"
      :entries="entries"
      :connected="Boolean(listing)"
      :loading="loading"
      :show-hidden="settings.showHiddenFiles"
      :list-directory="listPathDirectory"
      local
      @navigate="load"
    />
    <RemoteFileList
      :files="loading ? [] : visibleEntries"
      :drag-session-id="sessionId || undefined"
      :selected="state.selected"
      :selection="state.selection"
      local
      @select="selectFiles"
      @open="openFile"
    >
      <AppSkeleton
        v-if="loading"
        :rows="8"
      />
      <AppEmptyState
        v-else-if="!visibleEntries.length"
        compact
        icon="lucide:folder-open"
        :title="state.filter ? t('没有匹配的文件') : t('这个目录是空的')"
      />
    </RemoteFileList>
    <FileDropOverlay
      :active="isDragging && !loading"
      :directory="path"
      local
    />
    <div
      v-if="state.selection.length"
      class="border-line-soft text-txt-3 shrink-0 border-t px-3 py-1 text-[11px]"
    >
      {{ t('已选择 {count} 项', { count: state.selection.length }) }}
    </div>
    <FileConflictDialog
      v-if="transferMode"
      v-model:always="state.conflictAlways"
      :open="state.conflictOpen"
      :file-name="state.conflictName"
      :remaining="state.conflictRemaining"
      local
      @overwrite="settleConflict('overwrite')"
      @skip="settleConflict('skip')"
      @cancel="settleConflict('cancel')"
    />
    <Teleport to="body"
      ><DirectorySyncDialog
        v-if="syncing && listing && remotePath"
        :session-id="sessionId"
        :local-path="listing.path"
        :remote-path="remotePath"
        @close="syncing = false"
        @complete="syncCompleted"
    /></Teleport>
  </section>
</template>
