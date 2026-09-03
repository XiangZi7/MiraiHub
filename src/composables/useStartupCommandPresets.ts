import { readonly, shallowRef } from 'vue'
import * as store from '@/api/startup-command-presets'
import type { StartupCommandPreset } from '@/types/command-preset'

const presets = shallowRef<StartupCommandPreset[]>([])

async function refresh(): Promise<void> {
  presets.value = await store.list()
}

store.subscribe(() => void refresh())
void refresh()

export function useStartupCommandPresets() {
  return {
    presets: readonly(presets),
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
}

