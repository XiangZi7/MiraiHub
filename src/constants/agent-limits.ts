import type { AgentLimits } from '@/types/agent'

export const AGENT_LIMIT_RANGES = {
  maxOutputTokens: { min: 256, max: 131072 },
  contextWindowTokens: { min: 16384, max: 2000000 },
  maxSteps: { min: 1, max: 128 },
  maxContextKb: { min: 64, max: 64000 },
  maxMessages: { min: 16, max: 2048 },
  maxRetries: { min: 0, max: 999 },
} as const

export const AGENT_CAPACITY_PRESETS = [
  {
    value: 'standard',
    label: '标准',
    limits: { maxSteps: 32, maxContextKb: 4000, maxMessages: 256 },
  },
  {
    value: 'extended',
    label: '增强',
    limits: { maxSteps: 64, maxContextKb: 16000, maxMessages: 512 },
  },
  {
    value: 'max',
    label: '深度',
    limits: { maxSteps: 128, maxContextKb: 64000, maxMessages: 2048 },
  },
] as const

export const DEFAULT_AGENT_LIMITS: Readonly<AgentLimits> = {
  ...AGENT_CAPACITY_PRESETS[0].limits,
  maxRetries: 5,
  maxOutputTokens: 8192,
  contextWindowTokens: 128000,
}

/** 本地上下文使用十进制 KB，与后端按 1000 字节计算的容量一致。 */
export function formatAgentContextSize(kb: number): string {
  if (!Number.isFinite(kb) || kb < 0) return '—'
  return kb >= 1000 ? `${kb / 1000} MB` : `${kb} KB`
}

export function validAgentLimits(limits: AgentLimits): boolean {
  return (
    limits.maxOutputTokens +
      Math.min(Math.floor(limits.contextWindowTokens / 20), 8192) <
      limits.contextWindowTokens &&
    (Object.keys(AGENT_LIMIT_RANGES) as (keyof AgentLimits)[]).every(key => {
      const value = limits[key]
      const range = AGENT_LIMIT_RANGES[key]
      return Number.isInteger(value) && value >= range.min && value <= range.max
    })
  )
}

export function agentCapacityPreset(limits: AgentLimits): string {
  return (
    AGENT_CAPACITY_PRESETS.find(preset =>
      (Object.keys(preset.limits) as (keyof typeof preset.limits)[]).every(
        key => preset.limits[key] === limits[key]
      )
    )?.value ?? 'custom'
  )
}
