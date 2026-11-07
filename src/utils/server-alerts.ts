import { i18n } from '@/i18n'
import type { SshSystemStats } from '@/types/ssh'
import { formatRate, formatUptime, percent } from '@/utils/format'

/** 资源占用告警阈值（百分比） */
export const SERVER_ALERT_PERCENT = 90
/** 1 分钟负载超过核数的倍数即视为过载 */
export const SERVER_ALERT_LOAD_RATIO = 1.5

// 计算超过阈值的指标，返回可直接展示的告警描述；无异常时返回空数组。
export function serverAlerts(stats: SshSystemStats | null): string[] {
  if (!stats) return []
  const t = i18n.global.t
  const { cpu, memory, disk } = stats
  const alerts: string[] = []
  const ratio = (used: number, total: number) =>
    total > 0 ? (used / total) * 100 : 0
  if (cpu.usage > SERVER_ALERT_PERCENT)
    alerts.push(t('CPU 使用率 {value0}%', { value0: cpu.usage.toFixed(0) }))
  const memoryRatio = ratio(memory.usedKb, memory.totalKb)
  if (memoryRatio > SERVER_ALERT_PERCENT)
    alerts.push(t('内存使用率 {value0}%', { value0: memoryRatio.toFixed(0) }))
  const diskRatio = ratio(disk.usedKb, disk.totalKb)
  if (diskRatio > SERVER_ALERT_PERCENT)
    alerts.push(t('磁盘使用率 {value0}%', { value0: diskRatio.toFixed(0) }))
  if (cpu.cores > 0 && cpu.load[0] > cpu.cores * SERVER_ALERT_LOAD_RATIO)
    alerts.push(
      t('负载 {value0}（{value1} 核）', {
        value0: cpu.load[0].toFixed(2),
        value1: cpu.cores,
      })
    )
  return alerts
}

// 生成交给 AI 分析的监控快照文本，附带异常项与排查要求。
export function serverSnapshotText(
  stats: SshSystemStats,
  alerts: string[]
): string {
  const { cpu, memory, disk, network } = stats
  return [
    '# Server metrics snapshot',
    `time: ${new Date().toISOString()}`,
    `host: ${stats.hostname} (${stats.os}, kernel ${stats.kernel}, ${stats.arch})`,
    `uptime: ${formatUptime(stats.uptimeSecs)}`,
    `cpu: ${cpu.usage.toFixed(1)}% · ${cpu.cores} cores · load ${cpu.load.map(value => value.toFixed(2)).join(' / ')} · ${cpu.model}`,
    `memory: ${memory.usedKb} / ${memory.totalKb} KB (${percent(memory.usedKb, memory.totalKb)})`,
    `disk: ${disk.usedKb} / ${disk.totalKb} KB (${percent(disk.usedKb, disk.totalKb)})`,
    `network: rx ${formatRate(network.rxBytesPerSec)} · tx ${formatRate(network.txBytesPerSec)}`,
    `online users: ${stats.onlineUsers}`,
    '',
    `alerts: ${alerts.join('; ')}`,
    '',
    'Please analyze the likely causes of the abnormal metrics above and suggest read-only commands to investigate.',
  ].join('\n')
}
