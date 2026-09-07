import { computed, onBeforeUnmount, onMounted, reactive, toRefs } from 'vue'
import * as api from '@/api/agent'
import type { AgentSettings } from '@/types/agent'
import { IS_TAURI } from '@/utils/window'

export function useAgentProfiles(onChanged: () => void) {
  const state = reactive({
    settings: { activeId: '', profiles: [] } as AgentSettings,
    loading: true,
    switching: false,
    error: '',
  })
  let disposed = false
  let version = 0
  let unlisten: (() => void) | undefined
  const activeId = computed(() => state.settings.activeId)
  const active = computed(() =>
    state.settings.profiles.find(item => item.id === activeId.value)
  )
  const options = computed(() =>
    state.settings.profiles.map(item => ({
      value: item.id,
      label: `${item.name} · ${item.model || '未设置模型'}${!item.enabled ? '（已停用）' : ''}`,
      disabled: !item.enabled || !item.model,
    }))
  )
  async function refresh(): Promise<void> {
    const token = ++version
    state.loading = true
    try {
      const settings = await api.getConfig()
      if (!disposed && token === version) {
        state.settings = settings
        state.error = ''
      }
    } catch (error) {
      if (!disposed && token === version) state.error = api.errorMessage(error)
    } finally {
      if (!disposed && token === version) state.loading = false
    }
  }
  async function select(id: string): Promise<void> {
    if (id === activeId.value || state.switching) return
    state.switching = true
    state.error = ''
    try {
      const settings = await api.activateConfig(id)
      if (disposed) return
      version++
      onChanged()
      state.settings = settings
      state.loading = false
    } catch (error) {
      if (!disposed) state.error = api.errorMessage(error)
    } finally {
      if (!disposed) state.switching = false
    }
  }
  onMounted(async () => {
    if (!IS_TAURI) {
      state.loading = false
      return
    }
    try {
      const stop = await api.onConfigChanged(() => {
        if (disposed) return
        onChanged()
        void refresh()
      })
      if (disposed) {
        stop()
        return
      }
      unlisten = stop
      await refresh()
    } catch (error) {
      state.error = api.errorMessage(error)
      state.loading = false
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    version++
    unlisten?.()
  })
  return { ...toRefs(state), activeId, active, options, select }
}
