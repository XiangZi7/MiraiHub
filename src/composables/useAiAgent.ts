import {
  computed,
  onBeforeUnmount,
  reactive,
  toRefs,
  watch,
  type Ref,
} from 'vue'
import * as api from '@/api/agent'
import type { AgentRun, AgentTarget } from '@/types/agent'

/** Only backend-returned snapshots drive tool execution/approval UI. */
export function useAiAgent(target: Ref<AgentTarget>, active: Ref<boolean>) {
  // 会话状态只保存在内存，不写入 localStorage。
  const state = reactive({
    run: null as AgentRun | null,
    busy: false,
    error: '',
  })
  let generation = 0
  const targetKey = computed(() => JSON.stringify(target.value))
  const awaitingApproval = computed(() => state.run?.status === 'approval')
  async function clear(): Promise<void> {
    generation++
    const id = state.run?.id
    state.run = null
    state.busy = false
    state.error = ''
    if (id)
      await api.forget(id).catch(error => {
        state.error = api.errorMessage(error)
      })
  }
  async function stop(): Promise<void> {
    generation++
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
        state.error = `停止请求未确认：${api.errorMessage(error)}。请核对远端执行情况。`
      }
    }
  }
  function accept(run: AgentRun, token: number): boolean {
    if (token !== generation) {
      void api.forget(run.id).catch(() => {})
      return false
    }
    state.run = run
    return true
  }
  async function advance(token: number): Promise<void> {
    while (token === generation && state.run?.status === 'running') {
      const next = await api.step(state.run.id)
      if (!accept(next, token)) return
    }
  }
  async function send(prompt: string): Promise<boolean> {
    if (
      !prompt.trim() ||
      !target.value.sessionId ||
      !active.value ||
      state.busy ||
      awaitingApproval.value
    )
      return false
    const token = ++generation
    state.busy = true
    state.error = ''
    try {
      const next =
        state.run?.status === 'completed'
          ? await api.send(state.run.id, prompt.trim())
          : await api.start({ ...target.value }, prompt.trim())
      if (!accept(next, token)) return false
      await advance(token)
      return true
    } catch (error) {
      if (token === generation) state.error = api.errorMessage(error)
      return false
    } finally {
      if (token === generation) state.busy = false
    }
  }
  async function decide(approve: boolean): Promise<void> {
    const run = state.run
    if (!run?.approval || state.busy || !active.value) return
    const token = ++generation
    state.busy = true
    state.error = ''
    try {
      const next = await api.respond(run.id, run.approval.id, approve)
      if (!accept(next, token)) return
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
      if (token === generation) state.busy = false
    }
  }
  watch(
    targetKey,
    () => {
      void clear()
    },
    { flush: 'sync' }
  )
  watch(
    active,
    value => {
      if (!value && (state.busy || awaitingApproval.value)) void stop()
    },
    { flush: 'sync' }
  )
  onBeforeUnmount(() => {
    void clear()
  })
  return { ...toRefs(state), awaitingApproval, send, decide, stop, clear }
}
