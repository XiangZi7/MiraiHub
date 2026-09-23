import { i18n } from '@/i18n'
import {
  computed,
  onBeforeUnmount,
  reactive,
  toRefs,
  watch,
  type Ref,
} from 'vue'
import * as api from '@/api/agent'
import type {
  AgentApprovalMode,
  AgentAttachment,
  AgentConversation,
  AgentRun,
  AgentTarget,
  AgentProgress,
} from '@/types/agent'

/** Execution uses live backend snapshots; restored transcripts have no live run or approval. */
export function useAiAgent(
  target: Ref<AgentTarget>,
  active: Ref<boolean>,
  profileId: Ref<string>
) {
  // 响应式状态
  const state = reactive({
    // 当前会话快照；历史快照的运行 ID 为空
    run: null as AgentRun | null,
    // 模型或工具请求是否正在进行
    busy: false,
    // 当前请求错误
    error: '',
    // 当前连接的本地历史记录
    conversations: [] as AgentConversation[],
    // 历史列表加载状态
    historyLoading: false,
    // 历史读取或删除错误
    historyError: '',
    // 会话切换状态
    switchingConversation: false,
    // 会话名称或记录正在保存修改
    historyMutating: false,
    // 当前模型请求的流式预览；最终快照到达后清除
    progress: null as AgentProgress | null,
  })
  let generation = 0
  let historyVersion = 0
  let mutationVersion = 0
  let approvalTimer: ReturnType<typeof setTimeout> | undefined
  const targetKey = computed(() => JSON.stringify(target.value))
  const awaitingApproval = computed(() =>
    Boolean(
      state.run?.id && state.run.approval && state.run.status === 'approval'
    )
  )

  async function expireApproval(
    runId: string,
    approvalId: string
  ): Promise<void> {
    const run = state.run
    if (
      state.busy ||
      run?.id !== runId ||
      run.approval?.id !== approvalId ||
      run.status !== 'approval'
    )
      return
    const token = ++generation
    const command = run.approval.command
    // Unlock immediately, even if the native acknowledgment is delayed. A new
    // message starts a fresh backend run, and generation guards discard late IPC.
    run.approval = null
    run.status = 'cancelled'
    run.entries.push({
      role: 'audit',
      text: '审批已过期，未执行该操作；可以继续发送消息',
      detail: command,
    })
    try {
      const next = await api.respond(runId, approvalId, false)
      if (token === generation) state.run = next
    } catch (error) {
      if (token === generation) state.error = api.errorMessage(error)
      // Revocation remains possible without an active SSH/database connection.
      await api.cancel(runId).catch(() => {})
    } finally {
      if (token === generation) await refreshHistory(token)
    }
  }
  watch(
    () => [
      state.run?.id,
      state.run?.approval?.id,
      state.run?.approval?.expiresAt,
      state.run?.status,
      state.busy,
    ],
    () => {
      clearTimeout(approvalTimer)
      const run = state.run
      if (!run?.id || !run.approval || run.status !== 'approval' || state.busy)
        return
      const { id } = run
      const approvalId = run.approval.id
      approvalTimer = setTimeout(
        () => void expireApproval(id, approvalId),
        Math.max(0, run.approval.expiresAt - Date.now())
      )
    },
    { flush: 'sync' }
  )

  async function refreshHistory(
    token = generation,
    restore = false
  ): Promise<void> {
    const version = ++historyVersion
    if (!target.value.sessionId) return
    state.historyLoading = true
    try {
      const conversations = await api.listConversations({ ...target.value })
      if (token !== generation || version !== historyVersion) return
      state.conversations = conversations
      state.historyError = ''
      if (restore && !state.run && conversations.length) {
        const run = await api.openConversation(
          { ...target.value },
          conversations[0].id
        )
        if (token === generation && version === historyVersion) state.run = run
      }
    } catch (error) {
      if (token === generation && version === historyVersion)
        state.historyError = api.errorMessage(error)
    } finally {
      if (version === historyVersion) state.historyLoading = false
    }
  }
  function detach(): { token: number; id: string | undefined } {
    const token = ++generation
    historyVersion++
    mutationVersion++
    const id = state.run?.id
    state.run = null
    state.progress = null
    state.busy = false
    state.error = ''
    state.historyLoading = false
    state.switchingConversation = false
    state.historyMutating = false
    return { token, id }
  }
  async function release(id: string | undefined, token: number): Promise<void> {
    if (!id) return
    try {
      await api.forget(id)
    } catch (error) {
      if (token === generation) state.error = api.errorMessage(error)
    }
  }
  // New conversation releases runtime context while retaining the encrypted transcript.
  async function clear(): Promise<void> {
    const { token, id } = detach()
    await release(id, token)
    if (token === generation) await refreshHistory(token)
  }
  // A profile change replaces the runtime, but keeps the saved conversation.
  async function changeProfile(): Promise<void> {
    const previous = state.run
    if (!previous?.id || state.switchingConversation) return
    const selectedTarget = { ...target.value }
    const { token, id } = detach()
    state.run = {
      ...previous,
      id: '',
      status:
        previous.status === 'running' || previous.status === 'approval'
          ? 'cancelled'
          : previous.status,
      approval: null,
    }
    state.switchingConversation = true
    try {
      await release(id, token)
      if (token !== generation) return
      const restored = await api.openConversation(
        selectedTarget,
        previous.conversationId
      )
      if (token === generation) {
        state.run = restored
        state.historyError = ''
      }
    } catch (error) {
      if (token === generation) state.historyError = api.errorMessage(error)
    } finally {
      if (token === generation) {
        state.switchingConversation = false
        await refreshHistory(token)
      }
    }
  }
  async function selectConversation(conversationId: string): Promise<void> {
    if (
      state.switchingConversation ||
      state.historyMutating ||
      state.run?.conversationId === conversationId
    )
      return
    if (!conversationId) {
      await clear()
      return
    }
    const { token, id } = detach()
    state.switchingConversation = true
    try {
      await release(id, token)
      if (token !== generation) return
      const run = await api.openConversation(
        { ...target.value },
        conversationId
      )
      if (token === generation) {
        state.run = run
        state.historyError = ''
      }
    } catch (error) {
      if (token === generation) state.historyError = api.errorMessage(error)
    } finally {
      if (token === generation) state.switchingConversation = false
    }
  }
  async function renameConversation(
    conversationId: string,
    title: string
  ): Promise<void> {
    if (state.historyMutating || state.switchingConversation) return
    const version = ++mutationVersion
    state.historyMutating = true
    state.historyError = ''
    try {
      const summary = await api.renameConversation(
        { ...target.value },
        conversationId,
        title
      )
      if (version !== mutationVersion) return
      historyVersion++
      state.historyLoading = false
      state.conversations = state.conversations.map(item =>
        item.id === conversationId ? summary : item
      )
    } catch (error) {
      if (version === mutationVersion)
        state.historyError = api.errorMessage(error)
    } finally {
      if (version === mutationVersion) state.historyMutating = false
    }
  }
  async function removeConversation(
    conversationId = state.run?.conversationId
  ): Promise<void> {
    if (!conversationId || state.switchingConversation || state.historyMutating)
      return
    const version = ++mutationVersion
    const selectedTarget = { ...target.value }
    state.historyMutating = true
    state.historyError = ''
    try {
      if (
        state.run?.conversationId === conversationId &&
        (state.busy || awaitingApproval.value)
      )
        await stop()
      if (version !== mutationVersion) return
      await api.deleteConversation(selectedTarget, conversationId)
      if (version !== mutationVersion) return
      if (state.run?.conversationId === conversationId) {
        const token = ++generation
        const id = state.run.id
        state.run = null
        state.busy = false
        state.error = ''
        await release(id, token)
      }
      if (version !== mutationVersion) return
      state.conversations = state.conversations.filter(
        item => item.id !== conversationId
      )
      await refreshHistory()
    } catch (error) {
      if (version === mutationVersion)
        state.historyError = api.errorMessage(error)
    } finally {
      if (version === mutationVersion) state.historyMutating = false
    }
  }
  async function stop(): Promise<void> {
    const token = ++generation
    const id = state.run?.id
    state.busy = false
    if (state.run) {
      if (state.progress?.text)
        state.run.entries.push({ role: 'assistant', text: state.progress.text })
      state.run.status = 'cancelled'
      state.run.approval = null
    }
    state.progress = null
    if (id) {
      try {
        await api.cancel(id)
      } catch (error) {
        if (token === generation)
          state.error = i18n.global.t(
            '停止请求未确认：{value0}。请核对远端执行情况。',
            { value0: api.errorMessage(error) }
          )
      }
    }
    if (token === generation) await refreshHistory(token)
  }
  function accept(run: AgentRun, token: number): boolean {
    if (token !== generation) {
      if (run.id) void api.forget(run.id).catch(() => {})
      return false
    }
    state.run = run
    return true
  }
  async function advance(token: number): Promise<void> {
    while (token === generation && state.run?.status === 'running') {
      const id = state.run.id
      // Each callback belongs to one step and one UI generation. IPC deliveries
      // may arrive after the invoke result, cancellation or a conversation switch.
      let receiving = true
      state.progress = null
      try {
        const next = await api.step(id, progress => {
          if (
            receiving &&
            token === generation &&
            state.run?.id === id &&
            state.run.status === 'running' &&
            progress.runId === id
          )
            state.progress = progress
        })
        if (!accept(next, token)) return
      } finally {
        receiving = false
        if (token === generation) state.progress = null
      }
    }
  }
  async function send(
    prompt: string,
    attachments: AgentAttachment[] = [],
    approvalMode: AgentApprovalMode = 'auto'
  ): Promise<boolean> {
    if (
      (!prompt.trim() && !attachments.length) ||
      !target.value.sessionId ||
      !active.value ||
      !profileId.value ||
      state.busy ||
      state.historyLoading ||
      state.historyMutating ||
      state.switchingConversation ||
      awaitingApproval.value
    )
      return false
    const token = ++generation
    state.busy = true
    state.error = ''
    let sent = false
    try {
      const previous = state.run
      let next: AgentRun
      if (previous?.id && previous.status === 'completed')
        next = await api.send(
          previous.id,
          prompt.trim(),
          attachments,
          approvalMode
        )
      else {
        if (previous?.id) await api.forget(previous.id)
        if (token !== generation) return false
        next = await api.start(
          { ...target.value },
          prompt.trim(),
          profileId.value,
          previous?.conversationId,
          attachments,
          approvalMode
        )
      }
      if (!accept(next, token)) return false
      sent = true
      await advance(token)
      return true
    } catch (error) {
      if (token === generation) state.error = api.errorMessage(error)
      return sent
    } finally {
      if (token === generation) {
        state.busy = false
        await refreshHistory(token)
      }
    }
  }
  async function decide(approve: boolean): Promise<void> {
    const run = state.run
    if (!run?.id || !run.approval || state.busy || !active.value) return
    const token = ++generation
    state.busy = true
    state.error = ''
    try {
      if (!accept(await api.respond(run.id, run.approval.id, approve), token))
        return
      if (approve) await advance(token)
    } catch (error) {
      if (token === generation) {
        state.error = i18n.global.t(
          '审批结果未确认：{value0}。请核对远端状态，不要重复执行。',
          { value0: api.errorMessage(error) }
        )
        if (state.run) {
          state.run.approval = null
          state.run.status = 'failed'
        }
      }
    } finally {
      if (token === generation) {
        state.busy = false
        await refreshHistory(token)
      }
    }
  }
  watch(
    targetKey,
    async () => {
      const { token, id } = detach()
      state.conversations = []
      state.historyError = ''
      // Block sending until the saved conversation for this target has been restored.
      state.historyLoading = Boolean(target.value.sessionId)
      await release(id, token)
      if (token === generation) await refreshHistory(token, true)
    },
    { flush: 'sync', immediate: true }
  )
  watch(
    active,
    value => {
      if (!value && (state.busy || awaitingApproval.value)) void stop()
    },
    { flush: 'sync' }
  )
  onBeforeUnmount(() => {
    clearTimeout(approvalTimer)
    const { id } = detach()
    if (id) void api.forget(id).catch(() => {})
  })
  return {
    ...toRefs(state),
    awaitingApproval,
    send,
    decide,
    stop,
    clear,
    changeProfile,
    selectConversation,
    removeConversation,
    renameConversation,
    refreshHistory,
  }
}
