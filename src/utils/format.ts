/**
 * 数据大小格式化。
 *
 * 后端一律传原始数值（字节或 KB），单位换算留在展示层 ——
 * 同一个数字在概览卡里要显示成 "6.2 GB"，在文件列表里要显示成 "2 KB"，
 * 精度需求不同，不该在后端定死。
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/**
 * 字节数 → 带单位的文本，如 `1.5 GB`。
 *
 * 用 1024 而非 1000 进制：对齐 `df` / `free` 等命令的输出，
 * 否则用户拿界面上的数字和终端里的一对就对不上。
 */
export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return '0 B'

  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1,
  )

  const value = bytes / 1024 ** index

  // 字节数没有小数可言，GB 以上才需要小数位
  const precision = index === 0 ? 0 : digits

  return `${value.toFixed(precision)} ${UNITS[index]}`
}

/** KB → 带单位的文本。后端的内存 / 磁盘指标都是 KB */
export function formatKb(kb: number, digits = 1): string {
  return formatBytes(kb * 1024, digits)
}

/**
 * 字节数拆成「数值 + 单位」两段。
 *
 * 指标卡要把数值排成大字号、单位排成小字号，
 * 拿到一整个字符串再切分容易出错，索性从源头分开返回。
 */
export function splitBytes(bytes: number, digits = 1): { value: string, unit: string } {
  const [value, unit] = formatBytes(bytes, digits).split(' ')
  return { value, unit }
}

/** KB 版本的 splitBytes */
export function splitKb(kb: number, digits = 1): { value: string, unit: string } {
  return splitBytes(kb * 1024, digits)
}

/** 网络速率，如 `12.4 MB/s` */
export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

/**
 * 百分比文本。
 *
 * 分母为 0 时返回 0% 而不是 NaN —— 远端采集失败、或某项指标缺失时
 * 分母就是 0，界面上不该出现 NaN。
 */
export function percent(used: number, total: number, digits = 0): string {
  if (total <= 0)
    return '0%'

  return `${((used / total) * 100).toFixed(digits)}%`
}

/** 开机时长，如 `12 天 3 小时` */
export function formatUptime(seconds: number): string {
  if (seconds <= 0)
    return '—'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0)
    return `${days} 天 ${hours} 小时`

  if (hours > 0)
    return `${hours} 小时 ${minutes} 分钟`

  return `${minutes} 分钟`
}
