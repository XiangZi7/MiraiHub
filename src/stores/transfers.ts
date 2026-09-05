import { computed, onScopeDispose, reactive, watch } from 'vue'
import * as ssh from '@/api/ssh'
import { settingNumber } from '@/composables/useSettings'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { toast } from '@/composables/useToast'
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

const HISTORY_STORAGE_KEY = 'miraihub:file-transfer-history'
const SETTLED_STATUSES: SshTransferStatus[] = [
  'completed',
  'error',
  'cancelled',
]

function loadTransferHistory(): FileTransferTask[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(
      localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]'
    ) as FileTransferTask[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        task =>
          task &&
          typeof task.id === 'string' &&
          SETTLED_STATUSES.includes(task.status)
      )
      .slice(0, 100)
  } catch {
    return []
  }
}

export const useTransfersStore = defineStore('transfers', () => {
  const settings = useSettingsStore().values
  const state = reactive({ items: loadTransferHistory() })
  let disposed = false
  let unlisten: (() => void) | undefined
  onScopeDispose(() => {
    disposed = true
    unlisten?.()
  })
  let listenerReady: Promise<void> | undefined
  let runningJobs = 0

  interface PendingJob {
    taskId: string
    run: () => Promise<void>
    cancel: () => void
  }

  const pendingJobs: PendingJob[] = []

  const settledSnapshot = computed(() =>
    state.items
      .filter(task => SETTLED_STATUSES.includes(task.status))
      .slice(0, 100)
      .map(task => ({ ...task }))
  )

  watch(
    settledSnapshot,
    items => {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items))
      } catch {
        // 存储空间或隐私策略不可用时仍保留本次运行内的传输历史。
      }
    },
    { deep: true, immediate: true }
  )

  function nameOf(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  }

  function newTaskId(): string {
    if ('randomUUID' in crypto) return `transfer-${crypto.randomUUID()}`
    return `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  function findTask(taskId: string): FileTransferTask | undefined {
    return state.items.find(task => task.id === taskId)
  }

  function applyEvent(event: SshTransferEvent): void {
    const task = findTask(event.taskId)
    if (!task) return

    task.status = event.status
    if (event.transferredBytes !== null)
      task.transferredBytes = event.transferredBytes
    if (event.totalBytes !== null) task.totalBytes = event.totalBytes
    if (event.localPath !== null) task.localPath = event.localPath
    if (event.error !== null) task.error = event.error
    if (
      event.status === 'completed' ||
      event.status === 'error' ||
      event.status === 'cancelled'
    )
      task.completedAt = Date.now()
  }

  function ensureListener(): Promise<void> {
    if (!IS_TAURI) return Promise.resolve()
    if (!listenerReady) {
      listenerReady = ssh
        .onTransfer(applyEvent)
        .then(stop => {
          if (disposed) stop()
          else unlisten = stop
        })
        .catch(error => {
          listenerReady = undefined
          console.error('监听文件传输状态失败：', error)
        })
    }
    return listenerReady
  }

  function createTask(
    input: Pick<
      FileTransferTask,
      'direction' | 'fileName' | 'source' | 'target' | 'connectionName'
    >
  ): FileTransferTask {
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

  function pumpQueue(): void {
    const limit = Math.max(1, settingNumber('maxFileTransfers', 3))
    while (runningJobs < limit && pendingJobs.length) {
      const job = pendingJobs.shift()
      if (!job) return
      const task = findTask(job.taskId)
      if (!task || task.status === 'cancelled') {
        job.cancel()
        continue
      }

      runningJobs += 1
      task.status = 'running'
      void job.run().finally(() => {
        runningJobs -= 1
        pumpQueue()
      })
    }
  }

  watch(() => settings.maxFileTransfers, pumpQueue)

  function notifyFinished(task: FileTransferTask): void {
    if (settings.notifyTransferComplete) {
      toast.success({
        title: task.direction === 'upload' ? '上传完成' : '下载完成',
        description: task.fileName,
      })
    }
  }

  function notifyFailed(task: FileTransferTask): void {
    toast.error({
      title: task.direction === 'upload' ? '上传失败' : '下载失败',
      description: task.error || task.fileName,
    })
  }

  async function upload(options: UploadOptions): Promise<boolean> {
    await ensureListener()
    const task = createTask({
      direction: 'upload',
      fileName: nameOf(options.localPath),
      source: options.localPath,
      target: options.remotePath,
      connectionName: options.connectionName ?? '',
    })

    return new Promise<boolean>(resolve => {
      pendingJobs.push({
        taskId: task.id,
        cancel: () => resolve(false),
        run: async () => {
          try {
            await ssh.uploadFile({
              sessionId: options.sessionId,
              taskId: task.id,
              localPath: options.localPath,
              remotePath: options.remotePath,
              overwrite: options.overwrite ?? false,
              bufferSizeKb: settingNumber('transferBufferSizeKb', 128),
            })
            if (findTask(task.id)?.status !== 'cancelled') {
              task.status = 'completed'
              task.transferredBytes = task.totalBytes
              task.completedAt = Date.now()
              notifyFinished(task)
            }
            resolve(findTask(task.id)?.status === 'completed')
          } catch (error) {
            if (findTask(task.id)?.status !== 'cancelled') {
              task.status = 'error'
              task.error = ssh.errorMessage(error)
              task.completedAt = Date.now()
              notifyFailed(task)
            }
            resolve(false)
          }
        },
      })
      pumpQueue()
    })
  }

  async function download(options: DownloadOptions): Promise<string | null> {
    await ensureListener()
    const task = createTask({
      direction: 'download',
      fileName: nameOf(options.remotePath),
      source: options.remotePath,
      target: options.localPath || '临时目录',
      connectionName: options.connectionName ?? '',
    })

    return new Promise<string | null>(resolve => {
      pendingJobs.push({
        taskId: task.id,
        cancel: () => resolve(null),
        run: async () => {
          try {
            const localPath = await ssh.downloadFile({
              sessionId: options.sessionId,
              taskId: task.id,
              remotePath: options.remotePath,
              localPath: options.localPath ?? '',
              overwrite: options.overwrite ?? false,
              bufferSizeKb: settingNumber('transferBufferSizeKb', 128),
            })
            if (findTask(task.id)?.status === 'cancelled') {
              resolve(null)
              return
            }
            task.status = 'completed'
            task.transferredBytes = task.totalBytes
            task.localPath = localPath
            task.target = localPath
            task.completedAt = Date.now()
            notifyFinished(task)
            resolve(localPath)
          } catch (error) {
            if (findTask(task.id)?.status !== 'cancelled') {
              task.status = 'error'
              task.error = ssh.errorMessage(error)
              task.completedAt = Date.now()
              notifyFailed(task)
            }
            resolve(null)
          }
        },
      })
      pumpQueue()
    })
  }

  async function pause(taskId: string): Promise<void> {
    const task = findTask(taskId)
    if (!task || task.status !== 'running') return
    task.status = 'paused'
    try {
      await ssh.pauseTransfer(taskId)
    } catch (error) {
      task.status = 'running'
      task.error = ssh.errorMessage(error)
    }
  }

  async function resume(taskId: string): Promise<void> {
    const task = findTask(taskId)
    if (!task || task.status !== 'paused') return
    task.status = 'running'
    try {
      await ssh.resumeTransfer(taskId)
    } catch (error) {
      task.status = 'paused'
      task.error = ssh.errorMessage(error)
    }
  }

  async function cancel(taskId: string): Promise<void> {
    const task = findTask(taskId)
    if (!task || !['queued', 'running', 'paused'].includes(task.status)) return
    const previous = task.status
    task.status = 'cancelled'
    task.completedAt = Date.now()
    if (previous === 'queued') {
      const index = pendingJobs.findIndex(job => job.taskId === taskId)
      const [job] = index >= 0 ? pendingJobs.splice(index, 1) : []
      job?.cancel()
      return
    }
    try {
      await ssh.cancelTransfer(taskId)
    } catch (error) {
      // 极短任务可能恰好已经结束；保留取消态，后端若已完成会用最终事件覆盖。
      task.error = ssh.errorMessage(error)
    }
  }

  async function pauseAll(): Promise<void> {
    const runningIds = state.items
      .filter(task => task.status === 'running')
      .map(task => task.id)
    await Promise.all(runningIds.map(pause))
  }

  async function resumeAll(): Promise<void> {
    const pausedIds = state.items
      .filter(task => task.status === 'paused')
      .map(task => task.id)
    await Promise.all(pausedIds.map(resume))
  }

  function clearSettled(): void {
    const active = state.items.filter(task =>
      ['queued', 'running', 'paused'].includes(task.status)
    )
    state.items.splice(0, state.items.length, ...active)
  }

  const activeTasks = computed(() =>
    state.items.filter(task =>
      ['queued', 'running', 'paused'].includes(task.status)
    )
  )
  const completedTasks = computed(() =>
    state.items.filter(task => task.status === 'completed')
  )
  const failedTasks = computed(() =>
    state.items.filter(
      task => task.status === 'error' || task.status === 'cancelled'
    )
  )

  return {
    tasks: state.items,
    ensureListener,
    activeTasks,
    completedTasks,
    failedTasks,
    upload,
    download,
    pause,
    resume,
    cancel,
    pauseAll,
    resumeAll,
    clearSettled,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useTransfersStore, import.meta.hot))
