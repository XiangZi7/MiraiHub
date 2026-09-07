import { watch } from 'vue'
import { i18n } from './index'
import { getSystemLocale } from '@/api/system'
import { useSettingsStore } from '@/stores/settings'
import { pinia } from '@/stores'
import { resolveLocale } from '@/utils/locale'

/** Each WebView resolves the native language before mounting its first page. */
export async function startLanguageRuntime(): Promise<void> {
  const settings = useSettingsStore(pinia).values
  let systemLocale = navigator.language || 'en-US'
  let refreshing = false
  let stopped = false

  function apply(): void {
    const locale = resolveLocale(settings.language, systemLocale)
    i18n.global.locale.value = locale
    document.documentElement.lang = locale
  }
  async function refreshSystemLocale(): Promise<void> {
    if (refreshing) return
    refreshing = true
    try {
      systemLocale = await getSystemLocale()
    } catch (error) {
      console.warn('Unable to read system language:', error)
    } finally {
      refreshing = false
      if (!stopped) apply()
    }
  }
  await refreshSystemLocale()
  const stopWatch = watch(
    () => settings.language,
    () => {
      apply()
      if (settings.language === 'system') void refreshSystemLocale()
    },
    { flush: 'sync' }
  )
  const refresh = () => {
    if (settings.language === 'system') void refreshSystemLocale()
  }
  window.addEventListener('focus', refresh)
  window.addEventListener('languagechange', refresh)
  import.meta.hot?.dispose(() => {
    stopped = true
    stopWatch()
    window.removeEventListener('focus', refresh)
    window.removeEventListener('languagechange', refresh)
  })
}
