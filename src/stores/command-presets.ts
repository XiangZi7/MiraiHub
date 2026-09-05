import { acceptHMRUpdate, defineStore } from 'pinia'
import { onScopeDispose, shallowRef } from 'vue'
import * as store from '@/api/startup-command-presets'
import type { StartupCommandPreset } from '@/types/command-preset'

export const useCommandPresetsStore = defineStore('command-presets', () => {
  const presets = shallowRef<StartupCommandPreset[]>([])
  const error = shallowRef('')

  async function refresh(): Promise<void> {
    try {
      presets.value = await store.list()
      error.value = ''
    } catch (caught) {
      error.value = String(caught)
    }
  }

  onScopeDispose(store.subscribe(() => void refresh()))
  void refresh()

  return {
    presets,
    error,
    refresh,
    async save(name: string, command: string): Promise<StartupCommandPreset> {
      const preset = await store.save(name, command)
      await refresh()
      return preset
    },
    async remove(id: string): Promise<void> {
      await store.remove(id)
      await refresh()
    },
  }
})

if (import.meta.hot)
  import.meta.hot.accept(
    acceptHMRUpdate(useCommandPresetsStore, import.meta.hot)
  )
