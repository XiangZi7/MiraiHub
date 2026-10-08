import { i18n } from '@/i18n'
import { onScopeDispose, reactive, toRefs } from 'vue'
import type {
  AgentAttachment,
  AgentContextRequest,
  AgentDraftAttachment,
} from '@/types/agent'
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
  function clearAttachments(): void {
    version++
    readVersion++
    state.attachments = []
    state.reading = false
    state.attachmentError = ''
  }
  function reset(): void {
    clearAttachments()
    state.prompt = ''
  }
  async function addFiles(files: File[]): Promise<void> {
    if (state.reading || !files.length) return
    const token = ++readVersion
    state.attachmentError = ''
    if (state.attachments.length + files.length > AGENT_MAX_FILES) {
      state.attachmentError = i18n.global.t('每条消息最多添加 4 个文件')
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
        throw new Error(i18n.global.t('附件总大小不能超过 1 GB'))
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
  function addContext(request: AgentContextRequest): boolean {
    if (state.reading) return false
    state.attachmentError = ''
    if (state.attachments.length >= AGENT_MAX_FILES) {
      state.attachmentError = i18n.global.t('每条消息最多添加 4 个文件')
      return false
    }
    const content = request.content
    const size = new TextEncoder().encode(content).length
    if (
      !content.trim() ||
      size > 64000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)
    ) {
      state.attachmentError = i18n.global.t('选区须为非空文本，最多 64 KB')
      return false
    }
    if (
      state.attachments.reduce((sum, file) => sum + file.size, size) >
      AGENT_MAX_ATTACHMENT_BYTES
    ) {
      state.attachmentError = i18n.global.t('附件总大小不能超过 1 GB')
      return false
    }
    state.attachments.push({
      id: request.id,
      name: i18n.global.t(
        request.source === 'terminal' ? '终端选区.txt' : 'SQL 选区.sql'
      ),
      content,
      size,
      source: 'context',
    })
    if (!state.prompt.trim())
      state.prompt = i18n.global.t(
        request.intent === 'optimize'
          ? '请分析附加 SQL 的性能，并给出优化建议。'
          : request.source === 'terminal'
            ? '请分析附加的终端输出，解释问题并建议下一步。'
            : '请解释附加 SQL 的用途，并检查可能的问题。'
      )
    return true
  }
  async function submit(): Promise<void> {
    if (state.reading || (!state.prompt.trim() && !state.attachments.length))
      return
    const prompt = state.prompt
    const attachments = [...state.attachments]
    reset()
    const token = version
    const accepted = await send(
      prompt.trim() ? prompt : i18n.global.t('agent.analyzeAttachments'),
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
  return {
    ...toRefs(state),
    reset,
    clearAttachments,
    addFiles,
    addContext,
    removeFile,
    submit,
  }
}
