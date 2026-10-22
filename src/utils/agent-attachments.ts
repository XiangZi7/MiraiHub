import { i18n } from '@/i18n'
import type { AgentDraftAttachment } from '@/types/agent'
import { isOfficeExtension } from '@/utils/spreadsheet-extract'
import { readOfficeText } from '@/utils/agent-office-worker'
import { IS_TAURI } from '@/utils/window'
import {
  checkAttachmentRead,
  textChunks,
  textFileChunks,
  uploadTextAttachment,
  type AttachmentReadOptions,
} from '@/utils/agent-attachment-upload'

export const AGENT_MAX_FILES = 16
export const AGENT_MAX_IMAGES = 4
export const AGENT_MAX_PROMPT_BYTES = 256_000
export const AGENT_MAX_FILE_BYTES = 1_000_000_000
export const AGENT_MAX_ATTACHMENT_BYTES = 1_000_000_000
export const AGENT_MAX_IMAGE_BYTES = 5_000_000
export const AGENT_FILE_ACCEPT =
  '.txt,.md,.log,.json,.csv,.tsv,.yaml,.yml,.xml,.sql,.sh,.bash,.zsh,.ps1,.conf,.ini,.toml,.properties,.js,.jsx,.ts,.tsx,.vue,.py,.rs,.go,.java,.c,.h,.cpp,.css,.html,.env,.gitignore,.dockerfile,.xlsx,.xlsm,.xls,.docx,.pptx,.ods,text/*,image/png,image/jpeg,image/gif,image/webp'

const imageTypes: Record<
  string,
  NonNullable<AgentDraftAttachment['mimeType']>
> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Use paste-event data directly; plain text keeps the browser's normal paste behavior. */
export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  return (files.length ? files : Array.from(data.files ?? [])).filter(
    file =>
      file.type.startsWith('image/') ||
      !!imageTypes[file.name.split('.').pop()?.toLowerCase() ?? '']
  )
}

export function agentImageUrl(file: AgentDraftAttachment): string {
  return file.mimeType ? `data:${file.mimeType};base64,${file.content}` : ''
}

async function readImageAttachment(
  file: File,
  mimeType: NonNullable<AgentDraftAttachment['mimeType']>
): Promise<AgentDraftAttachment> {
  if (file.size > AGENT_MAX_IMAGE_BYTES)
    throw new Error(
      i18n.global.t('{value0}：单张图片不能超过 5 MB', { value0: file.name })
    )
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return {
    id: crypto.randomUUID(),
    name: file.name,
    content: btoa(binary),
    size: bytes.length,
    mimeType,
  }
}

/** Human-readable byte count (KB/MB/GB), shared by the composer and errors. */
export function bytesToSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

/** Readable preview of a binary office/table attachment for the model. */
async function readOfficeAttachment(
  file: File,
  name: string,
  signal?: AbortSignal
): Promise<{ content: string; size: number }> {
  try {
    const text = await readOfficeText(file, signal)
    if (!text.trim())
      throw new Error(i18n.global.t('无法从该文件中提取文本内容'))
    return { content: text, size: new TextEncoder().encode(text).length }
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(
      i18n.global.t('{value0}：无法解析该文件，请转换为 CSV/文本后重试', {
        value0: name,
      }) + (error instanceof Error ? ` (${i18n.global.t(error.message)})` : '')
    )
  }
}

export async function readAgentAttachment(
  file: File,
  options: AttachmentReadOptions = {}
): Promise<AgentDraftAttachment> {
  checkAttachmentRead(options.signal)
  if (!file.size)
    throw new Error(i18n.global.t('{value0}：文件为空', { value0: file.name }))
  if (file.size > AGENT_MAX_FILE_BYTES)
    throw new Error(
      i18n.global.t('{value0}：单个文件不能超过 1 GB', { value0: file.name })
    )
  if (
    !file.name.trim() ||
    new TextEncoder().encode(file.name).length > 255 ||
    /[\u0000-\u001f\u007f/\\]/u.test(file.name)
  )
    throw new Error(i18n.global.t('附件文件名无效'))

  const name = file.name

  const imageType = imageTypes[name.split('.').pop()?.toLowerCase() ?? '']
  if (file.type?.startsWith('image/') || imageType) {
    const mimeType = Object.values(imageTypes).find(
      type => type === (file.type || imageType)
    )
    if (!mimeType)
      throw new Error(
        i18n.global.t('{value0}：请选择 PNG、JPEG、GIF 或 WebP 图片', {
          value0: name,
        })
      )
    return readImageAttachment(file, mimeType)
  }

  // Office containers (.xlsx/.xlsm/.docx/.pptx/.ods and common .xls) get
  // parsed into readable text so the agent can actually use their content.
  if (isOfficeExtension(name)) {
    const { content, size } = await readOfficeAttachment(
      file,
      name,
      options.signal
    )
    checkAttachmentRead(options.signal)
    if (size > AGENT_MAX_FILE_BYTES)
      throw new Error(
        i18n.global.t('{value0}：单个文件不能超过 1 GB', { value0: name })
      )
    if (IS_TAURI || options.uploader) {
      const stored = await uploadTextAttachment(
        name,
        textChunks(content),
        options
      )
      options.onProgress?.(file.size, file.size)
      return {
        id: stored.id,
        attachmentId: stored.id,
        name: stored.name,
        content: stored.preview,
        size: stored.size,
      }
    }
    return { id: crypto.randomUUID(), name, content, size }
  }

  if (IS_TAURI || options.uploader) {
    try {
      const stored = await uploadTextAttachment(
        name,
        textFileChunks(file, options),
        options
      )
      return {
        id: stored.id,
        attachmentId: stored.id,
        name: stored.name,
        content: stored.preview,
        size: stored.size,
      }
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (
        error instanceof TypeError ||
        (error instanceof Error &&
          /^(Invalid|Empty) text attachment$/.test(error.message))
      )
        throw new Error(
          i18n.global.t('{value0}：请选择非空的 UTF-8 文本文件', {
            value0: name,
          })
        )
      throw error
    }
  }

  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(
      await file.arrayBuffer()
    )
  } catch {
    throw new Error(
      i18n.global.t('{value0}：请选择 UTF-8 文本、日志或代码文件', {
        value0: name,
      })
    )
  }
  if (
    !content.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)
  )
    throw new Error(
      i18n.global.t('{value0}：请选择非空的文本文件，不支持二进制文件', {
        value0: name,
      })
    )
  return {
    id: crypto.randomUUID(),
    name,
    content,
    size: new TextEncoder().encode(content).length,
  }
}
