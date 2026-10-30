import { i18n } from '@/i18n'
import { computed, onScopeDispose, reactive, toRef, watch } from 'vue'
import * as ssh from '@/api/ssh'
import { settingNumber } from '@/composables/useSettings'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
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
  /** 数据库导出共用传输队列，读取数据时不伪造字节百分比。 */
  kind?: 'database-export' | 'database-import'
  phase?: 'reading' | 'encoding' | 'writing'
  processedRows?: number
}

export interface ExportTransferContext {
  taskId: string
  signal: AbortSignal
  progress: (
    update: Pick<
      Partial<FileTransferTask>,
      'phase' | 'processedRows' | 'totalBytes' | 'transferredBytes'
    >
  ) => void
  bindCancel: (cancel: () => Promise<void>) => void
}

interface ExportTransferOptions {
  kind?: FileTransferTask['kind']
  onQueued?: (taskId: string) => void
  fileName: string
  source: string
  target: string
  connectionName: string
  run: (context: ExportTransferContext) => Promise<string>
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
  const state = reactive({
    items: loadTransferHistory(),
    // 后台导出入队时打开现有传输中心。
    panelOpen: false,
    // 尚未在导航栏传输中心查看的任务结果。
    unreadTaskIds: [] as string[],
  })
  let disposed = false
  let unlisten: (() => void) | undefined
  onScopeDispose(() => {
    disposed = true
    unlisten?.()
  })
  let listenerReady: Promise<void> | undefined
  let runningJobs = 0
  let runningDatabaseJobs = 0

  interface PendingJob {
    taskId: string
    run: () => Promise<void>
    cancel: () => void
  }

  const pendingJobs: PendingJob[] = []
  const exportControls = new Map<
    string,
    { controller: AbortController; cancelNative?: () => Promise<void> }
  >()

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
    if (Boolean(task.kind) && task.status === 'cancelled') return

    task.status = event.status
    if (event.transferredBytes !== null)
      task.transferredBytes = event.transferredBytes
    if (event.totalBytes !== null) task.totalBytes = event.totalBytes
    if (event.localPath !== null) task.localPath = event.localPath
    if (event.error !== null) task.error = event.error
    if (event.processedRows != null) task.processedRows = event.processedRows
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

  /** 按现有并发设置调度传输；数据库编解码任务串行运行，避免多个工作簿同时争抢内存。 */
  function pumpQueue(): void {
    const limit = Math.min(
      8,
      Math.max(1, Math.floor(settingNumber('maxFileTransfers', 3)))
    )
    while (runningJobs < limit && pendingJobs.length) {
      const databaseRunning = runningDatabaseJobs > 0
      const index = pendingJobs.findIndex(
        job => !databaseRunning || !findTask(job.taskId)?.kind
      )
      if (index < 0) return
      const job = pendingJobs.splice(index, 1)[0]
      if (!job) return
      const task = findTask(job.taskId)
      if (!task || task.status === 'cancelled') {
        job.cancel()
        continue
      }

      runningJobs += 1
      if (task.kind) runningDatabaseJobs += 1
      task.status = 'running'
      void job.run().finally(() => {
        runningJobs -= 1
        if (task.kind) runningDatabaseJobs -= 1
        pumpQueue()
      })
    }
  }

  watch(() => settings.maxFileTransfers, pumpQueue)

  function notifyFinished(task: FileTransferTask): void {
    if (settings.notifyTransferComplete) markUnread(task)
  }

  function notifyFailed(task: FileTransferTask): void {
    markUnread(task)
  }

  function markUnread(task: FileTransferTask): void {
    if (!state.unreadTaskIds.includes(task.id))
      state.unreadTaskIds.push(task.id)
  }

  function markAllSeen(): void {
    state.unreadTaskIds.splice(0)
  }

  function recordUploadError(options: UploadOptions, error: unknown): void {
    const task = createTask({
      direction: 'upload',
      fileName: nameOf(options.localPath),
      source: options.localPath,
      target: options.remotePath,
      connectionName: options.connectionName ?? '',
    })
    task.status = 'error'
    task.error = ssh.errorMessage(error)
    task.completedAt = Date.now()
    notifyFailed(task)
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
              concurrency: Math.min(
                32,
                Math.max(
                  1,
                  Math.floor(settingNumber('folderUploadConcurrency', 12))
                )
              ),
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
      target: options.localPath || i18n.global.t('临时目录'),
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

  /** 只暂停原生文件传输，数据库事务和编解码任务使用取消以保持一致的提交语义。 */
  async function pause(taskId: string): Promise<void> {
    const task = findTask(taskId)
    if (!task || task.status !== 'running' || Boolean(task.kind)) return
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

  /** 取消排队任务或正在执行的传输；数据库任务先终止 Worker，再通知原生查询或事务退出。 */
  async function cancel(taskId: string): Promise<void> {
    const task = findTask(taskId)
    if (!task || !['queued', 'running', 'paused'].includes(task.status)) return
    const previous = task.status
    task.status = 'cancelled'
    task.completedAt = Date.now()
    const exporting = exportControls.get(taskId)
    if (exporting) {
      exporting.controller.abort()
      if (previous === 'queued') {
        const index = pendingJobs.findIndex(job => job.taskId === taskId)
        const [job] = index >= 0 ? pendingJobs.splice(index, 1) : []
        job?.cancel()
        exportControls.delete(taskId)
      }
      await exporting.cancelNative?.().catch(() => {})
      return
    }
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

  /** 数据库导入导出沿用并发限制、取消、完成通知与传输历史。 */
  function exportFile(options: ExportTransferOptions): Promise<string | null> {
    const task = createTask({
      fileName: options.fileName,
      source: options.source,
      target: options.target,
      connectionName: options.connectionName,
      direction: options.kind === 'database-import' ? 'upload' : 'download',
    })
    state.panelOpen = true
    task.kind = options.kind ?? 'database-export'
    task.phase = 'reading'
    const control = {
      controller: new AbortController(),
      cancelNative: undefined as (() => Promise<void>) | undefined,
    }
    exportControls.set(task.id, control)
    options.onQueued?.(task.id)
    return new Promise(resolve => {
      pendingJobs.push({
        taskId: task.id,
        cancel: () => resolve(null),
        run: async () => {
          try {
            await ensureListener()
            control.controller.signal.throwIfAborted()
            const path = await options.run({
              taskId: task.id,
              signal: control.controller.signal,
              progress: update => {
                if (task.status !== 'cancelled') Object.assign(task, update)
              },
              bindCancel: cancel => {
                control.cancelNative = cancel
                if (control.controller.signal.aborted)
                  void cancel().catch(() => {})
              },
            })
            if (task.status !== 'cancelled') {
              task.status = 'completed'
              task.localPath = path
              if (task.kind !== 'database-import') task.target = path
              task.transferredBytes = task.totalBytes || task.transferredBytes
              task.totalBytes = task.transferredBytes
              task.completedAt = Date.now()
              notifyFinished(task)
            }
            resolve(task.status === 'completed' ? path : null)
          } catch (error) {
            if (task.status !== 'cancelled') {
              task.status = 'error'
              task.error = ssh.errorMessage(error)
              task.completedAt = Date.now()
              notifyFailed(task)
            }
            resolve(null)
          } finally {
            exportControls.delete(task.id)
          }
        },
      })
      pumpQueue()
    })
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

  async function cancelAll(): Promise<void> {
    const activeIds = state.items
      .filter(task => ['queued', 'running', 'paused'].includes(task.status))
      .map(task => task.id)
    await Promise.all(activeIds.map(cancel))
  }

  function clearSettled(): void {
    const active = state.items.filter(task =>
      ['queued', 'running', 'paused'].includes(task.status)
    )
    state.items.splice(0, state.items.length, ...active)
    markAllSeen()
  }

  const unreadCount = computed(() => state.unreadTaskIds.length)
  const hasUnreadError = computed(() =>
    state.items.some(
      task => task.status === 'error' && state.unreadTaskIds.includes(task.id)
    )
  )

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
    panelOpen: toRef(state, 'panelOpen'),
    ensureListener,
    activeTasks,
    completedTasks,
    failedTasks,
    unreadCount,
    hasUnreadError,
    markAllSeen,
    recordUploadError,
    upload,
    download,
    exportFile,
    pause,
    resume,
    cancel,
    pauseAll,
    resumeAll,
    cancelAll,
    clearSettled,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useTransfersStore, import.meta.hot))
