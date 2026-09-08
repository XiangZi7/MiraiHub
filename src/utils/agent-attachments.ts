import type { AgentDraftAttachment } from '@/types/agent'

export const AGENT_MAX_FILES = 4
export const AGENT_MAX_FILE_BYTES = 64_000
export const AGENT_MAX_ATTACHMENT_BYTES = 128_000
export const AGENT_FILE_ACCEPT =
  '.txt,.md,.log,.json,.csv,.tsv,.yaml,.yml,.xml,.sql,.sh,.bash,.zsh,.ps1,.conf,.ini,.toml,.properties,.js,.jsx,.ts,.tsx,.vue,.py,.rs,.go,.java,.c,.h,.cpp,.css,.html,.env,.gitignore,.dockerfile,text/*'

export async function readAgentAttachment(
  file: File
): Promise<AgentDraftAttachment> {
  if (!file.size) throw new Error(`${file.name}：文件为空`)
  if (file.size > AGENT_MAX_FILE_BYTES)
    throw new Error(`${file.name}：单个文件不能超过 64 KB`)
  if (
    !file.name.trim() ||
    new TextEncoder().encode(file.name).length > 255 ||
    /[\u0000-\u001f\u007f/\\]/u.test(file.name)
  )
    throw new Error('附件文件名无效')
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(
      await file.arrayBuffer()
    )
  } catch {
    throw new Error(`${file.name}：请选择 UTF-8 文本、日志或代码文件`)
  }
  if (
    !content.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)
  )
    throw new Error(`${file.name}：请选择非空的文本文件，不支持二进制文件`)
  return {
    id: crypto.randomUUID(),
    name: file.name,
    content,
    size: new TextEncoder().encode(content).length,
  }
}
