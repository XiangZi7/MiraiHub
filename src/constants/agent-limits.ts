import type { AgentLimits } from '@/types/agent'

export const AGENT_LIMIT_RANGES = {
  maxSteps: { min: 1, max: 128 },
  maxContextKb: { min: 64, max: 4000 },
  maxMessages: { min: 16, max: 2048 },
} as const

export const AGENT_CAPACITY_PRESETS = [
  {
    value: 'standard',
    label: '标准',
    limits: { maxSteps: 8, maxContextKb: 180, maxMessages: 64 },
  },
  {
    value: 'enhanced',
    label: '增强',
    limits: { maxSteps: 32, maxContextKb: 1000, maxMessages: 256 },
  },
  {
    value: 'deep',
    label: '深度',
    limits: { maxSteps: 64, maxContextKb: 4000, maxMessages: 1024 },
  },
] as const

export const DEFAULT_AGENT_LIMITS: Readonly<AgentLimits> =
  AGENT_CAPACITY_PRESETS[0].limits

export function validAgentLimits(limits: AgentLimits): boolean {
  return (Object.keys(AGENT_LIMIT_RANGES) as (keyof AgentLimits)[]).every(
    key => {
      const value = limits[key]
      const range = AGENT_LIMIT_RANGES[key]
      return Number.isInteger(value) && value >= range.min && value <= range.max
    }
  )
}

export function agentCapacityPreset(limits: AgentLimits): string {
  return (
    AGENT_CAPACITY_PRESETS.find(preset =>
      (Object.keys(AGENT_LIMIT_RANGES) as (keyof AgentLimits)[]).every(
        key => preset.limits[key] === limits[key]
      )
    )?.value ?? 'custom'
  )
}
