import { assertOfficeFileSize, extractOfficeText } from './spreadsheet-extract'
import type { OfficeWorkerResult } from './agent-office-worker'

self.onmessage = async (event: MessageEvent<File>) => {
  const file = event.data
  let result: OfficeWorkerResult
  try {
    assertOfficeFileSize(file.size)
    const bytes = new Uint8Array(await file.arrayBuffer())
    result = { ok: true, text: await extractOfficeText(file.name, bytes) }
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  self.postMessage(result)
}
