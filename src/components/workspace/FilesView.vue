<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  reactive,
  shallowRef,
  toRef,
  useTemplateRef,
  watch,
} from 'vue'
import { useClipboard } from '@vueuse/core'
import {
  open as openFileDialog,
  save as saveFileDialog,
} from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import * as ssh from '@/api/ssh'
import { useFileTransfers } from '@/composables/useFileTransfers'
import { useNativeFileDrop } from '@/composables/useNativeFileDrop'
import { useRemoteEditor } from '@/composables/useRemoteEditor'
import { useRemoteFiles } from '@/composables/useRemoteFiles'
import { useRemoteUploads } from '@/composables/useRemoteUploads'
import { useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import type { ContextMenuItem } from '@/types/context-menu'
import type { SshRemoteFile } from '@/types/ssh'
import { scheduleClipboardClear } from '@/utils/clipboard'
import FileConflictDialog from './FileConflictDialog.vue'
import RemoteFileRenameDialog from './RemoteFileRenameDialog.vue'
import RemoteFileList from './RemoteFileList.vue'
import RemotePathInput from './RemotePathInput.vue'

const { t } = useI18n()

const { settings } = useSettings()

const props = withDefaults(
  defineProps<{
    sessionId: string
    connectionName?: string
  }>(),
  {
    connectionName: '',
  }
)

const {
  path,
  entries,
  sortedEntries,
  loading,
  error,
  selected,
  canGoBack,
  canGoForward,
  load,
  enter,
  goUp,
  goBack,
  goForward,
  refresh,
} = useRemoteFiles(toRef(props, 'sessionId'))

const { save: saveSettings } = useSettings()
const filterText = shallowRef('')
function toggleHidden(): void {
  saveSettings({ ...settings, showHiddenFiles: !settings.showHiddenFiles })
}
const transfers = useFileTransfers()
const editor = useRemoteEditor()
const dropZone = useTemplateRef<HTMLElement>('dropZone')
const browserDragging = shallowRef(false)
const state = reactive({
  menuOpen: false,
  menuX: 0,
  menuY: 0,
  menuFile: null as SshRemoteFile | null,
  pendingDelete: null as SshRemoteFile | null,
  renaming: null as SshRemoteFile | null,
})

const {
  conflictOpen,
  conflictFileName,
  conflictRemaining,
  conflictAlways,
  settleConflict,
  uploadPaths,
} = useRemoteUploads({
  context: () => ({
    sessionId: props.sessionId,
    connectionName: props.connectionName,
    directory: path.value,
  }),
  refresh,
})

const { isDragging: nativeDragging } = useNativeFileDrop(
  dropZone,
  paths => void uploadPaths(paths)
)
const dropActive = computed(() => nativeDragging.value || browserDragging.value)
const connected = computed(() => Boolean(props.sessionId))
const selectedFile = computed(() =>
  entries.value.find(file => file.path === selected.value)
)
const pathEntries = computed(() =>
  sortedEntries.value.filter(
    file => settings.showHiddenFiles || !file.name.startsWith('.')
  )
)
const visibleEntries = computed(() => {
  const query = filterText.value.trim().toLocaleLowerCase()
  return query
    ? pathEntries.value.filter(file =>
        file.name.toLocaleLowerCase().includes(query)
      )
    : pathEntries.value
})
watch(
  () => props.sessionId,
  () => {
    filterText.value = ''
  }
)
const pathClip = useClipboard({ copiedDuring: 1600 })

watch(visibleEntries, files => {
  if (selected.value && !files.some(file => file.path === selected.value))
    selected.value = ''
})

watch(error, message => {
  if (message)
    toast.error({ title: t('读取远端文件失败'), description: message })
})

async function copyPath(): Promise<void> {
  await pathClip.copy(path.value)
  scheduleClipboardClear(path.value)
  toast.success(t('远端路径已复制'))
}

const contextItems = computed<ContextMenuItem[]>(() => {
  const file = state.menuFile
  if (!file) return []
  const directory = file.kind === 'directory'
  return [
    {
      id: 'open',
      label:
        directory || file.kind === 'symlink'
          ? t('打开目录')
          : t('编辑文本文件'),
      icon: directory ? 'lucide:folder-open' : 'lucide:file-pen-line',
    },
    {
      id: 'external',
      label: t('下载并用外部程序打开'),
      icon: 'lucide:external-link',
      disabled: directory,
    },
    {
      id: 'download',
      label: t('下载到…'),
      icon: 'lucide:download',
      disabled: directory,
    },
    {
      id: 'rename',
      label: t('重命名'),
      icon: 'lucide:pencil',
      separatorBefore: true,
    },
    {
      id: 'delete',
      label: t('删除'),
      icon: 'lucide:trash-2',
      danger: true,
      separatorBefore: true,
    },
  ]
})

const summary = computed(() => {
  const dirs = visibleEntries.value.filter(
    item => item.kind === 'directory'
  ).length
  return t('{value0} 个目录，{value1} 个文件', {
    value0: dirs,
    value1: visibleEntries.value.length - dirs,
  })
})

function remoteChildPath(name: string): string {
  return path.value === '/'
    ? `/${name}`
    : `${path.value.replace(/\/$/, '')}/${name}`
}

function defaultDownloadPath(fileName: string): string {
  const directory = settings.defaultDownloadDirectory.trim()
  if (!directory) return fileName
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory.replace(/[\\/]$/, '')}${separator}${fileName}`
}

async function pickUploadFiles(): Promise<void> {
  await pickUpload(false)
}

async function pickUploadFolder(): Promise<void> {
  await pickUpload(true)
}

async function pickUpload(directoryOnly: boolean): Promise<void> {
  const session = props.sessionId
  if (!session) return
  if (!path.value && !(await load(''))) return
  if (props.sessionId !== session || !path.value) return
  const directory = path.value
  const result = await openFileDialog({
    title: directoryOnly ? t('选择要上传的文件夹') : t('选择要上传的文件'),
    multiple: true,
    directory: directoryOnly,
  })
  if (!result) return
  if (props.sessionId !== session || path.value !== directory) {
    for (const localPath of Array.isArray(result) ? result : [result]) {
      transfers.recordUploadError(
        {
          sessionId: session,
          connectionName: props.connectionName,
          localPath,
          remotePath: directory,
        },
        t('当前服务器或目录已变化，请重新选择上传项目')
      )
    }
    return
  }
  await uploadPaths(Array.isArray(result) ? result : [result])
}

async function download(file: SshRemoteFile): Promise<void> {
  if (file.kind === 'directory') return
  const destination = await saveFileDialog({
    title: t('下载 {value0}', { value0: file.name }),
    defaultPath: defaultDownloadPath(file.name),
  })
  if (!destination) return
  await transfers.download({
    sessionId: props.sessionId,
    connectionName: props.connectionName,
    remotePath: file.path,
    localPath: destination,
    overwrite: true,
  })
}

async function openRemote(file: SshRemoteFile): Promise<void> {
  if (file.kind === 'directory' || file.kind === 'symlink') {
    await enter(file)
    return
  }

  editor.open({
    sessionId: props.sessionId,
    path: file.path,
    connectionName: props.connectionName,
  })
}

async function openExternal(file: SshRemoteFile): Promise<void> {
  const localPath = await transfers.download({
    sessionId: props.sessionId,
    connectionName: props.connectionName,
    remotePath: file.path,
  })
  if (localPath) await openPath(localPath)
}

function openMenu(event: MouseEvent, file: SshRemoteFile): void {
  selected.value = file.path
  state.menuFile = file
  state.menuX = event.clientX
  state.menuY = event.clientY
  state.menuOpen = true
}

function runContextAction(action: string): void {
  const file = state.menuFile
  if (!file) return
  if (action === 'open') void openRemote(file)
  else if (action === 'external')
    void openExternal(file).catch(error =>
      toast.error({
        title: t('打开文件失败'),
        description: ssh.errorMessage(error),
      })
    )
  else if (action === 'download') void download(file)
  else if (action === 'rename') state.renaming = file
  else if (action === 'delete') {
    if (settings.confirmFileDelete) state.pendingDelete = file
    else void deleteFile(file)
  }
}

async function renameFile(name: string): Promise<void> {
  const file = state.renaming
  state.renaming = null
  if (!file || name === file.name) return
  try {
    await ssh.renamePath(props.sessionId, file.path, remoteChildPath(name))
    await refresh()
    toast.success(t('已重命名为“{value0}”', { value0: name }))
  } catch (renameError) {
    toast.error({
      title: t('重命名失败'),
      description: ssh.errorMessage(renameError),
    })
  }
}

async function deleteFile(file: SshRemoteFile): Promise<void> {
  try {
    await ssh.deletePath(props.sessionId, file.path, file.kind === 'directory')
    await refresh()
    toast.success(t('已删除“{value0}”', { value0: file.name }))
  } catch (deleteError) {
    toast.error({
      title: t('删除失败'),
      description: ssh.errorMessage(deleteError),
    })
  }
}

async function confirmDelete(): Promise<void> {
  const file = state.pendingDelete
  state.pendingDelete = null
  if (file) await deleteFile(file)
}

function handleBrowserDrop(event: DragEvent): void {
  browserDragging.value = false
  const paths = [...(event.dataTransfer?.files ?? [])]
    .map(file => (file as File & { path?: string }).path ?? '')
    .filter(Boolean)
  if (paths.length) void uploadPaths(paths)
}
defineExpose({ pickUploadFiles, pickUploadFolder })
</script>

<template>
  <div
    ref="dropZone"
    class="relative flex min-h-0 flex-1 flex-col"
    @dragenter.prevent="browserDragging = true"
    @dragover.prevent
    @dragleave.prevent="browserDragging = false"
    @drop.prevent="handleBrowserDrop"
  >
    <div
      class="border-line-soft flex h-9 shrink-0 items-center gap-0.5 border-b px-2"
    >
      <IconButton
        icon="lucide:house"
        :size="14"
        :title="t('主目录')"
        :disabled="!connected"
        @click="load('')"
      />
      <IconButton
        icon="lucide:arrow-left"
        :size="14"
        :title="t('后退')"
        :disabled="!canGoBack"
        @click="goBack"
      />
      <IconButton
        icon="lucide:arrow-right"
        :size="14"
        :title="t('前进')"
        :disabled="!canGoForward"
        @click="goForward"
      />
      <IconButton
        icon="lucide:arrow-up"
        :size="14"
        :title="t('上一级')"
        :disabled="!connected || path === '/'"
        @click="goUp"
      />

      <div class="flex-1" />

      <IconButton
        :icon="pathClip.copied.value ? 'lucide:check' : 'lucide:copy'"
        :size="14"
        :title="t('复制路径')"
        :disabled="!path"
        @click="copyPath"
      />
      <IconButton
        icon="lucide:upload"
        :size="14"
        :title="t('上传文件')"
        :disabled="!connected"
        @click="pickUploadFiles"
      />
      <IconButton
        icon="lucide:folder-up"
        :size="14"
        :title="t('上传文件夹')"
        :disabled="!connected"
        @click="pickUploadFolder"
      />
      <IconButton
        icon="lucide:download"
        :size="14"
        :title="t('下载选中文件')"
        :disabled="!selectedFile || selectedFile.kind === 'directory'"
        @click="selectedFile && download(selectedFile)"
      />
      <IconButton
        :icon="settings.showHiddenFiles ? 'lucide:eye' : 'lucide:eye-off'"
        :size="14"
        :title="settings.showHiddenFiles ? t('隐藏点文件') : t('显示隐藏文件')"
        @click="toggleHidden"
      />
      <IconButton
        icon="lucide:rotate-cw"
        :size="14"
        :title="t('刷新')"
        :disabled="!connected"
        @click="refresh"
      />
    </div>

    <div class="border-line-soft flex shrink-0 border-b px-2 py-1.5">
      <RemotePathInput
        :path="path"
        :entries="pathEntries"
        :connected="connected"
        :loading="loading"
        @navigate="load"
      />
    </div>

    <div
      class="border-line-soft flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
    >
      <AppIcon
        name="lucide:search"
        :size="13"
        class="text-txt-3"
      />
      <input
        v-model="filterText"
        :aria-label="t('筛选当前目录文件')"
        :placeholder="t('筛选当前目录文件…')"
        class="text-txt min-w-0 flex-1 bg-transparent text-xs outline-none"
        @keydown.esc.stop="filterText = ''"
      />
      <IconButton
        v-if="filterText"
        icon="lucide:x"
        :size="12"
        :title="t('清除文件筛选')"
        @click="filterText = ''"
      />
    </div>

    <div
      class="border-line-soft text-txt-3 grid shrink-0 grid-cols-[1fr_80px_130px] gap-3 border-b px-3 py-1.5 text-[11px] font-medium"
    >
      <span> {{ t('Name') }} </span>
      <span class="text-right"> {{ t('Size') }} </span>
      <span> {{ t('Modified') }} </span>
    </div>

    <RemoteFileList
      :files="visibleEntries"
      :selected="selected"
      @select="selected = $event"
      @open="openRemote"
      @contextmenu="openMenu"
    >
      <p
        v-if="loading"
        class="text-txt-4 py-8 text-center text-xs"
      >
        {{ t('正在读取目录…') }}
      </p>
      <p
        v-else-if="!connected"
        class="text-txt-4 py-8 text-center text-xs"
      >
        {{ t('连上服务器后可以浏览远端文件') }}
      </p>
      <p
        v-else-if="!visibleEntries.length && !error"
        class="text-txt-4 py-8 text-center text-xs"
      >
        {{
          filterText.trim()
            ? t('没有匹配的文件')
            : entries.length
              ? t('隐藏文件已在设置中隐藏')
              : t('这个目录是空的')
        }}
      </p>
    </RemoteFileList>

    <footer
      class="border-line-soft text-txt-3 flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px]"
    >
      <span class="truncate">{{ connected ? summary : t('未连接') }}</span>
      <div class="flex-1" />
      <span class="text-txt-4 shrink-0">
        {{ t('双击打开 · 可拖入本地文件上传') }}
      </span>
    </footer>

    <Transition name="drop-overlay">
      <div
        v-if="dropActive && connected"
        class="drop-overlay"
        aria-live="polite"
      >
        <div
          class="bg-violet/15 text-violet grid size-12 place-items-center rounded-xl"
        >
          <AppIcon
            name="lucide:cloud-upload"
            :size="24"
          />
        </div>
        <p class="text-txt mt-3 text-[13px] font-semibold">
          {{ t('松开即可上传') }}
        </p>
        <p class="text-txt-3 mt-1 text-[10.5px]">
          {{ t('files.dropDestination', { path: path || t('主目录') }) }}
        </p>
      </div>
    </Transition>

    <RemoteFileRenameDialog
      v-if="state.renaming"
      :name="state.renaming.name"
      @submit="renameFile"
      @close="state.renaming = null"
    />
  </div>

  <AppContextMenu
    :open="state.menuOpen"
    :x="state.menuX"
    :y="state.menuY"
    :items="contextItems"
    :label="
      state.menuFile
        ? t('{value0} 操作', { value0: state.menuFile.name })
        : t('文件操作')
    "
    @select="runContextAction"
    @close="state.menuOpen = false"
  />

  <AppConfirmDialog
    :open="Boolean(state.pendingDelete)"
    :title="t('删除远端项目')"
    :description="
      state.pendingDelete?.kind === 'directory'
        ? t('确定删除空目录“{value0}”吗？此操作无法撤销。', {
            value0: state.pendingDelete?.name ?? '',
          })
        : t('确定删除远端文件“{value0}”吗？此操作无法撤销。', {
            value0: state.pendingDelete?.name ?? '',
          })
    "
    :confirm-label="t('删除')"
    danger
    @close="state.pendingDelete = null"
    @confirm="confirmDelete"
  />

  <FileConflictDialog
    v-model:always="conflictAlways"
    :open="conflictOpen"
    :file-name="conflictFileName"
    :remaining="conflictRemaining"
    @overwrite="settleConflict('overwrite')"
    @skip="settleConflict('skip')"
    @cancel="settleConflict('cancel')"
  />
</template>

<style scoped>
.drop-overlay {
  position: absolute;
  inset: 8px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border: 1px dashed color-mix(in oklch, var(--color-violet) 72%, transparent);
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-panel) 89%, transparent);
  box-shadow: inset 0 0 40px
    color-mix(in oklch, var(--color-violet) 8%, transparent);
  backdrop-filter: blur(12px);
  pointer-events: none;
}

.drop-overlay-enter-active,
.drop-overlay-leave-active {
  transition: opacity 120ms ease;
}

.drop-overlay-enter-from,
.drop-overlay-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .drop-overlay-enter-active,
  .drop-overlay-leave-active {
    transition: none;
  }
}
</style>
