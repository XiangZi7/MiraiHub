import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  AgentSettings,
  AgentProfileInput,
  AgentModelListInput,
  AgentRun,
  AgentTarget,
} from '@/types/agent'
import { IS_TAURI } from '@/utils/window'
function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI)
    return Promise.reject(new Error('请在 MiraiHub 桌面程序中使用 AI Agent'))
  return invoke<T>(command, args)
}
export const getConfig = () => call<AgentSettings>('ai_get_config')
export const listModels = (input: AgentModelListInput) =>
  call<string[]>('ai_list_models', { input })
export const saveConfig = (input: AgentProfileInput, clearKey: boolean) =>
  call<AgentSettings>('ai_save_config', { input, clearKey })
export const activateConfig = (profileId: string) =>
  call<AgentSettings>('ai_activate_config', { profileId })
export const deleteConfig = (profileId: string) =>
  call<AgentSettings>('ai_delete_config', { profileId })
export const testConfig = (profileId: string) =>
  call<string>('ai_test_config', { profileId })
export const onConfigChanged = (handler: () => void) =>
  IS_TAURI ? listen('ai-config-changed', handler) : Promise.resolve(() => {})
export const start = (target: AgentTarget, prompt: string, profileId: string) =>
  call<AgentRun>('ai_start', { target, prompt, profileId })
export const send = (runId: string, prompt: string) =>
  call<AgentRun>('ai_send', { runId, prompt })
export const step = (runId: string) => call<AgentRun>('ai_step', { runId })
export const respond = (runId: string, approvalId: string, approve: boolean) =>
  call<AgentRun>('ai_respond', { runId, approvalId, approve })
export const cancel = (runId: string) => call<void>('ai_cancel', { runId })
export const forget = (runId: string) => call<void>('ai_forget', { runId })
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error)
    return String(error.message)
  return String(error)
}
