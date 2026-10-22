import { i18n } from '@/i18n'
import { onScopeDispose, reactive, toRefs } from 'vue'
import { discardAttachment } from '@/api/agent'
import type {
  AgentAttachment,
  AgentContextRequest,
  AgentDraftAttachment,
} from '@/types/agent'
import {
  AGENT_MAX_FILES,
  AGENT_MAX_IMAGES,
  AGENT_MAX_PROMPT_BYTES,
  AGENT_MAX_ATTACHMENT_BYTES,
  bytesToSize,
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
    // 当前文件及已处理字节，便于大附件读取时了解进度
    readingProgress: '',
    // 文件读取或容量错误
    attachmentError: '',
  })
  let version = 0
  let readVersion = 0
  let readController: AbortController | undefined
  function release(files: AgentDraftAttachment[]): void {
    for (const file of files)
      if (file.attachmentId)
        void discardAttachment(file.attachmentId).catch(() => {})
  }
  function cancelReading(): void {
    readVersion++
    readController?.abort()
    readController = undefined
    state.reading = false
    state.readingProgress = ''
  }
  function clearAttachments(discard = true): void {
    version++
    cancelReading()
    if (discard) release(state.attachments)
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
      state.attachmentError = i18n.global.t(
        '每条消息最多添加 16 个文件，其中图片最多 4 张'
      )
      return
    }
    if (
      state.attachments.reduce((sum, file) => sum + file.size, 0) +
        files.reduce((sum, file) => sum + file.size, 0) >
      AGENT_MAX_ATTACHMENT_BYTES
    ) {
      state.attachmentError = i18n.global.t('附件总大小不能超过 1 GB')
      return
    }
    const controller = new AbortController()
    readController = controller
    state.reading = true
    const incoming: AgentDraftAttachment[] = []
    try {
      // 整批成功后才加入草稿；失败不会悄悄发送一部分文件。
      // 逐个分块处理，避免多个大文件同时占用内存。
      for (const [index, file] of files.entries()) {
        state.readingProgress = i18n.global.t('agent.attachmentProgress', {
          current: index + 1,
          total: files.length,
          name: file.name,
          size: bytesToSize(0),
          totalSize: bytesToSize(file.size),
        })
        incoming.push(
          await readAgentAttachment(file, {
            signal: controller.signal,
            onProgress: bytes => {
              if (token === readVersion)
                state.readingProgress = i18n.global.t(
                  'agent.attachmentProgress',
                  {
                    current: index + 1,
                    total: files.length,
                    name: file.name,
                    size: bytesToSize(bytes),
                    totalSize: bytesToSize(file.size),
                  }
                )
            },
          })
        )
        if (token !== readVersion) {
          release(incoming)
          return
        }
      }
      const combined = [...state.attachments, ...incoming]
      if (combined.filter(file => file.mimeType).length > AGENT_MAX_IMAGES)
        throw new Error(
          i18n.global.t('每条消息最多添加 16 个文件，其中图片最多 4 张')
        )
      if (
        combined.reduce((sum, file) => sum + file.size, 0) >
        AGENT_MAX_ATTACHMENT_BYTES
      )
        throw new Error(i18n.global.t('附件总大小不能超过 1 GB'))
      state.attachments = combined
    } catch (error) {
      release(incoming)
      if (token === readVersion && !controller.signal.aborted)
        state.attachmentError =
          error instanceof Error ? error.message : String(error)
    } finally {
      if (token === readVersion) {
        state.reading = false
        state.readingProgress = ''
        readController = undefined
      }
    }
  }
  function removeFile(id: string): void {
    release(state.attachments.filter(file => file.id === id))
    state.attachments = state.attachments.filter(file => file.id !== id)
    state.attachmentError = ''
  }
  function addContext(request: AgentContextRequest): boolean {
    if (state.reading) return false
    state.attachmentError = ''
    if (state.attachments.length >= AGENT_MAX_FILES) {
      state.attachmentError = i18n.global.t(
        '每条消息最多添加 16 个文件，其中图片最多 4 张'
      )
      return false
    }
    const content = request.content
    const size = new TextEncoder().encode(content).length
    if (
      !content.trim() ||
      size > (request.source === 'file' ? 256000 : 64000) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)
    ) {
      state.attachmentError = i18n.global.t(
        request.source === 'file'
          ? '配置上下文须为非空文本，最多 256 KB'
          : '选区须为非空文本，最多 64 KB'
      )
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
      name:
        request.name ||
        i18n.global.t(
          request.source === 'terminal' ? '终端选区.txt' : 'SQL 选区.sql'
        ),
      content,
      size,
      source: 'context',
    })
    if (!state.prompt.trim())
      state.prompt = i18n.global.t(
        request.source === 'file'
          ? '请解释附加配置；需要修改时请先展示差异。'
          : request.source === 'schema'
            ? '请分析附加表结构，并给出索引与字段设计建议。'
            : request.intent === 'optimize'
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
    if (new TextEncoder().encode(prompt).length > AGENT_MAX_PROMPT_BYTES) {
      state.attachmentError = i18n.global.t(
        '消息正文最多 256 KB；较长内容请作为文件上传'
      )
      return
    }
    clearAttachments(false)
    state.prompt = ''
    const token = version
    let accepted = false
    try {
      accepted = await send(
        prompt.trim() ? prompt : i18n.global.t('agent.analyzeAttachments'),
        attachments.map(({ name, content, mimeType, attachmentId }) => ({
          name,
          content,
          ...(mimeType ? { mimeType } : {}),
          ...(attachmentId ? { attachmentId } : {}),
        }))
      )
    } catch (error) {
      if (token === version)
        state.attachmentError =
          error instanceof Error ? error.message : String(error)
    }
    if (
      !accepted &&
      token === version &&
      !state.prompt &&
      !state.attachments.length &&
      !state.reading
    ) {
      state.prompt = prompt
      state.attachments = attachments
    } else if (!accepted) {
      release(attachments)
    }
  }
  onScopeDispose(reset)
  return {
    ...toRefs(state),
    reset,
    clearAttachments,
    cancelReading,
    addFiles,
    addContext,
    removeFile,
    submit,
  }
}
