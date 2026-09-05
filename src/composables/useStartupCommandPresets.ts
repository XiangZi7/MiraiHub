import { storeToRefs } from 'pinia'
import { useCommandPresetsStore } from '@/stores/command-presets'
export function useStartupCommandPresets() {
  const store = useCommandPresetsStore()
  const { presets } = storeToRefs(store)
  return { presets, refresh: store.refresh, save: store.save, remove: store.remove }
}
