export interface AgentTarget {
  kind: 'ssh' | 'database'
  sessionId: string
  database: string
}
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
export type AgentApiFormat = 'openai' | 'anthropic'
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
export interface AgentConversation {
  id: string
  title: string
  model: string
  provider: string
  createdAt: number
  updatedAt: number
}
