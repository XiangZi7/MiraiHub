import { onScopeDispose, reactive, toRefs, watch } from 'vue'
import * as api from '@/api/agent'
import type { AgentModelListInput } from '@/types/agent'
import { i18n } from '@/i18n'

/** Discover models from the draft without saving settings or changing a run. */
export function useAgentModels(input: () => AgentModelListInput) {
  const state = reactive({
    models: [] as string[],
    fetching: false,
    error: '',
    message: '',
  })
  let version = 0
  function reset(): void {
    version++
    state.models = []
    state.fetching = false
    state.error = ''
    state.message = ''
  }
  watch(
    () => {
      const draft = input()
      return [
        draft.profileId,
        draft.apiFormat,
        draft.baseUrl,
        draft.apiKey,
        draft.clearKey,
      ]
    },
    reset,
    { flush: 'sync' }
  )
  onScopeDispose(reset)

  async function fetchModels(): Promise<boolean> {
    if (state.fetching) return false
    const request = ++version
    const draft = { ...input() }
    state.fetching = true
    state.error = ''
    state.message = ''
    state.models = []
    try {
      const models = await api.listModels(draft)
      if (request !== version) return false
      state.models = models
      state.message = models.length
        ? i18n.global.t('ai.modelsFound', { count: models.length })
        : i18n.global.t('服务未返回可用模型，可手动输入模型 ID。')
      return models.length > 0
    } catch (error) {
      if (request === version) state.error = api.errorMessage(error)
      return false
    } finally {
      if (request === version) state.fetching = false
    }
  }
  return { ...toRefs(state), fetchModels }
}
