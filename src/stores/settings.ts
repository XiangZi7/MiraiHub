import { onScopeDispose, reactive } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api/settings'
import type { SettingsValues } from '@/types/settings'

export const useSettingsStore = defineStore('settings', () => {
  const values = reactive<SettingsValues>(api.loadSettings())
  function refresh(): void {
    Object.assign(values, api.loadSettings())
  }
  function save(settings: SettingsValues): void {
    api.saveSettings(settings)
    refresh()
  }
  onScopeDispose(api.subscribeSettings(refresh))
  return { values, refresh, save, defaults: api.defaultSettings }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot))
