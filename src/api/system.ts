import { invoke } from '@tauri-apps/api/core'
import { IS_TAURI } from '@/utils/window'

export async function getSystemLocale(): Promise<string> {
  if (IS_TAURI) return invoke<string>('get_system_locale')
  return navigator.language || 'en-US'
}
