import { DEFAULT_SETTINGS, type SettingKey, type SettingsValues } from '@/types/settings'

const STORAGE_KEY = 'miraihub.settings.v1'
const CHANGE_EVENT = 'miraihub:settings-changed'

export function defaultSettings(): SettingsValues {
  return { ...DEFAULT_SETTINGS }
}

/**
 * 读取设置时逐项校验类型，旧版本或手动损坏的值不会污染整份配置。
 */
export function loadSettings(): SettingsValues {
  const defaults = defaultSettings()

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw)
      return defaults

    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const key of Object.keys(defaults) as SettingKey[]) {
      if (typeof parsed[key] === typeof defaults[key])
        Object.assign(defaults, { [key]: parsed[key] })
    }
  }
  catch (error) {
    console.warn('读取设置失败，已恢复默认值：', error)
  }

  return defaults
}

export function saveSettings(settings: SettingsValues): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export function subscribeSettings(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY)
      listener()
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(CHANGE_EVENT, listener)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(CHANGE_EVENT, listener)
  }
}
