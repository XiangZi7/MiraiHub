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
  maxOutputTokens: number
  contextWindowTokens: number
  maxSteps: number
  maxContextKb: number
  maxMessages: number
  maxRetries: number
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
  turnElapsedMs?: number
  turnStatus?: AgentRun['status']
  role: 'user' | 'assistant' | 'tool' | 'audit' | 'error'
  text: string
  detail?: string
  attachments?: AgentAttachmentInfo[]
  operation?: AgentOperation
}
export interface AgentOperation {
  id: string
  label: string
  command: string
  reason: string
  status: 'running' | 'completed' | 'failed' | 'unknown'
  startedAt: number
  durationMs?: number
  exitCode?: number
  results?: AgentQueryResult[]
  metrics?: AgentMetric[]
  fileChange?: AgentFileChange
}
export interface AgentFileChange {
  path: string
  before: string
  after: string
}
export interface AgentMetric {
  name: string
  value: string
  unit: string
}
export interface AgentQueryResult {
  statement: string
  columns: string[]
  rows: Array<Array<string | null>>
  elapsedMs: number
  truncated: boolean
  error: string | null
}
export interface AgentContextRequest {
  id: string
  target: AgentTarget
  source: 'terminal' | 'sql' | 'schema' | 'file'
  name?: string
  intent: 'explain' | 'optimize'
  content: string
}
export interface AgentAttachment {
  name: string
  content: string
  /** 本地加密附件引用；正文只发送清单，由模型按需读取。 */
  attachmentId?: string
  mimeType?: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}
export interface AgentAttachmentInfo {
  attachmentId?: string
  name: string
  size: number
  mimeType?: AgentAttachment['mimeType']
}
export interface AgentDraftAttachment
  extends AgentAttachment, AgentAttachmentInfo {
  id: string
  source?: 'context'
}
export interface AgentStoredAttachment {
  id: string
  name: string
  size: number
  preview: string
}
export interface AgentApproval {
  id: string
  command: string
  reason: string
  label: string
  expiresAt: number
  fileChange?: AgentFileChange
}
export interface AgentUsage {
  rounds: number
  steps: number
  totalTokens: number | null
  tokensPerSecond: number | null
  cacheHitRate: number | null
  reportedRequests: number
  cacheReportedRequests: number
  lastInputTokens: number | null
  estimatedContextTokens?: number
  contextWindowTokens?: number
  contextBytes: number
  contextLimitBytes: number
}
export interface AgentRun {
  usage?: AgentUsage
  id: string
  conversationId: string
  target: string
  provider: string
  model: string
  status:
    'running' | 'approval' | 'completed' | 'cancelled' | 'failed' | 'truncated'
  entries: AgentEntry[]
  approval: AgentApproval | null
  saveError?: string
}
export interface AgentProgress {
  usage?: AgentUsage
  runId: string
  text: string
  phase: 'thinking' | 'answering' | 'tool' | 'retrying' | 'executing'
  retry?: AgentRetryNotice
  operation?: AgentOperation
}
export interface AgentRetryNotice {
  attempt: number
  max: number
  retryAt: number
  reason: string
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
