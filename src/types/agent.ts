export interface AgentTarget {
  kind: 'ssh' | 'database' | 'redis'
  sessionId: string
  database: string
}
export type AgentApprovalMode = 'ask' | 'auto' | 'full'
export interface AgentConfig {
  id: string
  name: string
  apiFormat: AgentApiFormat
  enabled: boolean
  baseUrl: string
  model: string
  hasApiKey: boolean
  limits: AgentLimits
}
export interface AgentLimits {
  maxSteps: number
  maxContextKb: number
  maxMessages: number
}
export interface AgentConfigInput {
  apiFormat: AgentApiFormat
  enabled: boolean
  baseUrl: string
  model: string
  apiKey: string
  limits: AgentLimits
}
export interface AgentModelListInput {
  profileId?: string
  apiFormat: AgentApiFormat
  baseUrl: string
  apiKey: string
  clearKey: boolean
}
export type AgentApiFormat = 'openai' | 'responses' | 'anthropic'
export interface AgentSettings {
  activeId: string
  profiles: AgentConfig[]
}
export interface AgentProfileInput {
  id?: string
  name: string
  config: AgentConfigInput
}
export interface AgentProfileDraft extends AgentConfigInput {
  id?: string
  name: string
  hasApiKey: boolean
  clearKey: boolean
}
export interface AgentEntry {
  role: 'user' | 'assistant' | 'tool' | 'audit' | 'error'
  text: string
  detail?: string
  attachments?: AgentAttachmentInfo[]
}
export interface AgentAttachment {
  name: string
  content: string
}
export interface AgentAttachmentInfo {
  name: string
  size: number
}
export interface AgentDraftAttachment
  extends AgentAttachment, AgentAttachmentInfo {
  id: string
}
export interface AgentApproval {
  id: string
  command: string
  reason: string
  label: string
  expiresAt: number
}
export interface AgentRun {
  id: string
  conversationId: string
  target: string
  provider: string
  model: string
  status: 'running' | 'approval' | 'completed' | 'cancelled' | 'failed'
  entries: AgentEntry[]
  approval: AgentApproval | null
  saveError?: string
}
export interface AgentProgress {
  runId: string
  text: string
  phase: 'thinking' | 'answering' | 'tool'
}
export type McpTransport = 'stdio' | 'http'
export type McpTarget = 'ssh' | 'database' | 'redis'
/** A secret the page can see exists but never reads back. */
export interface McpSecret {
  key: string
  hasValue: boolean
}
export interface McpServer {
  id: string
  name: string
  enabled: boolean
  transport: McpTransport
  command: string
  args: string[]
  env: McpSecret[]
  url: string
  headers: McpSecret[]
  targets: McpTarget[]
  tools: string[]
}
/** What the page sends. An empty value keeps the stored secret unless `clear` is set. */
export interface McpSecretInput {
  key: string
  value: string
  clear: boolean
}
export interface McpServerInput {
  id?: string
  name: string
  enabled: boolean
  transport: McpTransport
  command: string
  args: string[]
  env: McpSecretInput[]
  url: string
  headers: McpSecretInput[]
  targets: McpTarget[]
}
export interface McpSecretDraft extends McpSecretInput {
  hasValue: boolean
}
export interface McpServerDraft {
  id?: string
  name: string
  enabled: boolean
  transport: McpTransport
  command: string
  argsText: string
  env: McpSecretDraft[]
  url: string
  headers: McpSecretDraft[]
  targets: McpTarget[]
  tools: string[]
}
export interface McpProbe {
  serverInfo?: { name?: string; version?: string }
  protocolVersion?: string
  tools: string[]
}
export interface AgentConversation {
  id: string
  title: string
  model: string
  provider: string
  createdAt: number
  updatedAt: number
}
