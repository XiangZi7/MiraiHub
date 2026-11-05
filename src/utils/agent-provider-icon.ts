import type { AgentConfig } from '@/types/agent'

export const AI_PROVIDER_ICONS = {
  openai: '/images/ai-providers/openai.svg',
  claude: '/images/ai-providers/claude-color.svg',
  deepseek: '/images/ai-providers/deepseek-color.svg',
  doubao: '/images/ai-providers/doubao-color.svg',
  gemini: '/images/ai-providers/gemini-color.svg',
  custom: '/images/ai-providers/custom.svg',
} as const

/** 优先识别具体模型，再依据服务地址和配置名称显示品牌；兼容中转站及未知服务。 */
export function agentProviderIcon(
  profile?: Partial<Pick<AgentConfig, 'model' | 'baseUrl' | 'name'>>
): string {
  let host = ''
  try {
    host = new URL(profile?.baseUrl ?? '').hostname
  } catch {
    /* 自定义空地址使用通用图标。 */
  }
  for (const value of [profile?.model ?? '', host, profile?.name ?? '']) {
    const text = value.toLowerCase()
    if (/deepseek/u.test(text)) return AI_PROVIDER_ICONS.deepseek
    if (/claude|anthropic/u.test(text)) return AI_PROVIDER_ICONS.claude
    if (/gemini|generativelanguage\.googleapis/u.test(text))
      return AI_PROVIDER_ICONS.gemini
    if (/doubao|豆包|火山|volces|volcengine/u.test(text))
      return AI_PROVIDER_ICONS.doubao
    if (/openai|chatgpt|(?:^|[/\s])(?:gpt-|o[1-9](?:-|$))/u.test(text))
      return AI_PROVIDER_ICONS.openai
  }
  return AI_PROVIDER_ICONS.custom
}
