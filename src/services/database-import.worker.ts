import {
  createImportTemplate,
  parseImportWorkbook,
} from '@/utils/database-import'

/** Excel 解析与模板压缩独立于界面运行，避免用户上传工作簿时阻塞输入和绘制。 */
self.onmessage = async (event: MessageEvent) => {
  try {
    if (event.data.action === 'parse')
      self.postMessage({ sources: await parseImportWorkbook(event.data.bytes) })
    else {
      const bytes = await createImportTemplate(event.data.targets)
      self.postMessage({ bytes }, { transfer: [bytes.buffer] })
    }
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
