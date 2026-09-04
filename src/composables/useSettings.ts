import { reactive, readonly } from 'vue'
import * as store from '@/api/settings'
import type { SettingsValues } from '@/types/settings'

/**
 * 全局设置的单例状态。
 *
 * 所有窗口各持一份，靠 `subscribeSettings` 保持同步：
 * 设置窗口保存后，主窗口这边的 `settings` 会立即刷新，
 * 各消费方通过 watch 或直接读取拿到最新值。
 */
const state = reactive<SettingsValues>(store.loadSettings())

function refresh(): void {
  Object.assign(state, store.loadSettings())
}

store.subscribeSettings(refresh)

/** 只读的响应式设置。模板与 computed 里直接读它。 */
export const settings = readonly(state)

/**
 * 非响应式的当前快照。
 * 供工具函数（时间格式化、剪贴板）在无响应式上下文时读取。
 */
export function settingsSnapshot(): Readonly<SettingsValues> {
  return state
}

function save(values: SettingsValues): void {
  store.saveSettings(values)
  refresh()
}

/** 设置项对应的整数值，非法时退回默认值。 */
export function settingNumber(key: keyof SettingsValues, fallback: number): number {
  const value = Number(state[key])
  return Number.isFinite(value) ? value : fallback
}

export function useSettings() {
  return {
    settings,
    refresh,
    save,
    defaults: store.defaultSettings,
  }
}
