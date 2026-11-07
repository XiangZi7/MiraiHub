import type { DatabaseImportSource } from '@/types/database-import'

/** 发往数据库 Worker 的一次性 Excel 请求；导出流式消息由 services/database-export 自行发送。 */
export type DatabaseWorkbookRequest =
  | { action: 'parse'; bytes: Uint8Array }
  | { action: 'template'; targets: unknown }
  | { action: 'workbook'; data: unknown }

export interface DatabaseWorkbookReply {
  sources?: DatabaseImportSource[]
  bytes?: Uint8Array
}

/** 一个 Worker 只处理一个请求；结束、失败或取消都立即终止，释放工作簿内存。 */
export function workbookFromWorker(
  worker: Worker,
  request: DatabaseWorkbookRequest,
  transfer: Transferable[] = [],
  signal?: AbortSignal
): Promise<DatabaseWorkbookReply> {
  return new Promise((resolve, reject) => {
    /** 结果返回后解除监听并释放 Worker。 */
    const finish = (action: () => void): void => {
      signal?.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      action()
    }
    /** 用户取消时中止解析或压缩，不必等待整个工作簿处理完。 */
    const abort = (): void =>
      finish(() => reject(new DOMException('Cancelled', 'AbortError')))
    if (signal?.aborted) {
      abort()
      return
    }
    // Worker 内的错误文案原样转成 Error，调用方的提示保持不变。
    worker.onmessage = (event: MessageEvent) =>
      finish(() =>
        event.data.error
          ? reject(new Error(event.data.error))
          : resolve(event.data)
      )
    worker.onerror = event => finish(() => reject(new Error(event.message)))
    signal?.addEventListener('abort', abort, { once: true })
    try {
      worker.postMessage({ id: 0, ...request }, transfer)
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

/** 主线程的 Excel 读写统一转发给导出 Worker，ExcelJS 只打包进这一个 Worker。 */
export function runDatabaseWorkbook(
  request: DatabaseWorkbookRequest,
  transfer: Transferable[] = [],
  signal?: AbortSignal
): Promise<DatabaseWorkbookReply> {
  if (signal?.aborted)
    return Promise.reject(new DOMException('Cancelled', 'AbortError'))
  const worker = new Worker(
    new URL('../services/database-export.worker.ts', import.meta.url),
    { type: 'module' }
  )
  return workbookFromWorker(worker, request, transfer, signal)
}
