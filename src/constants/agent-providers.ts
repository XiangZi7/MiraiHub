import type { AgentApiFormat, AgentProfileDraft } from '@/types/agent'
import { DEFAULT_AGENT_LIMITS } from './agent-limits'

export const AGENT_PROVIDER_PRESETS = [
  {
    value: 'openai',
    label: 'OpenAI',
    apiFormat: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    value: 'claude',
    label: 'Claude',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    apiFormat: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    value: 'doubao',
    label: '豆包（火山方舟）',
    apiFormat: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    value: 'gemini',
    label: 'Gemini',
    apiFormat: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    value: 'custom',
    label: '中转站 / 自定义',
    apiFormat: 'openai',
    baseUrl: '',
  },
] satisfies {
  value: string
  label: string
  apiFormat: AgentApiFormat
  baseUrl: string
}[]
export function newAgentProfile(presetId = 'openai'): AgentProfileDraft {
  const preset =
    AGENT_PROVIDER_PRESETS.find(item => item.value === presetId) ??
    AGENT_PROVIDER_PRESETS[0]
  return {
    name: preset.value === 'custom' ? '我的中转站' : `${preset.label} 官网`,
    apiFormat: preset.apiFormat,
    baseUrl: preset.baseUrl,
    model: '',
    apiKey: '',
    hasApiKey: false,
    clearKey: false,
    enabled: true,
    limits: { ...DEFAULT_AGENT_LIMITS },
  }
}
