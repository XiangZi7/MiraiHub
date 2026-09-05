/**
 * 时间格式化。
 *
 * 后端统一传 Unix 毫秒时间戳，展示层在这里转成人类可读的形式 ——
 * 避免每个组件各写一份，也让"多久算刚刚"这类阈值只有一处定义。
 * 日期与时间的具体格式跟随设置里的「日期和时间」。
 */

import { settingsSnapshot } from '@/composables/useSettings'

/** 相对时间的分档，单位毫秒。从小到大匹配，命中即返回 */
const UNITS: { limit: number; divisor: number; suffix: string }[] = [
  { limit: 60_000, divisor: 1000, suffix: '秒前' },
  { limit: 3_600_000, divisor: 60_000, suffix: '分钟前' },
  { limit: 86_400_000, divisor: 3_600_000, suffix: '小时前' },
  { limit: 2_592_000_000, divisor: 86_400_000, suffix: '天前' },
  { limit: 31_536_000_000, divisor: 2_592_000_000, suffix: '个月前' },
]

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * 相对时间，如「3 分钟前」。
 *
 * 超过一年就不再说"多少年前"——那个精度下用户想知道的是具体日期，
 * 直接给绝对时间更有用。
 */
export function formatRelative(timestamp: number): string {
  if (!timestamp) return '—'

  const diff = Date.now() - timestamp

  // 时钟回拨或后端时间超前时 diff 为负，按"刚刚"处理，
  // 否则会算出"-3 分钟前"这种明显错误的文案
  if (diff < 30_000) return '刚刚'

  for (const { limit, divisor, suffix } of UNITS) {
    if (diff < limit) return `${Math.floor(diff / divisor)} ${suffix}`
  }

  return formatDate(timestamp)
}

/** 绝对日期，按设置输出 `2026-09-03` / `09/03/2026` / `03/09/2026` */
export function formatDate(timestamp: number): string {
  if (!timestamp) return '—'

  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())

  switch (settingsSnapshot().dateFormat) {
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`
    default:
      return `${year}-${month}-${day}`
  }
}

/** 时刻，按设置输出 `14:32` 或 `2:32 PM` */
export function formatTime(timestamp: number): string {
  if (!timestamp) return '—'

  const date = new Date(timestamp)
  const hours = date.getHours()
  const minutes = pad(date.getMinutes())

  if (settingsSnapshot().timeFormat === '12-hour') {
    const suffix = hours < 12 ? 'AM' : 'PM'
    return `${hours % 12 || 12}:${minutes} ${suffix}`
  }

  return `${pad(hours)}:${minutes}`
}

/** 日期加时间，如「2026-09-03 14:32」 */
export function formatDateTime(timestamp: number): string {
  if (!timestamp) return '—'

  return `${formatDate(timestamp)} ${formatTime(timestamp)}`
}

/** 会话时长，如「1:23:45」或「23:45」 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`
}
