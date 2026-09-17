import { i18n } from '@/i18n'
import type { AgentDraftAttachment } from '@/types/agent'
import {
  extractOfficeText,
  isOfficeExtension,
} from '@/utils/spreadsheet-extract'

export const AGENT_MAX_FILES = 4
export const AGENT_MAX_FILE_BYTES = 1_000_000_000
export const AGENT_MAX_ATTACHMENT_BYTES = 1_000_000_000
export const AGENT_FILE_ACCEPT =
  '.txt,.md,.log,.json,.csv,.tsv,.yaml,.yml,.xml,.sql,.sh,.bash,.zsh,.ps1,.conf,.ini,.toml,.properties,.js,.jsx,.ts,.tsx,.vue,.py,.rs,.go,.java,.c,.h,.cpp,.css,.html,.env,.gitignore,.dockerfile,.xlsx,.xlsm,.xls,.docx,.pptx,.ods,text/*'

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
  name: string
): Promise<{ content: string; size: number }> {
  try {
    const buffer = await file.arrayBuffer()
    const text = await extractOfficeText(name, new Uint8Array(buffer))
    if (!text.trim())
      throw new Error(i18n.global.t('无法从该文件中提取文本内容'))
    return { content: text, size: new TextEncoder().encode(text).length }
  } catch {
    throw new Error(
      i18n.global.t('{value0}：无法解析该文件，请转换为 CSV/文本后重试', {
        value0: name,
      })
    )
  }
}

export async function readAgentAttachment(
  file: File
): Promise<AgentDraftAttachment> {
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

  // Office containers (.xlsx/.xlsm/.docx/.pptx/.ods and common .xls) get
  // parsed into readable text so the agent can actually use their content.
  if (isOfficeExtension(name)) {
    const { content, size } = await readOfficeAttachment(file, name)
    return { id: crypto.randomUUID(), name, content, size }
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
