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
  })
  let generation = 0
  let historyVersion = 0
  let mutationVersion = 0
  const targetKey = computed(() => JSON.stringify(target.value))
  const awaitingApproval = computed(() =>
    Boolean(state.run?.id && state.run.status === 'approval')
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
      state.run.status = 'cancelled'
      state.run.approval = null
    }
    if (id) {
      try {
        await api.cancel(id)
      } catch (error) {
        if (token === generation)
          state.error = `停止请求未确认：${api.errorMessage(error)}。请核对远端执行情况。`
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
      if (!accept(await api.step(state.run.id), token)) return
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
        state.error = `审批结果未确认：${api.errorMessage(error)}。请核对远端状态，不要重复执行。`
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
    selectConversation,
    removeConversation,
    renameConversation,
    refreshHistory,
  }
}
