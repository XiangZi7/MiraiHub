import * as database from '@/api/database'
import { cancelTransfer } from '@/api/ssh'
import {
  useTransfersStore,
  type ExportTransferContext,
} from '@/stores/transfers'
import type {
  DatabaseDataExportFormat,
  DatabaseExportData,
  DatabaseExportLoader,
} from '@/types/database-export'
import { databaseExportFormats } from '@/utils/database-export'
import { IS_TAURI } from '@/utils/window'

/** 从队列任务开始到保存完成都持有同一个传输 id。 */
export async function withDatabaseExportTransfer<T>(
  context: ExportTransferContext,
  run: () => Promise<T>
): Promise<T> {
  if (!IS_TAURI) return run()
  await database.beginExportFile(context.taskId)
  context.bindCancel(() => cancelTransfer(context.taskId))
  try {
    context.signal.throwIfAborted()
    return await run()
  } finally {
    await database.finishExportFile(context.taskId)
  }
}

/** 固定导出配置并加入现有传输中心，读取、后台编码和文件落盘全程支持取消。 */
export function enqueueDatabaseDataExport(options: {
  data: DatabaseExportData
  format: DatabaseDataExportFormat
  tableName: string
  path: string
  connectionName?: string
  loadAll?: DatabaseExportLoader
}): Promise<string | null> {
  const { data: source, format, tableName, path, loadAll } = options
  const definition = databaseExportFormats.find(item => item.id === format)!
  return useTransfersStore().exportFile({
    fileName:
      path.split(/[\\/]/u).at(-1) || `${source.name}.${definition.extension}`,
    source: [source.schema, source.name].filter(Boolean).join('.'),
    target: path,
    connectionName: options.connectionName || source.schema || source.name,
    run: context =>
      withDatabaseExportTransfer(context, async () => {
        const worker = new Worker(
          new URL('./database-export.worker.ts', import.meta.url),
          { type: 'module' }
        )
        const browserParts: BlobPart[] = []
        let written = 0,
          rows = 0,
          requestId = 0
        /** 一次只发送一批并等待写盘完成，Worker 和 IPC 之间保持背压，不累计待写数据。 */
        async function encode(
          action: string,
          payload: Record<string, unknown> = {}
        ): Promise<void> {
          context.signal.throwIfAborted()
          const id = ++requestId
          const bytes = await new Promise<Uint8Array>((resolve, reject) => {
            /** 当前批次结束后移除监听器；取消立即终止后台编码。 */
            const cleanup = (): void => {
              worker.removeEventListener('message', receive)
              worker.removeEventListener('error', fail)
              context.signal.removeEventListener('abort', abort)
            }
            /** 只接收当前请求的结果，将底层 ArrayBuffer 直接交还主线程。 */
            const receive = (event: MessageEvent): void => {
              if (event.data.id !== id) return
              cleanup()
              if (event.data.error) reject(new Error(event.data.error))
              else resolve(event.data.bytes)
            }
            /** Worker 加载或编码异常转成传输任务失败。 */
            const fail = (event: ErrorEvent): void => {
              cleanup()
              reject(new Error(event.message))
            }
            /** 用户取消时中止压缩和编码，不必等待整个工作簿生成完。 */
            const abort = (): void => {
              cleanup()
              worker.terminate()
              reject(new DOMException('Export cancelled', 'AbortError'))
            }
            worker.addEventListener('message', receive)
            worker.addEventListener('error', fail)
            context.signal.addEventListener('abort', abort, { once: true })
            worker.postMessage({ id, action, ...payload })
          })
          for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
            context.signal.throwIfAborted()
            const chunk = bytes.subarray(offset, offset + 256 * 1024)
            if (IS_TAURI)
              await database.writeExportChunk(path, chunk, context.taskId)
            else browserParts.push(chunk.slice())
            written += chunk.length
          }
          context.progress({ transferredBytes: written, processedRows: rows })
        }
        try {
          context.progress({ phase: 'reading', processedRows: 0 })
          await encode('start', {
            source: {
              ...source,
              detail: undefined,
              rows: [],
              columns: source.columns.map(column => ({ ...column })),
            },
            format,
            tableName,
          })
          /** 写完一批再取下一批，Excel 和文本编码始终在 Worker 内完成。 */
          const onRows = async (
            batch: DatabaseExportData['rows']
          ): Promise<void> => {
            context.progress({ phase: 'encoding' })
            await encode('rows', { rows: batch.map(row => Array.from(row)) })
            rows += batch.length
            context.progress({ phase: 'reading', processedRows: rows })
          }
          if (format !== 'dictionary') {
            if (loadAll)
              await loadAll({
                signal: context.signal,
                onProgress: count => context.progress({ processedRows: count }),
                onRows,
              })
            else
              for (let offset = 0; offset < source.rows.length; offset += 200)
                await onRows(source.rows.slice(offset, offset + 200))
          }
          context.progress({ phase: 'encoding' })
          await encode('finish')
          context.progress({
            phase: 'writing',
            totalBytes: written,
            transferredBytes: written,
          })
          context.signal.throwIfAborted()
          if (IS_TAURI)
            await database.writeExportChunk(
              path,
              new Uint8Array(),
              context.taskId,
              true
            )
          else {
            const url = URL.createObjectURL(
              new Blob(browserParts, { type: definition.mime })
            )
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = path
            anchor.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }
        } finally {
          worker.terminate()
        }
        return path
      }),
  })
}
