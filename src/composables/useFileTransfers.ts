import { computed, reactive, readonly } from 'vue'
import * as ssh from '@/api/ssh'
import type { SshTransferEvent, SshTransferStatus } from '@/types/ssh'
import { IS_TAURI } from '@/utils/window'

export type FileTransferDirection = 'upload' | 'download'

export interface FileTransferTask {
  id: string
  direction: FileTransferDirection
  fileName: string
  source: string
  target: string
  connectionName: string
  status: SshTransferStatus
  transferredBytes: number
  totalBytes: number
  error: string
  localPath: string
  createdAt: number
  completedAt: number
}

interface UploadOptions {
  sessionId: string
  connectionName?: string
  localPath: string
  remotePath: string
  overwrite?: boolean
}

interface DownloadOptions {
  sessionId: string
  connectionName?: string
  remotePath: string
  localPath?: string
  overwrite?: boolean
}

const state = reactive({ items: [] as FileTransferTask[] })
let listenerStarted = false

function nameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function newTaskId(): string {
  if ('randomUUID' in crypto)
    return `transfer-${crypto.randomUUID()}`
  return `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function findTask(taskId: string): FileTransferTask | undefined {
  return state.items.find(task => task.id === taskId)
}

function applyEvent(event: SshTransferEvent): void {
  const task = findTask(event.taskId)
  if (!task)
    return

  task.status = event.status
  if (event.transferredBytes !== null)
    task.transferredBytes = event.transferredBytes
  if (event.totalBytes !== null)
    task.totalBytes = event.totalBytes
  if (event.localPath !== null)
    task.localPath = event.localPath
  if (event.error !== null)
    task.error = event.error
  if (event.status === 'completed' || event.status === 'error' || event.status === 'cancelled')
    task.completedAt = Date.now()
}

function ensureListener(): void {
  if (listenerStarted || !IS_TAURI)
    return
  listenerStarted = true
  void ssh.onTransfer(applyEvent).catch((error) => {
    listenerStarted = false
    console.error('监听文件传输状态失败：', error)
  })
}

function createTask(input: Pick<FileTransferTask, 'direction' | 'fileName' | 'source' | 'target' | 'connectionName'>): FileTransferTask {
  const task = reactive<FileTransferTask>({
    id: newTaskId(),
    ...input,
    status: 'queued',
    transferredBytes: 0,
    totalBytes: 0,
    error: '',
    localPath: '',
    createdAt: Date.now(),
    completedAt: 0,
  })
  state.items.unshift(task)
  return task
}

async function upload(options: UploadOptions): Promise<boolean> {
  ensureListener()
  const task = createTask({
    direction: 'upload',
    fileName: nameOf(options.localPath),
    source: options.localPath,
    target: options.remotePath,
    connectionName: options.connectionName ?? '',
  })
  task.status = 'running'

  try {
    await ssh.uploadFile({
      sessionId: options.sessionId,
      taskId: task.id,
      localPath: options.localPath,
      remotePath: options.remotePath,
      overwrite: options.overwrite ?? false,
    })
    if (findTask(task.id)?.status !== 'cancelled') {
      task.status = 'completed'
      task.transferredBytes = task.totalBytes
      task.completedAt = Date.now()
    }
    return findTask(task.id)?.status === 'completed'
  }
  catch (error) {
    if (findTask(task.id)?.status !== 'cancelled') {
      task.status = 'error'
      task.error = ssh.errorMessage(error)
      task.completedAt = Date.now()
    }
    return false
  }
}

async function download(options: DownloadOptions): Promise<string | null> {
  ensureListener()
  const task = createTask({
    direction: 'download',
    fileName: nameOf(options.remotePath),
    source: options.remotePath,
    target: options.localPath || '临时目录',
    connectionName: options.connectionName ?? '',
  })
  task.status = 'running'

  try {
    const localPath = await ssh.downloadFile({
      sessionId: options.sessionId,
      taskId: task.id,
      remotePath: options.remotePath,
      localPath: options.localPath ?? '',
      overwrite: options.overwrite ?? false,
    })
    if (findTask(task.id)?.status === 'cancelled')
      return null
    task.status = 'completed'
    task.transferredBytes = task.totalBytes
    task.localPath = localPath
    task.target = localPath
    task.completedAt = Date.now()
    return localPath
  }
  catch (error) {
    if (findTask(task.id)?.status !== 'cancelled') {
      task.status = 'error'
      task.error = ssh.errorMessage(error)
      task.completedAt = Date.now()
    }
    return null
  }
}

async function pause(taskId: string): Promise<void> {
  const task = findTask(taskId)
  if (!task || task.status !== 'running')
    return
  task.status = 'paused'
  try {
    await ssh.pauseTransfer(taskId)
  }
  catch (error) {
    task.status = 'running'
    task.error = ssh.errorMessage(error)
  }
}

async function resume(taskId: string): Promise<void> {
  const task = findTask(taskId)
  if (!task || task.status !== 'paused')
    return
  task.status = 'running'
  try {
    await ssh.resumeTransfer(taskId)
  }
  catch (error) {
    task.status = 'paused'
    task.error = ssh.errorMessage(error)
  }
}

async function cancel(taskId: string): Promise<void> {
  const task = findTask(taskId)
  if (!task || !['queued', 'running', 'paused'].includes(task.status))
    return
  const previous = task.status
  task.status = 'cancelled'
  task.completedAt = Date.now()
  try {
    await ssh.cancelTransfer(taskId)
  }
  catch (error) {
    // 极短任务可能恰好已经完成，按后端最终结果恢复，不把控制命令失败算传输失败。
    if (task.status === 'cancelled') {
      task.status = previous
      task.completedAt = 0
    }
    task.error = ssh.errorMessage(error)
  }
}

function clearSettled(): void {
  state.items = state.items.filter(task => ['queued', 'running', 'paused'].includes(task.status))
}

const activeTasks = computed(() => state.items.filter(task => ['queued', 'running', 'paused'].includes(task.status)))
const completedTasks = computed(() => state.items.filter(task => task.status === 'completed'))
const failedTasks = computed(() => state.items.filter(task => task.status === 'error' || task.status === 'cancelled'))

export function useFileTransfers() {
  ensureListener()
  return {
    tasks: readonly(state).items,
    activeTasks,
    completedTasks,
    failedTasks,
    upload,
    download,
    pause,
    resume,
    cancel,
    clearSettled,
  }
}
