import { computed } from 'vue'
import { SETTINGS_PAGES } from '@/constants/settings'
import { translateLabel } from '@/i18n'

/** Translate metadata inside a computed so open pages react to language changes. */
export function useLocalizedSettings() {
  return computed(() =>
    SETTINGS_PAGES.map(page => ({
      ...page,
      label: translateLabel(page.label),
      title: translateLabel(page.title),
      description: page.description && translateLabel(page.description),
      groups: page.groups.map(group => ({
        ...group,
        title: translateLabel(group.title),
        fields: group.fields.map(field => ({
          ...field,
          label: translateLabel(field.label),
          description: field.description && translateLabel(field.description),
          ...(field.control !== 'display'
            ? {
                placeholder:
                  field.placeholder && translateLabel(field.placeholder),
                options: field.options?.map(option => ({
                  ...option,
                  label: translateLabel(option.label),
                  description:
                    option.description && translateLabel(option.description),
                })),
              }
            : {}),
        })),
      })),
    }))
  )
}
