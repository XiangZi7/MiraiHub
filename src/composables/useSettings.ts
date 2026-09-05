import { readonly } from 'vue'
import { pinia } from '@/stores'
import { useSettingsStore } from '@/stores/settings'
import type { SettingsValues } from '@/types/settings'

/** 只读适配层，不持有状态。 */
export function useSettings() {
  const store = useSettingsStore()
  return { settings: readonly(store.values), save: store.save, refresh: store.refresh, defaults: store.defaults }
}

/** 工具函数在调用时取 store，避免模块加载顺序依赖。 */
export function settingsSnapshot(): Readonly<SettingsValues> {
  return useSettingsStore(pinia).values
}
export function settingNumber(key: keyof SettingsValues, fallback: number): number {
  const value = Number(settingsSnapshot()[key])
  return Number.isFinite(value) ? value : fallback
}
