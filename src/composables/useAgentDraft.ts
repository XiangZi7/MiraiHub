import { onScopeDispose, reactive, toRefs } from 'vue'
import type { AgentAttachment, AgentDraftAttachment } from '@/types/agent'
import {
  AGENT_MAX_FILES,
  AGENT_MAX_ATTACHMENT_BYTES,
  readAgentAttachment,
} from '@/utils/agent-attachments'

export function useAgentDraft(
  send: (prompt: string, attachments: AgentAttachment[]) => Promise<boolean>
) {
  // 响应式状态
  const state = reactive({
    // 当前消息草稿
    prompt: '',
    // 已读取、尚未发送的附件
    attachments: [] as AgentDraftAttachment[],
    // 文件读取状态
    reading: false,
    // 文件读取或容量错误
    attachmentError: '',
  })
  let version = 0
  let readVersion = 0
  function reset(): void {
    version++
    readVersion++
    state.prompt = ''
    state.attachments = []
    state.reading = false
    state.attachmentError = ''
  }
  async function addFiles(files: File[]): Promise<void> {
    if (state.reading || !files.length) return
    const token = ++readVersion
    state.attachmentError = ''
    if (state.attachments.length + files.length > AGENT_MAX_FILES) {
      state.attachmentError = '每条消息最多添加 4 个文件'
      return
    }
    state.reading = true
    try {
      // 整批成功后才加入草稿；失败不会悄悄发送一部分文件。
      const incoming = await Promise.all(files.map(readAgentAttachment))
      if (token !== readVersion) return
      const combined = [...state.attachments, ...incoming]
      if (
        combined.reduce((sum, file) => sum + file.size, 0) >
        AGENT_MAX_ATTACHMENT_BYTES
      )
        throw new Error('附件总大小不能超过 128 KB')
      state.attachments = combined
    } catch (error) {
      if (token === readVersion)
        state.attachmentError =
          error instanceof Error ? error.message : String(error)
    } finally {
      if (token === readVersion) state.reading = false
    }
  }
  function removeFile(id: string): void {
    state.attachments = state.attachments.filter(file => file.id !== id)
    state.attachmentError = ''
  }
  async function submit(): Promise<void> {
    if (state.reading || (!state.prompt.trim() && !state.attachments.length))
      return
    const prompt = state.prompt
    const attachments = [...state.attachments]
    reset()
    const token = version
    const accepted = await send(
      prompt,
      attachments.map(({ name, content }) => ({ name, content }))
    )
    if (
      !accepted &&
      token === version &&
      !state.prompt &&
      !state.attachments.length &&
      !state.reading
    ) {
      state.prompt = prompt
      state.attachments = attachments
    }
  }
  onScopeDispose(reset)
  return { ...toRefs(state), reset, addFiles, removeFile, submit }
}
