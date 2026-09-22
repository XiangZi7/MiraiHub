import { i18n } from '@/i18n'
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  AgentSettings,
  AgentProfileInput,
  AgentModelListInput,
  AgentRun,
  AgentTarget,
  AgentConversation,
  AgentAttachment,
  AgentApprovalMode,
  AgentProgress,
  McpServer,
  McpServerInput,
  McpProbe,
} from '@/types/agent'
import { IS_TAURI } from '@/utils/window'
function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI)
    return Promise.reject(
      new Error(i18n.global.t('请在 MiraiHub 桌面程序中使用 AI Agent'))
    )
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
export const listMcpServers = () => call<McpServer[]>('ai_list_mcp_servers')
export const saveMcpServer = (input: McpServerInput) =>
  call<McpServer[]>('ai_save_mcp_server', { input })
export const deleteMcpServer = (id: string) =>
  call<McpServer[]>('ai_delete_mcp_server', { id })
export const testMcpServer = (id: string) =>
  call<McpProbe>('ai_test_mcp_server', { id })
export const onConfigChanged = (handler: () => void) =>
  IS_TAURI ? listen('ai-config-changed', handler) : Promise.resolve(() => {})
export const start = (
  target: AgentTarget,
  prompt: string,
  profileId: string,
  conversationId?: string,
  attachments: AgentAttachment[] = [],
  approvalMode: AgentApprovalMode = 'auto'
) =>
  call<AgentRun>('ai_start', {
    target,
    prompt,
    profileId,
    conversationId,
    attachments,
    approvalMode,
  })
export const listConversations = (target: AgentTarget) =>
  call<AgentConversation[]>('ai_list_conversations', { target })
export const openConversation = (target: AgentTarget, conversationId: string) =>
  call<AgentRun>('ai_open_conversation', { target, conversationId })
export const renameConversation = (
  target: AgentTarget,
  conversationId: string,
  title: string
) =>
  call<AgentConversation>('ai_rename_conversation', {
    target,
    conversationId,
    title,
  })
export const deleteConversation = (
  target: AgentTarget,
  conversationId: string
) => call<void>('ai_delete_conversation', { target, conversationId })
export const send = (
  runId: string,
  prompt: string,
  attachments: AgentAttachment[] = [],
  approvalMode: AgentApprovalMode = 'auto'
) => call<AgentRun>('ai_send', { runId, prompt, attachments, approvalMode })
export async function step(
  runId: string,
  onProgress: (progress: AgentProgress) => void = () => {}
): Promise<AgentRun> {
  if (!IS_TAURI) return call<AgentRun>('ai_step', { runId })
  const channel = new Channel<AgentProgress>()
  channel.onmessage = onProgress
  try {
    return await call<AgentRun>('ai_step', { runId, onProgress: channel })
  } finally {
    channel.onmessage = () => {}
  }
}
export const respond = (runId: string, approvalId: string, approve: boolean) =>
  call<AgentRun>('ai_respond', { runId, approvalId, approve })
export const cancel = (runId: string) => call<void>('ai_cancel', { runId })
export const forget = (runId: string) => call<void>('ai_forget', { runId })
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error)
    return String(error.message)
  return String(error)
}
