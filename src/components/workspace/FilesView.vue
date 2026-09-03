<script setup lang="ts">
import { computed, reactive, shallowRef, toRef, useTemplateRef } from 'vue'
import { useClipboard } from '@vueuse/core'
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import * as ssh from '@/api/ssh'
import { useFileTransfers } from '@/composables/useFileTransfers'
import { useNativeFileDrop } from '@/composables/useNativeFileDrop'
import { useRemoteFiles } from '@/composables/useRemoteFiles'
import { FILE_KIND_META, extensionOf } from '@/constants/files'
import type { ContextMenuItem } from '@/types/context-menu'
import type { SshRemoteFile } from '@/types/ssh'
import { cn } from '@/utils/cn'
import { formatBytes } from '@/utils/format'
import { formatDateTime } from '@/utils/time'
import FileConflictDialog from './FileConflictDialog.vue'
import RemoteFileRenameDialog from './RemoteFileRenameDialog.vue'
import RemotePathInput from './RemotePathInput.vue'

type ConflictAction = 'overwrite' | 'skip' | 'cancel'

const props = withDefaults(defineProps<{
  sessionId: string
  connectionName?: string
}>(), {
  connectionName: '',
})

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

const transfers = useFileTransfers()
const dropZone = useTemplateRef<HTMLElement>('dropZone')
const browserDragging = shallowRef(false)
const operationError = shallowRef('')
const state = reactive({
  menuOpen: false,
  menuX: 0,
  menuY: 0,
  menuFile: null as SshRemoteFile | null,
  pendingDelete: null as SshRemoteFile | null,
  renaming: null as SshRemoteFile | null,
  conflictOpen: false,
  conflictFileName: '',
  conflictRemaining: 0,
  conflictAlways: false,
})

let resolveConflict: ((result: { action: ConflictAction, always: boolean }) => void) | undefined

const { isDragging: nativeDragging } = useNativeFileDrop(dropZone, paths => void uploadPaths(paths))
const dropActive = computed(() => nativeDragging.value || browserDragging.value)
const connected = computed(() => Boolean(props.sessionId))
const selectedFile = computed(() => entries.value.find(file => file.path === selected.value))
const displayError = computed(() => operationError.value || error.value)
const pathClip = useClipboard({ copiedDuring: 1600 })

const contextItems = computed<ContextMenuItem[]>(() => {
  const file = state.menuFile
  if (!file)
    return []
  const directory = file.kind === 'directory'
  return [
    { id: 'open', label: directory ? '打开目录' : '打开文件', icon: directory ? 'lucide:folder-open' : 'lucide:external-link' },
    { id: 'download', label: '下载到…', icon: 'lucide:download', disabled: directory },
    { id: 'rename', label: '重命名', icon: 'lucide:pencil', separatorBefore: true },
    { id: 'delete', label: '删除', icon: 'lucide:trash-2', danger: true, separatorBefore: true },
  ]
})

function metaOf(file: SshRemoteFile): { icon: string, tone: string } {
  if (file.kind === 'directory')
    return FILE_KIND_META.folder
  if (file.kind === 'symlink')
    return { icon: 'lucide:link', tone: 'text-violet' }
  return FILE_KIND_META[extensionOf(file.name)]
}

function sizeOf(file: SshRemoteFile): string {
  return file.kind === 'directory' ? '–' : formatBytes(file.size)
}

function modifiedOf(file: SshRemoteFile): string {
  return file.modifiedAt ? formatDateTime(file.modifiedAt) : '—'
}

const summary = computed(() => {
  const dirs = sortedEntries.value.filter(item => item.kind === 'directory').length
  return `${dirs} 个目录，${sortedEntries.value.length - dirs} 个文件`
})

function remoteChildPath(name: string): string {
  return path.value === '/' ? `/${name}` : `${path.value.replace(/\/$/, '')}/${name}`
}

function localName(localPath: string): string {
  return localPath.split(/[\\/]/).filter(Boolean).at(-1) ?? localPath
}

function askConflict(fileName: string, remaining: number): Promise<{ action: ConflictAction, always: boolean }> {
  state.conflictFileName = fileName
  state.conflictRemaining = remaining
  state.conflictAlways = false
  state.conflictOpen = true
  return new Promise((resolve) => {
    resolveConflict = resolve
  })
}

function settleConflict(action: ConflictAction): void {
  const resolver = resolveConflict
  resolveConflict = undefined
  state.conflictOpen = false
  resolver?.({ action, always: state.conflictAlways })
}

async function uploadPaths(localPaths: readonly string[]): Promise<void> {
  if (!connected.value || !localPaths.length)
    return

  operationError.value = ''
  let policy: Exclude<ConflictAction, 'cancel'> | undefined
  let changed = false

  for (let index = 0; index < localPaths.length; index++) {
    const localPath = localPaths[index]
    if (!localPath)
      continue
    const remotePath = remoteChildPath(localName(localPath))

    try {
      let action: Exclude<ConflictAction, 'cancel'> = 'overwrite'
      const exists = await ssh.pathExists(props.sessionId, remotePath)
      if (exists) {
        if (policy) {
          action = policy
        } else {
          const decision = await askConflict(localName(localPath), localPaths.length - index - 1)
          if (decision.action === 'cancel')
            break
          action = decision.action
          if (decision.always)
            policy = action
        }
      }

      if (exists && action === 'skip')
        continue

      changed = await transfers.upload({
        sessionId: props.sessionId,
        connectionName: props.connectionName,
        localPath,
        remotePath,
        overwrite: exists && action === 'overwrite',
      }) || changed
    }
    catch (uploadError) {
      operationError.value = ssh.errorMessage(uploadError)
    }
  }

  if (changed)
    await refresh()
}

async function pickUploadFiles(): Promise<void> {
  const result = await openFileDialog({ title: '选择要上传的文件', multiple: true, directory: false })
  if (!result)
    return
  await uploadPaths(Array.isArray(result) ? result : [result])
}

async function download(file: SshRemoteFile): Promise<void> {
  if (file.kind === 'directory')
    return
  operationError.value = ''
  const destination = await saveFileDialog({ title: `下载 ${file.name}`, defaultPath: file.name })
  if (!destination)
    return
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

  operationError.value = ''
  const localPath = await transfers.download({
    sessionId: props.sessionId,
    connectionName: props.connectionName,
    remotePath: file.path,
  })
  if (localPath)
    await openPath(localPath)
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
  if (!file)
    return
  if (action === 'open')
    void openRemote(file)
  else if (action === 'download')
    void download(file)
  else if (action === 'rename')
    state.renaming = file
  else if (action === 'delete')
    state.pendingDelete = file
}

async function renameFile(name: string): Promise<void> {
  const file = state.renaming
  state.renaming = null
  if (!file || name === file.name)
    return
  operationError.value = ''
  try {
    await ssh.renamePath(props.sessionId, file.path, remoteChildPath(name))
    await refresh()
  }
  catch (renameError) {
    operationError.value = ssh.errorMessage(renameError)
  }
}

async function confirmDelete(): Promise<void> {
  const file = state.pendingDelete
  state.pendingDelete = null
  if (!file)
    return
  operationError.value = ''
  try {
    await ssh.deletePath(props.sessionId, file.path, file.kind === 'directory')
    await refresh()
  }
  catch (deleteError) {
    operationError.value = ssh.errorMessage(deleteError)
  }
}

function handleBrowserDrop(event: DragEvent): void {
  browserDragging.value = false
  const paths = [...(event.dataTransfer?.files ?? [])]
    .map(file => (file as File & { path?: string }).path ?? '')
    .filter(Boolean)
  if (paths.length)
    void uploadPaths(paths)
}
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
    <div class="flex h-9 shrink-0 items-center gap-0.5 border-b border-line-soft px-2">
      <IconButton icon="lucide:house" :size="14" title="主目录" :disabled="!connected" @click="load('')" />
      <IconButton icon="lucide:arrow-left" :size="14" title="后退" :disabled="!canGoBack" @click="goBack" />
      <IconButton icon="lucide:arrow-right" :size="14" title="前进" :disabled="!canGoForward" @click="goForward" />
      <IconButton icon="lucide:arrow-up" :size="14" title="上一级" :disabled="!connected || path === '/'" @click="goUp" />

      <RemotePathInput :path="path" :entries="sortedEntries" :connected="connected" :loading="loading" @navigate="load" />

      <IconButton :icon="pathClip.copied.value ? 'lucide:check' : 'lucide:copy'" :size="14" title="复制路径" :disabled="!path" @click="pathClip.copy(path)" />
      <IconButton icon="lucide:upload" :size="14" title="上传文件" :disabled="!connected" @click="pickUploadFiles" />
      <IconButton icon="lucide:download" :size="14" title="下载选中文件" :disabled="!selectedFile || selectedFile.kind === 'directory'" @click="selectedFile && download(selectedFile)" />
      <IconButton icon="lucide:rotate-cw" :size="14" title="刷新" :disabled="!connected" @click="refresh" />
    </div>

    <p v-if="displayError" class="shrink-0 border-b border-line-soft bg-danger/10 px-3 py-1.5 text-[11px] text-danger">
      {{ displayError }}
    </p>

    <div class="grid shrink-0 grid-cols-[1fr_80px_130px] gap-3 border-b border-line-soft px-3 py-1.5 text-[11px] font-medium text-txt-3">
      <span>Name</span>
      <span class="text-right">Size</span>
      <span>Modified</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-1 scroll-thin">
      <button
        v-for="file in sortedEntries"
        :key="file.path"
        type="button"
        :class="cn('grid w-full grid-cols-[1fr_80px_130px] items-center gap-3 px-3 py-1.75 text-left text-xs transition-colors', selected === file.path ? 'bg-raised' : 'hover:bg-hover')"
        :title="`${file.permissions}  ${file.owner}:${file.group}`"
        @click="selected = file.path"
        @dblclick="openRemote(file)"
        @contextmenu.prevent.stop="openMenu($event, file)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <AppIcon :name="metaOf(file).icon" :size="15" :class="metaOf(file).tone" />
          <span class="truncate text-txt">{{ file.name }}</span>
          <span v-if="file.linkTarget" class="shrink-0 truncate text-[10.5px] text-txt-4">→ {{ file.linkTarget }}</span>
        </span>
        <span class="text-right text-txt-3">{{ sizeOf(file) }}</span>
        <span class="truncate text-txt-3">{{ modifiedOf(file) }}</span>
      </button>

      <p v-if="loading" class="py-8 text-center text-xs text-txt-4">正在读取目录…</p>
      <p v-else-if="!connected" class="py-8 text-center text-xs text-txt-4">连上服务器后可以浏览远端文件</p>
      <p v-else-if="!sortedEntries.length && !displayError" class="py-8 text-center text-xs text-txt-4">这个目录是空的</p>
    </div>

    <footer class="flex h-7 shrink-0 items-center gap-3 border-t border-line-soft px-3 text-[11px] text-txt-3">
      <span class="truncate">{{ connected ? summary : '未连接' }}</span>
      <div class="flex-1" />
      <span class="shrink-0 text-txt-4">双击打开 · 可拖入本地文件上传</span>
    </footer>

    <Transition name="drop-overlay">
      <div v-if="dropActive && connected" class="drop-overlay" aria-live="polite">
        <div class="grid size-12 place-items-center rounded-xl bg-violet/15 text-violet">
          <AppIcon name="lucide:cloud-upload" :size="24" />
        </div>
        <p class="mt-3 text-[13px] font-semibold text-txt">松开即可上传</p>
        <p class="mt-1 text-[10.5px] text-txt-3">文件会上传到 {{ path || '主目录' }}</p>
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
    :label="state.menuFile ? `${state.menuFile.name} 操作` : '文件操作'"
    @select="runContextAction"
    @close="state.menuOpen = false"
  />

  <AppConfirmDialog
    :open="Boolean(state.pendingDelete)"
    title="删除远端项目"
    :description="state.pendingDelete?.kind === 'directory'
      ? `确定删除空目录“${state.pendingDelete?.name ?? ''}”吗？此操作无法撤销。`
      : `确定删除远端文件“${state.pendingDelete?.name ?? ''}”吗？此操作无法撤销。`"
    confirm-label="删除"
    danger
    @close="state.pendingDelete = null"
    @confirm="confirmDelete"
  />

  <FileConflictDialog
    v-model:always="state.conflictAlways"
    :open="state.conflictOpen"
    :file-name="state.conflictFileName"
    :remaining="state.conflictRemaining"
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
  box-shadow: inset 0 0 40px color-mix(in oklch, var(--color-violet) 8%, transparent);
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
