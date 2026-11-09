<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  reactive,
  shallowRef,
  toRef,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { useClipboard, useEventListener } from '@vueuse/core'
import {
  open as openFileDialog,
  save as saveFileDialog,
} from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import IconButton from '@/components/ui/IconButton.vue'
import * as ssh from '@/api/ssh'
import { readFileContext } from '@/api/agent'
import { useFileTransfers } from '@/composables/useFileTransfers'
import { useNativeFileDrop } from '@/composables/useNativeFileDrop'
import { useRemoteEditor } from '@/composables/useRemoteEditor'
import { useRemoteFiles } from '@/composables/useRemoteFiles'
import { useRemoteUploads } from '@/composables/useRemoteUploads'
import { useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import type { ContextMenuItem } from '@/types/context-menu'
import type { SshRemoteFile } from '@/types/ssh'
import { copyText, scheduleClipboardClear } from '@/utils/clipboard'
import FileConflictDialog from './FileConflictDialog.vue'
import RemoteFileCreateDialog from './RemoteFileCreateDialog.vue'
import RemoteFileRenameDialog from './RemoteFileRenameDialog.vue'
import RemoteFileChmodDialog from './RemoteFileChmodDialog.vue'
import RemoteFileList from './RemoteFileList.vue'
import FileBrowserControls from '@/components/workspace/file-browser-controls.vue'
import type { FilePaneDrop } from '@/components/workspace/useFilePaneDrag'
import RemoteFileTransferDialog from './RemoteFileTransferDialog.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import LocalFilePane from '@/components/workspace/local-file-pane.vue'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()

const { settings } = useSettings()
const emit = defineEmits<{
  askAgent: [request: { sessionId: string; path: string; text: string }]
}>()

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
// 由机器面板标题栏控制双栏，独立挂载文件视图时仍默认单栏。
const dualPane = defineModel<boolean>('dualPane', { default: false })
const filterText = shallowRef('')
const createMenuTrigger = shallowRef<HTMLElement | null>(null)
function toggleHidden(): void {
  saveSettings({ ...settings, showHiddenFiles: !settings.showHiddenFiles })
}
const transfers = useFileTransfers()
const editor = useRemoteEditor()
const dropZone = useTemplateRef<HTMLElement>('dropZone')
const browserDragging = shallowRef(false)
// 拖拽经过子元素时 dragenter/dragleave 成对触发，用计数判断是否真正离开整个区域
let dragDepth = 0
const state = reactive({
  menuOpen: false,
  menuX: 0,
  menuY: 0,
  menuFile: null as SshRemoteFile | null,
  // 列表多选集合；右键菜单使用打开时的快照，避免异步操作目标漂移
  selection: [] as string[],
  // 当前菜单对应的一组远端项目
  menuFiles: [] as SshRemoteFile[],
  // 等待用户确认删除的项目
  pendingDelete: [] as SshRemoteFile[],
  // 批量操作期间阻止重复提交
  processing: false,
  // 移动/复制弹窗锁定菜单打开时的文件与会话，目录切换不会改变操作目标
  transfer: null as {
    mode: 'move' | 'copy'
    files: SshRemoteFile[]
    sessionId: string
    directory: string
  } | null,
  // 属性面板所展示的文件快照
  properties: [] as SshRemoteFile[],
  renaming: null as SshRemoteFile | null,
  createMenuOpen: false,
  createMenuX: 0,
  createMenuY: 0,
  creating: null as 'file' | 'directory' | null,
  // 正在读取将加入 AI 草稿的配置文件
  readingContext: false,
  // 正在修改权限的远端项目
  chmodTarget: null as SshRemoteFile | null,
})
const { selection } = toRefs(state)

// 连接变化时撤销旧会话的弹窗目标，已开始的操作仍使用各自锁定的会话 ID。
watch(
  () => props.sessionId,
  () => {
    state.transfer = null
    state.properties = []
    // 权限弹窗绑定旧会话的路径，切换连接后不能对新会话的同名路径提交
    state.chmodTarget = null
  }
)

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
const selectedFiles = computed(() =>
  visibleEntries.value.filter(file => state.selection.includes(file.path))
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
watch([() => props.sessionId, path], () => {
  // 筛选仅作用于当前目录；成功切换目录时清空，原地刷新或导航失败则保留。
  filterText.value = ''
  state.selection = []
  state.menuOpen = false
  state.pendingDelete = []
})
const pathClip = useClipboard({ copiedDuring: 1600 })

watch(visibleEntries, files => {
  if (selected.value && !files.some(file => file.path === selected.value))
    selected.value = ''
  const visible = new Set(files.map(file => file.path))
  state.selection = state.selection.filter(path => visible.has(path))
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

const createItems = computed<ContextMenuItem[]>(() => [
  { id: 'file', label: t('新建文件'), icon: 'lucide:file-plus' },
  { id: 'directory', label: t('新建文件夹'), icon: 'lucide:folder-plus' },
])

function openCreateMenu(event: MouseEvent): void {
  if (state.createMenuOpen) {
    state.createMenuOpen = false
    return
  }
  createMenuTrigger.value = event.currentTarget as HTMLElement
  const rect = createMenuTrigger.value.getBoundingClientRect()
  state.createMenuX = rect.left
  state.createMenuY = rect.bottom + 4
  state.createMenuOpen = true
}

async function createRemote(name: string): Promise<void> {
  const kind = state.creating
  state.creating = null
  if (!kind || !props.sessionId || !path.value) return
  const session = props.sessionId
  const directory = path.value
  try {
    await ssh.createPath(session, directory, name, kind === 'directory')
    if (props.sessionId === session && path.value === directory) await refresh()
    toast.success(t('已创建“{value0}”', { value0: name }))
  } catch (createError) {
    toast.error({
      title: t('创建失败'),
      description: ssh.errorMessage(createError),
    })
  }
}

const contextItems = computed<ContextMenuItem[]>(() => {
  const file = state.menuFile
  if (!file) return []
  const common: ContextMenuItem[] = [
    {
      id: 'move',
      label: t('files.moveTo'),
      icon: 'lucide:folder-input',
      disabled: state.processing,
    },
    {
      id: 'copy-to',
      label: t('files.copyTo'),
      icon: 'lucide:copy-plus',
      disabled: state.processing,
    },
    {
      id: 'copy-names',
      label: t('files.copyNames'),
      icon: 'lucide:text-cursor-input',
    },
    { id: 'properties', label: t('files.properties'), icon: 'lucide:info' },
    {
      id: 'select-all',
      label: t('files.selectAll'),
      icon: 'lucide:list-checks',
      separatorBefore: true,
    },
    {
      id: 'invert-selection',
      label: t('files.invertSelection'),
      icon: 'lucide:replace',
    },
    { id: 'refresh', label: t('刷新'), icon: 'lucide:refresh-cw' },
  ]
  if (state.menuFiles.length > 1)
    return [
      {
        id: 'download',
        label: t('files.downloadSelected', { count: state.menuFiles.length }),
        icon: 'lucide:download',
        disabled:
          state.processing ||
          state.menuFiles.some(file => file.kind === 'directory'),
      },
      { id: 'copy-paths', label: t('files.copyPaths'), icon: 'lucide:copy' },
      ...common,
      {
        id: 'delete',
        label: t('files.deleteSelected', { count: state.menuFiles.length }),
        icon: 'lucide:trash-2',
        danger: true,
        separatorBefore: true,
        disabled: state.processing,
      },
    ]
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
      id: 'ask-agent',
      label: t('让 AI 解释配置'),
      icon: 'lucide:sparkles',
      disabled: file.kind !== 'file' || state.readingContext,
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
      id: 'chmod',
      label: t('修改权限'),
      icon: 'lucide:shield',
      disabled: file.kind === 'symlink' || state.processing,
    },
    {
      id: 'copy-paths',
      label: t('复制路径'),
      icon: 'lucide:copy',
    },
    ...common,
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

// 选择下载位置前固定 SSH 会话，选择期间若已切换连接则取消本次操作。
async function download(file: SshRemoteFile): Promise<void> {
  if (file.kind === 'directory') return
  const sessionId = props.sessionId
  const connectionName = props.connectionName
  const destination = await saveFileDialog({
    title: t('下载 {value0}', { value0: file.name }),
    defaultPath: defaultDownloadPath(file.name),
  })
  if (!destination || sessionId !== props.sessionId) return
  await transfers.download({
    sessionId,
    connectionName,
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

// 列表选择事件同时保存多选集合与键盘焦点，不改变其他目录的状态。
function selectFiles(paths: string[], focus: string): void {
  state.selection = paths
  selected.value = focus
}

// 在已选行上右键保留整个集合，在未选行上右键只操作该行。
function openMenu(event: MouseEvent, file: SshRemoteFile): void {
  if (!state.selection.includes(file.path)) state.selection = [file.path]
  selected.value = file.path
  state.menuFile = file
  state.menuFiles = [...selectedFiles.value]
  state.menuX = event.clientX
  state.menuY = event.clientY
  state.menuOpen = true
}

// 根据菜单快照执行单项或批量操作，删除确认只出现一次。
function runContextAction(action: string): void {
  const file = state.menuFile
  if (!file) return
  if (action === 'move' || action === 'copy-to') {
    state.transfer = {
      mode: action === 'move' ? 'move' : 'copy',
      files: [...state.menuFiles],
      sessionId: props.sessionId,
      directory: path.value,
    }
    return
  }
  if (action === 'properties') {
    state.properties = [...state.menuFiles]
    return
  }
  if (action === 'copy-names') {
    void copySelectedNames()
    return
  }
  if (action === 'select-all') {
    selectFiles(
      visibleEntries.value.map(file => file.path),
      selected.value
    )
    return
  }
  if (action === 'invert-selection') {
    const paths = visibleEntries.value
      .filter(file => !state.selection.includes(file.path))
      .map(file => file.path)
    selectFiles(paths, paths[0] ?? '')
    return
  }
  if (action === 'refresh') {
    void refresh()
    return
  }
  if (action === 'open') void openRemote(file)
  else if (action === 'ask-agent') void askAgentFile(file)
  else if (action === 'external')
    void openExternal(file).catch(error =>
      toast.error({
        title: t('打开文件失败'),
        description: ssh.errorMessage(error),
      })
    )
  else if (action === 'download') void downloadFiles(state.menuFiles)
  else if (action === 'copy-paths') void copySelectedPaths(state.menuFiles)
  else if (action === 'rename') state.renaming = file
  else if (action === 'chmod') state.chmodTarget = file
  else if (action === 'delete') {
    // 目录会被递归删除，即使关闭了删除确认也必须二次确认
    if (
      settings.confirmFileDelete ||
      state.menuFiles.some(item => item.kind === 'directory')
    )
      state.pendingDelete = [...state.menuFiles]
    else void deleteFiles(state.menuFiles)
  }
}

// 复制名称时保留每个远端项目的大小写与空格，与复制绝对路径分开提供。
async function copySelectedNames(): Promise<void> {
  try {
    const text = state.menuFiles.map(file => file.name).join('\n')
    await copyText(text)
    scheduleClipboardClear(text)
    toast.success(t('files.namesCopied'))
  } catch (error) {
    toast.error({
      title: t('复制失败，请检查剪贴板权限'),
      description: ssh.errorMessage(error),
    })
  }
}

// 对锁定的项目逐个移动或复制；同名项目保留，失败不阻断其余项目，最后统一刷新原目录。
async function transferFiles(directory: string): Promise<void> {
  const request = state.transfer
  if (!request || state.processing || request.sessionId !== props.sessionId)
    return
  state.processing = true
  const failures: string[] = []
  let completed = 0
  try {
    for (const file of request.files) {
      if (props.sessionId !== request.sessionId) break
      const destination = `${directory.replace(/\/$/, '')}/${file.name}`
      try {
        if (
          destination === file.path ||
          (file.kind === 'directory' && destination.startsWith(`${file.path}/`))
        )
          throw new Error(t('files.invalidDestination'))
        if (request.mode === 'move')
          await ssh.renamePath(request.sessionId, file.path, destination)
        else await ssh.copyPath(request.sessionId, file.path, destination)
        completed++
      } catch (error) {
        failures.push(`${file.name}: ${ssh.errorMessage(error)}`)
      }
    }
    if (
      props.sessionId === request.sessionId &&
      path.value === request.directory
    )
      await refresh()
    if (completed)
      toast.success(
        t(request.mode === 'move' ? 'files.movedCount' : 'files.copiedCount', {
          count: completed,
        })
      )
    if (failures.length)
      toast.error({
        title: t('files.operationFailed'),
        description: failures.join('\n'),
      })
    state.transfer = null
  } finally {
    state.processing = false
  }
}

// 批量下载只选择一次本地目录，逐项交给现有传输队列并保留同名文件保护。
async function downloadFiles(files: SshRemoteFile[]): Promise<void> {
  if (
    state.processing ||
    !files.length ||
    files.some(file => file.kind === 'directory')
  )
    return
  if (files.length === 1) {
    await download(files[0]!)
    return
  }
  const sessionId = props.sessionId
  const connectionName = props.connectionName
  const destination = await openFileDialog({
    title: t('files.downloadDirectory'),
    directory: true,
    multiple: false,
  })
  if (
    !destination ||
    Array.isArray(destination) ||
    sessionId !== props.sessionId
  )
    return
  state.processing = true
  try {
    const separator = destination.includes('\\') ? '\\' : '/'
    for (const file of files) {
      if (sessionId !== props.sessionId) break
      await transfers.download({
        sessionId,
        connectionName,
        remotePath: file.path,
        localPath: `${destination.replace(/[\\/]$/, '')}${separator}${file.name}`,
        overwrite: false,
      })
    }
  } finally {
    state.processing = false
  }
}

// 把选中项目的绝对路径逐行复制，便于在终端或其他工具中继续处理。
async function copySelectedPaths(files: SshRemoteFile[]): Promise<void> {
  try {
    const text = files.map(file => file.path).join('\n')
    await copyText(text)
    scheduleClipboardClear(text)
    toast.success(t('远端路径已复制'))
  } catch (error) {
    toast.error({
      title: t('复制失败，请检查剪贴板权限'),
      description: ssh.errorMessage(error),
    })
  }
}
async function askAgentFile(file: SshRemoteFile): Promise<void> {
  if (state.readingContext || file.kind !== 'file') return
  const sessionId = props.sessionId
  state.readingContext = true
  try {
    const result = await readFileContext(
      { kind: 'ssh', sessionId, database: '' },
      file.path
    )
    if (sessionId === props.sessionId)
      emit('askAgent', { sessionId, ...result })
  } catch (error) {
    toast.error({
      title: t('读取配置失败'),
      description: ssh.errorMessage(error),
    })
  } finally {
    state.readingContext = false
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

// 提交权限修改，目录可递归；完成后刷新原目录
async function chmodFile(mode: number, recursive: boolean): Promise<void> {
  const file = state.chmodTarget
  if (!file || state.processing) return
  const sessionId = props.sessionId
  const directory = path.value
  state.processing = true
  try {
    const count = await ssh.chmodPath(sessionId, file.path, mode, recursive)
    state.chmodTarget = null
    if (props.sessionId === sessionId && path.value === directory)
      await refresh()
    toast.success(
      t('已修改 {count} 个项目的权限', {
        count,
      })
    )
  } catch (error) {
    toast.error({
      title: t('修改权限失败'),
      description: ssh.errorMessage(error),
    })
  } finally {
    state.processing = false
  }
}

// 批量删除逐项执行并汇总失败；目录会递归删除其中全部内容。
async function deleteFiles(files: SshRemoteFile[]): Promise<void> {
  if (state.processing || !files.length) return
  const sessionId = props.sessionId
  const directory = path.value
  state.processing = true
  const failures: string[] = []
  let deleted = 0
  try {
    for (const file of files) {
      if (sessionId !== props.sessionId) break
      try {
        if (file.kind === 'directory') await ssh.deleteTree(sessionId, file.path)
        else await ssh.deletePath(sessionId, file.path, false)
        deleted++
      } catch (error) {
        failures.push(`${file.name}: ${ssh.errorMessage(error)}`)
      }
    }
    if (props.sessionId === sessionId && path.value === directory)
      await refresh()
    if (deleted) toast.success(t('files.deletedCount', { count: deleted }))
    if (failures.length)
      toast.error({ title: t('删除失败'), description: failures.join('\n') })
  } finally {
    state.processing = false
  }
}

// 确认后使用弹窗打开时的项目快照，不依赖可能已变化的当前选中行。
async function confirmDelete(): Promise<void> {
  const files = state.pendingDelete
  state.pendingDelete = []
  await deleteFiles(files)
}

// 内部拖放只接受同连接当前目录，继续复用上传批次及冲突处理。
function receivePaneDrop(event: Event): void {
  const detail = (event as CustomEvent<FilePaneDrop>).detail
  if (
    detail.source === 'local' &&
    detail.sessionId === props.sessionId &&
    detail.directory === path.value
  )
    void uploadPaths(detail.files.map(file => file.path))
}

// 进入拖拽区域（含子元素）时累加计数并显示上传遮罩
function handleDragEnter(): void {
  dragDepth++
  browserDragging.value = true
}

// 只有离开最外层区域（计数归零）时才隐藏遮罩，避免经过子元素时闪烁
function handleDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) browserDragging.value = false
}

// 拖放在任意位置结束（含被本地栏 stop 掉的 drop）时清零计数，防止遮罩卡住
function resetBrowserDrag(): void {
  dragDepth = 0
  browserDragging.value = false
}
useEventListener(window, 'drop', resetBrowserDrag, { capture: true })
useEventListener(window, 'dragend', resetBrowserDrag, { capture: true })

// 处理浏览器拖放：内部本地栏拖入或带路径的系统文件
function handleBrowserDrop(event: DragEvent): void {
  dragDepth = 0
  const internal = event.dataTransfer?.getData('application/x-miraihub-local')
  if (internal) {
    browserDragging.value = false
    try {
      const paths: unknown = JSON.parse(internal)
      if (Array.isArray(paths) && paths.every(path => typeof path === 'string'))
        void uploadPaths(paths)
    } catch (error) {
      toast.error(String(error))
    }
    return
  }

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
    class="relative flex min-h-0 flex-1 flex-col"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleBrowserDrop"
  >
    <div class="flex min-h-0 flex-1">
      <LocalFilePane
        v-if="dualPane"
        :key="sessionId"
        :session-id="sessionId"
        :remote-path="path"
        @upload="uploadPaths"
        @refreshed="refresh"
      />
      <div
        ref="dropZone"
        data-file-drop-target="remote"
        :data-file-session-id="sessionId"
        :data-file-directory="connected ? path : ''"
        @mirai-file-drop="receivePaneDrop"
        class="file-pane flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div
          class="scroll-none border-line-soft flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2"
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
            icon="lucide:plus"
            :size="14"
            :title="t('新建文件或文件夹')"
            :disabled="!connected || !path"
            aria-haspopup="menu"
            :aria-expanded="state.createMenuOpen"
            @click="openCreateMenu"
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
            :disabled="
              !selectedFiles.length ||
              selectedFiles.some(file => file.kind === 'directory') ||
              state.processing
            "
            @click="downloadFiles(selectedFiles)"
          />
          <IconButton
            :icon="settings.showHiddenFiles ? 'lucide:eye' : 'lucide:eye-off'"
            :size="14"
            :title="
              settings.showHiddenFiles ? t('隐藏点文件') : t('显示隐藏文件')
            "
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

        <FileBrowserControls
          v-model:filter="filterText"
          :path="path"
          :entries="pathEntries"
          :connected="connected"
          :loading="loading"
          @navigate="load"
        />

        <RemoteFileList
          :files="visibleEntries"
          :drag-session-id="dualPane ? sessionId : undefined"
          :selected="selected"
          :selection="selection"
          @select="selectFiles"
          @open="openRemote"
          @contextmenu="openMenu"
        >
          <AppSkeleton
            v-if="loading"
            :rows="8"
          />
          <AppEmptyState
            v-else-if="!connected"
            compact
            icon="lucide:plug-zap"
            :title="t('连上服务器后可以浏览远端文件')"
          />
          <AppEmptyState
            v-else-if="!visibleEntries.length && !error"
            compact
            :icon="filterText.trim() ? 'lucide:search-x' : 'lucide:folder-open'"
            :title="
              filterText.trim()
                ? t('没有匹配的文件')
                : entries.length
                  ? t('隐藏文件已在设置中隐藏')
                  : t('这个目录是空的')
            "
          />
        </RemoteFileList>
      </div>
    </div>
    <footer
      class="border-line-soft text-txt-3 flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px]"
    >
      <span class="truncate">{{ connected ? summary : t('未连接') }}</span>
      <span
        v-if="selection.length"
        class="text-accent shrink-0"
        >{{ t('files.selectedCount', { count: selection.length }) }}</span
      >
      <div class="flex-1" />
      <span class="text-txt-4 shrink-0">
        {{ t('files.selectionHint') }}
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
    <RemoteFileChmodDialog
      v-if="state.chmodTarget"
      :file="state.chmodTarget"
      :busy="state.processing"
      @submit="chmodFile"
      @close="state.chmodTarget = null"
    />
    <RemoteFileTransferDialog
      v-if="state.transfer"
      :session-id="state.transfer.sessionId"
      :directory="state.transfer.directory"
      :count="state.transfer.files.length"
      :mode="state.transfer.mode"
      :busy="state.processing"
      @close="state.transfer = null"
      @submit="transferFiles"
    />
    <AppDialog
      v-if="state.properties.length"
      :title="t('files.properties')"
      @close="state.properties = []"
    >
      <p class="text-txt-2 mb-3 text-xs">
        {{ t('files.selectedCount', { count: state.properties.length }) }} ·
        {{
          formatBytes(
            state.properties.reduce(
              (total, file) =>
                total + (file.kind === 'directory' ? 0 : file.size),
              0
            )
          )
        }}
      </p>
      <div class="scroll-thin max-h-80 space-y-3 overflow-auto">
        <dl
          v-for="file in state.properties"
          :key="file.path"
          class="border-line bg-input rounded-md border p-3 text-xs"
        >
          <dt class="text-txt font-medium break-all">{{ file.name }}</dt>
          <dd class="text-txt-3 mt-1 break-all">{{ file.path }}</dd>
          <dd class="text-txt-3 mt-2 font-mono">
            {{ file.permissions }} · {{ file.owner }}:{{ file.group }} ·
            {{
              file.kind === 'directory'
                ? t('files.directory')
                : formatBytes(file.size)
            }}
          </dd>
          <dd
            v-if="file.linkTarget"
            class="text-txt-3 mt-1 break-all"
          >
            → {{ file.linkTarget }}
          </dd>
        </dl>
      </div>
    </AppDialog>
    <RemoteFileCreateDialog
      v-if="state.creating"
      :is-directory="state.creating === 'directory'"
      @submit="createRemote"
      @close="state.creating = null"
    />
  </div>

  <AppContextMenu
    :open="state.createMenuOpen"
    :x="state.createMenuX"
    :y="state.createMenuY"
    :items="createItems"
    :label="t('新建文件或文件夹')"
    :trigger="createMenuTrigger"
    @select="state.creating = $event as 'file' | 'directory'"
    @close="state.createMenuOpen = false"
  />
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
    :open="state.pendingDelete.length > 0"
    :title="t('删除远端项目')"
    :description="
      state.pendingDelete.length > 1
        ? state.pendingDelete.some(file => file.kind === 'directory')
          ? t(
              '确定删除选中的 {count} 个项目吗？其中的目录会连同全部内容递归删除，此操作无法撤销。',
              { count: state.pendingDelete.length }
            )
          : t('files.confirmBatchDelete', { count: state.pendingDelete.length })
        : state.pendingDelete[0]?.kind === 'directory'
          ? t(
              '确定删除目录“{value0}”吗？目录中的所有文件和子目录都会被递归删除，此操作无法撤销。',
              { value0: state.pendingDelete[0]?.name ?? '' }
            )
          : t('确定删除远端文件“{value0}”吗？此操作无法撤销。', {
              value0: state.pendingDelete[0]?.name ?? '',
            })
    "
    :confirm-label="t('删除')"
    danger
    @close="state.pendingDelete = []"
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
