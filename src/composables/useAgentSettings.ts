import { computed, onBeforeUnmount, onMounted, reactive, toRefs } from 'vue'
import * as api from '@/api/agent'
import type {
  AgentConfig,
  AgentProfileDraft,
  AgentSettings,
} from '@/types/agent'
import { newAgentProfile } from '@/constants/agent-providers'
import {
  DEFAULT_AGENT_LIMITS,
  validAgentLimits,
} from '@/constants/agent-limits'
import { IS_TAURI } from '@/utils/window'
import { useI18n } from 'vue-i18n'

function editProfile(profile: AgentConfig): AgentProfileDraft {
  return {
    ...profile,
    limits: { ...(profile.limits ?? DEFAULT_AGENT_LIMITS) },
    apiKey: '',
    clearKey: false,
  }
}
export function useAgentSettings() {
  const { t } = useI18n()
  let disposed = false
  let unlisten: (() => void) | undefined
  let version = 0
  // 草稿只留在当前设置窗口内存，切换编辑项不会丢失未保存输入。
  const state = reactive({
    settings: { activeId: '', profiles: [] } as AgentSettings,
    drafts: {} as Record<string, AgentProfileDraft>,
    selectedId: '',
    preset: 'openai',
    busy: false,
    loading: true,
    error: '',
    message: '',
  })
  const draft = computed(() => state.drafts[state.selectedId])
  const options = computed(() =>
    Object.entries(state.drafts).map(([id, item]) => ({
      value: id,
      label: `${item.name || t('未命名配置')}${state.settings.activeId === id ? ' · ' + t('使用中') : ''}${!item.id ? ' · ' + t('未保存') : ''}`,
    }))
  )
  function add(): void {
    const id = `draft-${crypto.randomUUID()}`
    state.drafts[id] = newAgentProfile(state.preset)
    state.selectedId = id
    state.error = ''
    state.message = ''
  }
  onMounted(async () => {
    try {
      if (IS_TAURI) {
        const stop = await api.onConfigChanged(() => {
          void refreshMetadata()
        })
        if (disposed) {
          stop()
          return
        }
        unlisten = stop
        state.settings = await api.getConfig()
        if (disposed) return
      }
      for (const profile of state.settings.profiles)
        state.drafts[profile.id] = editProfile(profile)
      state.selectedId =
        state.settings.activeId || state.settings.profiles[0]?.id || ''
      if (!state.selectedId) add()
    } catch (error) {
      state.error = api.errorMessage(error)
    } finally {
      state.loading = false
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    version++
    unlisten?.()
    for (const draft of Object.values(state.drafts)) draft.apiKey = ''
  })
  async function refreshMetadata(): Promise<void> {
    const token = ++version
    try {
      const settings = await api.getConfig()
      if (disposed || token !== version) return
      state.settings = settings
      // 更新使用中标记；正在编辑的草稿（包括密钥）仍保留在窗口内。
    } catch (error) {
      if (!disposed) state.error = api.errorMessage(error)
    }
  }
  async function save(test = false): Promise<void> {
    const current = draft.value
    if (!current || state.busy || state.loading) return
    state.busy = true
    state.error = ''
    state.message = ''
    const selected = state.selectedId
    try {
      if (!validAgentLimits(current.limits)) {
        state.error = t('ai.capacityInvalid')
        return
      }
      state.settings = await api.saveConfig(
        {
          id: current.id,
          name: current.name,
          config: {
            enabled: current.enabled,
            apiFormat: current.apiFormat,
            baseUrl: current.baseUrl,
            model: current.model,
            apiKey: current.apiKey,
            limits: { ...current.limits },
          },
        },
        current.clearKey
      )
      current.apiKey = ''
      if (disposed) return
      const saved = state.settings.profiles.find(
        item => item.id === state.settings.activeId
      )!
      delete state.drafts[selected]
      state.drafts[saved.id] = editProfile(saved)
      state.selectedId = saved.id
      state.message = t('ai.saved', { name: saved.name })
      if (test) state.message = await api.testConfig(saved.id)
    } catch (error) {
      state.error = api.errorMessage(error)
    } finally {
      state.busy = false
    }
  }
  async function remove(): Promise<void> {
    const current = draft.value
    if (!current || state.busy) return
    state.busy = true
    state.error = ''
    state.message = ''
    try {
      if (current.id) state.settings = await api.deleteConfig(current.id)
      current.apiKey = ''
      if (disposed) return
      delete state.drafts[state.selectedId]
      state.selectedId = Object.keys(state.drafts)[0] ?? ''
      if (!state.selectedId) add()
      state.message = t('配置已删除。')
    } catch (error) {
      state.error = api.errorMessage(error)
    } finally {
      state.busy = false
    }
  }
  return { ...toRefs(state), draft, options, add, save, remove }
}
