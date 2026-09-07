export type AppLocale = 'zh-CN' | 'en-US'
export type LanguagePreference = 'system' | AppLocale

export function normalizeLanguage(value: string): LanguagePreference {
  return value === 'zh-CN' || value === 'en-US' ? value : 'system'
}

/** Chinese variants share the Chinese catalog; other languages fall back to English. */
export function resolveLocale(
  preference: string,
  systemLocale: string
): AppLocale {
  const language = normalizeLanguage(preference)
  if (language !== 'system') return language
  return /^zh(?:[-_]|$)/i.test(systemLocale.trim()) ? 'zh-CN' : 'en-US'
}
