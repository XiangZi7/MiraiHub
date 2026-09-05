import { emit, listen } from '@tauri-apps/api/event'
import { DEFAULT_SETTINGS, type SettingKey, type SettingsValues } from '@/types/settings'
import { normalizeUiScale } from '@/utils/ui-scale'
import { IS_TAURI } from '@/utils/window'

const STORAGE_KEY = 'miraihub.settings.v1'
const CHANGE_EVENT = 'miraihub:settings-changed'
/** 跨 WebView 窗口的广播：设置窗口保存后通知主窗口立即应用。 */
const TAURI_EVENT = 'miraihub://settings-changed'

export function defaultSettings(): SettingsValues {
  return { ...DEFAULT_SETTINGS }
}

/**
 * 读取设置时逐项校验类型，旧版本或手动损坏的值不会污染整份配置。
 * 已经移除的设置项会被自然忽略。
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

  defaults.uiScale = String(normalizeUiScale(defaults.uiScale))
  return defaults
}

export function saveSettings(settings: SettingsValues): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))

  if (IS_TAURI) {
    void emit(TAURI_EVENT).catch((error: unknown) => {
      console.warn('广播设置变更失败：', error)
    })
  }
}

/**
 * 订阅设置变更。
 *
 * 监听四个来源：本窗口的自定义事件、其他窗口的 storage 事件、
 * Tauri 事件总线（WebView 之间的 storage 事件并不可靠），以及窗口重新获得焦点时兜底刷新。
 */
export function subscribeSettings(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY || event.key === null)
      listener()
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('focus', listener)

  let unlistenTauri: (() => void) | undefined
  let cancelled = false
  if (IS_TAURI) {
    void listen(TAURI_EVENT, listener)
      .then((unlisten) => {
        if (cancelled)
          unlisten()
        else
          unlistenTauri = unlisten
      })
      .catch((error: unknown) => {
        console.warn('订阅设置变更事件失败：', error)
      })
  }

  return () => {
    cancelled = true
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('focus', listener)
    unlistenTauri?.()
  }
}
