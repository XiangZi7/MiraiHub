import type { AgentApiFormat, AgentProfileDraft } from '@/types/agent'
import { DEFAULT_AGENT_LIMITS } from '@/constants/agent-limits'
import { AI_PROVIDER_ICONS } from '@/utils/agent-provider-icon'
import { i18n, translateLabel } from '@/i18n'

export const AGENT_PROVIDER_PRESETS = [
  {
    value: 'openai',
    iconSrc: AI_PROVIDER_ICONS.openai,
    label: 'OpenAI',
    apiFormat: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    value: 'claude',
    iconSrc: AI_PROVIDER_ICONS.claude,
    label: 'Claude',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    value: 'deepseek',
    iconSrc: AI_PROVIDER_ICONS.deepseek,
    label: 'DeepSeek',
    apiFormat: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    value: 'doubao',
    iconSrc: AI_PROVIDER_ICONS.doubao,
    label: '豆包（火山方舟）',
    apiFormat: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    value: 'gemini',
    iconSrc: AI_PROVIDER_ICONS.gemini,
    label: 'Gemini',
    apiFormat: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    value: 'custom',
    iconSrc: AI_PROVIDER_ICONS.custom,
    label: '中转站 / 自定义',
    apiFormat: 'openai',
    baseUrl: '',
  },
] satisfies {
  value: string
  iconSrc: string
  label: string
  apiFormat: AgentApiFormat
  baseUrl: string
}[]
export function newAgentProfile(presetId = 'openai'): AgentProfileDraft {
  const preset =
    AGENT_PROVIDER_PRESETS.find(item => item.value === presetId) ??
    AGENT_PROVIDER_PRESETS[0]
  return {
    name:
      preset.value === 'custom'
        ? i18n.global.t('我的中转站')
        : i18n.global.t('agent.officialProfile', {
            name: translateLabel(preset.label),
          }),
    apiFormat: preset.apiFormat,
    baseUrl: preset.baseUrl,
    model: '',
    pricing: { input: null, output: null, cached: null },
    apiKey: '',
    hasApiKey: false,
    clearKey: false,
    enabled: true,
    limits: { ...DEFAULT_AGENT_LIMITS },
  }
}
