import { assertOfficeFileSize, extractOfficeText } from './spreadsheet-extract'

export type OfficeWorkerResult =
  { ok: true; text: string } | { ok: false; error: string }

/** One worker owns one file, so cancellation can release its parsing buffers immediately. */
export function officeTextFromWorker(
  worker: Worker,
  file: File,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (action: () => void): void => {
      signal?.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      action()
    }
    const abort = (): void =>
      finish(() => reject(new DOMException('Aborted', 'AbortError')))
    if (signal?.aborted) {
      abort()
      return
    }
    worker.onmessage = (event: MessageEvent<OfficeWorkerResult>) => {
      const result = event.data
      finish(() => {
        if (result.ok) resolve(result.text)
        else reject(new Error(result.error))
      })
    }
    worker.onerror = event => {
      event.preventDefault()
      finish(() =>
        reject(new Error('Office 文件解析失败，请重新导出或转换为 CSV 后重试'))
      )
    }
    worker.onmessageerror = () =>
      finish(() => reject(new Error('Office 文件解析结果无法读取，请重试')))
    signal?.addEventListener('abort', abort, { once: true })
    try {
      // File is structured-cloned without eagerly allocating its bytes on the UI thread.
      worker.postMessage(file)
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

export async function readOfficeText(
  file: File,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  assertOfficeFileSize(file.size)
  if (typeof Worker === 'undefined') {
    // Node tests and non-browser consumers share the exact same parser.
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const text = await extractOfficeText(file.name, bytes)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return text
  }
  const worker = new Worker(
    new URL('./agent-office.worker.ts', import.meta.url),
    {
      type: 'module',
      name: 'mirai-office-extraction',
    }
  )
  return officeTextFromWorker(worker, file, signal)
}
