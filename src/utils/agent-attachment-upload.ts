import * as agent from '@/api/agent'
import type { AgentStoredAttachment } from '@/types/agent'

export interface AttachmentUploader {
  begin(name: string): Promise<string>
  append(id: string, index: number, content: string): Promise<void>
  finish(id: string): Promise<AgentStoredAttachment>
  discard(id: string): Promise<void>
}

export const attachmentUploader: AttachmentUploader = {
  begin: agent.beginAttachment,
  append: agent.appendAttachment,
  finish: agent.finishAttachment,
  discard: agent.discardAttachment,
}

export interface AttachmentReadOptions {
  signal?: AbortSignal
  onProgress?: (bytes: number, total: number) => void
  uploader?: AttachmentUploader
}

export function checkAttachmentRead(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

/** Decode bounded UTF-8 chunks without materializing the whole source file. */
export async function* textFileChunks(
  file: File,
  options: AttachmentReadOptions
): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const chunkSize = 128_000
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    checkAttachmentRead(options.signal)
    const end = Math.min(file.size, offset + chunkSize)
    const bytes = await file.slice(offset, end).arrayBuffer()
    checkAttachmentRead(options.signal)
    const content = decoder.decode(bytes, { stream: end < file.size })
    if (content) yield content
    options.onProgress?.(end, file.size)
  }
}

/** Office extraction already yields text; split on code points for bounded IPC. */
export async function* textChunks(content: string): AsyncGenerator<string> {
  for (let offset = 0; offset < content.length;) {
    let end = Math.min(content.length, offset + 32_000)
    if (end < content.length && /[\uD800-\uDBFF]/u.test(content[end - 1])) end--
    yield content.slice(offset, end)
    offset = end
  }
}

export async function uploadTextAttachment(
  name: string,
  chunks: AsyncIterable<string>,
  options: AttachmentReadOptions
): Promise<AgentStoredAttachment> {
  const uploader = options.uploader ?? attachmentUploader
  checkAttachmentRead(options.signal)
  const id = await uploader.begin(name)
  try {
    let index = 0
    let hasText = false
    for await (const content of chunks) {
      checkAttachmentRead(options.signal)
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content))
        throw new Error('Invalid text attachment')
      hasText ||= !!content.trim()
      await uploader.append(id, index++, content)
    }
    checkAttachmentRead(options.signal)
    if (!hasText) throw new Error('Empty text attachment')
    const result = await uploader.finish(id)
    checkAttachmentRead(options.signal)
    return result
  } catch (error) {
    await uploader.discard(id).catch(() => {})
    throw error
  }
}
