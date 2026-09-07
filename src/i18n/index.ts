import { createI18n } from 'vue-i18n'
import { messages } from './messages'

export const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  fallbackLocale: 'en-US',
  messages,
  missingWarn: false,
  fallbackWarn: false,
})

/** Metadata may also contain product names, paths or numeric option labels. */
export function translateLabel(label: string): string {
  return i18n.global.te(label) ? i18n.global.t(label) : label
}
