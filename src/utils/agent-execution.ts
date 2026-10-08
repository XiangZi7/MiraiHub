import type { AgentEntry, AgentOperation, AgentRun } from '@/types/agent'

/** Only the latest user turn belongs in a task result; old failures stay in history. */
export function summarizeAgentTurn(
  entries: AgentEntry[],
  status: AgentRun['status']
) {
  const start = entries.reduce(
    (last, entry, index) => (entry.role === 'user' ? index : last),
    -1
  )
  const current = entries.slice(start + 1)
  const operations = current.flatMap(entry =>
    entry.operation ? [entry.operation] : []
  )
  const completed = operations.filter(
    operation => operation.status === 'completed'
  ).length
  const failed = operations.filter(
    operation => operation.status === 'failed'
  ).length
  const unknown = operations.filter(
    operation => operation.status === 'unknown'
  ).length
  const errors = current.filter(
    entry => entry.role === 'error' && !entry.operation
  ).length
  const durationMs = operations.reduce(
    (sum, operation) => sum + (operation.durationMs ?? 0),
    0
  )
  const comparisons: { command: string; before: number; after: number }[] = []
  const metricComparisons: {
    command: string
    name: string
    before: string
    after: string
    unit: string
  }[] = []
  const firstMetrics = new Map<
    string,
    { value: string; command: string; name: string; unit: string }
  >()
  const lastMetrics = new Map<string, string>()
  for (const operation of operations) {
    for (const metric of operation.metrics ?? []) {
      const key = JSON.stringify([operation.command, metric.name, metric.unit])
      if (!firstMetrics.has(key))
        firstMetrics.set(key, { ...metric, command: operation.command })
      lastMetrics.set(key, metric.value)
    }
  }
  for (const [key, before] of firstMetrics) {
    const after = lastMetrics.get(key)!
    if (before.value !== after)
      metricComparisons.push({
        command: before.command,
        name: before.name,
        before: before.value,
        after,
        unit: before.unit,
      })
  }
  const first = new Map<string, AgentOperation>()
  const last = new Map<string, AgentOperation>()
  for (const operation of operations) {
    if (operation.exitCode === undefined) continue
    if (!first.has(operation.command)) first.set(operation.command, operation)
    last.set(operation.command, operation)
  }
  for (const [command, before] of first) {
    const after = last.get(command)!
    if (before !== after && before.exitCode !== after.exitCode)
      comparisons.push({
        command,
        before: before.exitCode!,
        after: after.exitCode!,
      })
  }
  return {
    operations,
    completed,
    failed,
    unknown,
    durationMs,
    comparisons,
    metricComparisons,
    needsAttention:
      failed > 0 || unknown > 0 || errors > 0 || status === 'failed',
    finished:
      status === 'completed' || status === 'cancelled' || status === 'failed',
  }
}

export function formatAgentDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(1)} s`
}
