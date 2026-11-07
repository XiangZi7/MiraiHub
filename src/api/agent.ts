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
  AgentStoredAttachment,
  AgentApprovalMode,
  AgentProgress,
  McpServer,
  McpServerInput,
  McpProbe,
  ShellCommandSuggestion,
  SqlAssistInput,
  SqlAssistResult,
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
export const beginAttachment = (name: string) =>
  call<string>('ai_attachment_begin', { name })
export const appendAttachment = (id: string, index: number, content: string) =>
  call<void>('ai_attachment_append', { id, index, content })
export const finishAttachment = (id: string) =>
  call<AgentStoredAttachment>('ai_attachment_finish', { id })
export const discardAttachment = (id: string) =>
  call<void>('ai_attachment_discard', { id })
export const readFileContext = (target: AgentTarget, path: string) =>
  call<{ path: string; text: string }>('ai_read_file_context', { target, path })
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
/** 一次性解读执行计划：后端附带相关表索引，不进入对话历史，也不调用工具。 */
export const explainPlan = (
  target: AgentTarget,
  sql: string,
  plan: string,
  language: string
) => call<string>('ai_explain_plan', { target, sql, plan, language })
/** 只发送表结构，返回测试数据生成规则的 JSON 文本。 */
export const testDataRules = (
  target: AgentTarget,
  schema: string,
  language: string
) => call<string>('ai_test_data_rules', { target, schema, language })
/** 为数据字典补全描述；tables 是否含样本值由调用方按用户授权决定。 */
export const describeTables = (
  target: AgentTarget,
  tables: string,
  language: string
) => call<string>('ai_describe_tables', { target, tables, language })
/** 终端内联 AI：把自然语言转换为一条 shell 命令，只返回建议不执行。 */
export const shellCommand = (
  sessionId: string,
  request: string,
  context: string,
  language: string
) =>
  call<ShellCommandSuggestion>('ai_shell_command', {
    sessionId,
    request,
    context,
    language,
  })
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
// 运行中引导由前端在完整步骤之间提交，保留当前会话和本轮执行预算。
export const send = (
  runId: string,
  prompt: string,
  attachments: AgentAttachment[] = [],
  approvalMode: AgentApprovalMode = 'auto',
  guidance = false
) =>
  call<AgentRun>('ai_send', {
    runId,
    prompt,
    attachments,
    approvalMode,
    guidance,
  })
export const setApprovalMode = (
  runId: string,
  approvalMode: AgentApprovalMode
) => call<void>('ai_set_approval_mode', { runId, approvalMode })
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
/** 提交一次审批；记住授权仅适用于本会话相同参数的操作。 */
export async function respond(
  runId: string,
  approvalId: string,
  approve: boolean,
  onProgress: (progress: AgentProgress) => void = () => {},
  remember = false
): Promise<AgentRun> {
  if (!IS_TAURI)
    return call<AgentRun>('ai_respond', {
      runId,
      approvalId,
      approve,
      remember,
    })
  const channel = new Channel<AgentProgress>()
  channel.onmessage = onProgress
  try {
    return await call<AgentRun>('ai_respond', {
      runId,
      approvalId,
      approve,
      remember,
      onProgress: channel,
    })
  } finally {
    ;((channel.onmessage = () => {}), (remember = false))
  }
}
/** 重建单个失败步骤并获取新的审批，不自动执行写操作。 */
export const retryOperation = (runId: string, operationId: string) =>
  call<AgentRun>('ai_retry_operation', { runId, operationId })
export const cancel = (runId: string) => call<void>('ai_cancel', { runId })
export const forget = (runId: string) => call<void>('ai_forget', { runId })
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error)
    return String(error.message)
  return String(error)
}

/** SQL 编辑器的一次性 AI 调用：onText 收到累计文本，可用 requestId 中止。 */
export async function sqlAssist(
  target: AgentTarget,
  requestId: string,
  input: SqlAssistInput,
  onText: (text: string) => void
): Promise<SqlAssistResult> {
  const channel = new Channel<string>()
  channel.onmessage = onText
  try {
    return await call<SqlAssistResult>('ai_sql_assist', {
      target,
      requestId,
      input,
      onProgress: channel,
    })
  } finally {
    channel.onmessage = () => {}
  }
}

/** 中止进行中的 SQL AI 请求；请求已结束时无副作用。 */
export const cancelSqlAssist = (requestId: string) =>
  call<void>('ai_sql_assist_cancel', { requestId })
