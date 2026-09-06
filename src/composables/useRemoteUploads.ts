import { onScopeDispose, reactive, toRefs } from 'vue'
import * as ssh from '@/api/ssh'
import { useFileTransfers } from '@/composables/useFileTransfers'
import { useSettings } from '@/composables/useSettings'

type ConflictAction = 'overwrite' | 'skip' | 'cancel'
interface ConflictDecision {
  action: ConflictAction
  always: boolean
}

interface UploadContext {
  sessionId: string
  connectionName: string
  directory: string
}

export function useRemoteUploads(options: {
  context: () => UploadContext
  refresh: () => Promise<unknown>
}) {
  const transfers = useFileTransfers()
  const { settings } = useSettings()
  // 响应式状态
  const state = reactive({
    // 是否显示同名冲突确认。
    conflictOpen: false,
    // 当前冲突的文件或目录名称。
    conflictFileName: '',
    // 本批次尚未处理的项目数。
    conflictRemaining: 0,
    // 是否将当前决定应用到后续冲突。
    conflictAlways: false,
  })
  let resolveConflict: ((decision: ConflictDecision) => void) | undefined
  let pendingBatch = Promise.resolve()
  let disposed = false

  function settleConflict(action: ConflictAction): void {
    const resolver = resolveConflict
    resolveConflict = undefined
    state.conflictOpen = false
    resolver?.({ action, always: state.conflictAlways })
  }

  onScopeDispose(() => {
    disposed = true
    settleConflict('cancel')
  })

  function askConflict(
    fileName: string,
    remaining: number
  ): Promise<ConflictDecision> {
    state.conflictFileName = fileName
    state.conflictRemaining = remaining
    state.conflictAlways = false
    state.conflictOpen = true
    return new Promise(resolve => {
      resolveConflict = resolve
    })
  }

  function childPath(directory: string, name: string): string {
    return `${directory.replace(/\/$/, '')}/${name}`
  }

  async function availablePath(
    context: UploadContext,
    name: string,
    targets: ReadonlyMap<string, Promise<unknown>>
  ): Promise<string> {
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    for (let index = 1; index < 10_000; index++) {
      const candidate = childPath(
        context.directory,
        `${base} (${index})${extension}`
      )
      if (
        !targets.has(candidate) &&
        !(await ssh.pathExists(context.sessionId, candidate))
      )
        return candidate
    }
    throw new Error('无法为上传项目生成可用名称')
  }

  async function runBatch(
    context: UploadContext,
    paths: readonly string[]
  ): Promise<void> {
    let policy: Exclude<ConflictAction, 'cancel'> | undefined
    let attempted = false
    const pendingUploads: Promise<unknown>[] = []
    const targets = new Map<string, Promise<unknown>>()
    const behavior = settings.overwriteBehavior
    for (let index = 0; index < paths.length; index++) {
      if (disposed) break
      const localPath = paths[index]
      if (!localPath) continue
      const name = localPath.split(/[\\/]/).filter(Boolean).at(-1) ?? localPath
      let remotePath = childPath(context.directory, name)
      try {
        // 相同目标仍顺序处理，让冲突检查看到前一个上传的结果。
        await targets.get(remotePath)
        const exists = await ssh.pathExists(context.sessionId, remotePath)
        let overwrite = false
        if (exists) {
          if (behavior === 'rename')
            remotePath = await availablePath(context, name, targets)
          else {
            let action: ConflictAction =
              behavior === 'overwrite' ? 'overwrite' : (policy ?? 'cancel')
            if (behavior !== 'overwrite' && !policy) {
              if (disposed) break
              const decision = await askConflict(name, paths.length - index - 1)
              action = decision.action
              if (decision.always && action !== 'cancel') policy = action
            }
            if (action === 'cancel') break
            if (action === 'skip') continue
            overwrite = true
          }
        }
        if (disposed) break
        attempted = true
        const upload = transfers
          .upload({ ...context, localPath, remotePath, overwrite })
          .catch(error => {
            transfers.recordUploadError(
              { ...context, localPath, remotePath },
              error
            )
          })
        targets.set(remotePath, upload)
        pendingUploads.push(upload)
      } catch (error) {
        transfers.recordUploadError(
          { ...context, localPath, remotePath },
          error
        )
      }
    }
    // 只串行询问冲突，实际传输由全局队列按并发设置调度。
    await Promise.all(pendingUploads)
    const current = options.context()
    // 失败或取消也可能已上传部分内容；只刷新仍在显示的原始目标。
    if (
      attempted &&
      !disposed &&
      current.sessionId === context.sessionId &&
      current.directory === context.directory
    )
      await options.refresh()
  }

  function uploadPaths(localPaths: readonly string[]): Promise<void> {
    const context = { ...options.context() }
    if (!context.sessionId || !context.directory || !localPaths.length)
      return Promise.resolve()
    const paths = [...localPaths]
    // 连续拖放共享一个冲突确认框，按批次处理以免覆盖待确认的决定。
    const batch = pendingBatch.then(() => runBatch(context, paths))
    pendingBatch = batch.catch(() => {})
    return batch
  }

  return { ...toRefs(state), settleConflict, uploadPaths }
}
