/**
 * 日期选择器的纯文本日期处理。
 *
 * 数据库里的日期本质上是字符串，这里只做"拆字段 / 拼回去"，值本身不经过 Date，
 * 避免本地时区偏移把 00:30 改成前一天；小数秒与时区后缀原样保留，
 * 选择器只替换用户实际点选的那部分。
 */

export type DateValueMode = 'date' | 'time' | 'datetime'

export interface DateParts {
  year: number
  /** 1–12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 小数秒，含点号，如 `.123456`；没有时为空串。 */
  fraction: string
  /** 时区后缀，如 `+08:00`、` +08:00`、`Z`；没有时为空串。 */
  suffix: string
}

export interface CalendarDay {
  year: number
  month: number
  day: number
  /** 属于上月或下月、仅用于补齐网格的日期。 */
  outside: boolean
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?(\s?(?:Z|[+-]\d{2}(?::?\d{2})?))?)?$/i
const TIME =
  /^(\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?(\s?(?:Z|[+-]\d{2}(?::?\d{2})?))?$/i

const pad = (value: number, length = 2): string =>
  String(value).padStart(length, '0')

/** new Date(y, …) 会把 0–99 年映射到 1900 年代，公元 1–99 年得用 setFullYear。 */
function localDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(2000, 0, 1)
  date.setFullYear(year, monthIndex, day)
  return date
}

export function daysInMonth(year: number, month: number): number {
  return localDate(year, month, 0).getDate()
}

function validDate(year: number, month: number, day: number): boolean {
  return (
    year > 0 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  )
}

function validTime(hour: number, minute: number, second: number): boolean {
  return hour < 24 && minute < 60 && second < 60
}

/** 解析失败（零日期、超过 24 小时的 TIME、任意文本）返回 null，调用方保留原文。 */
export function parseDateValue(
  value: string,
  mode: DateValueMode
): DateParts | null {
  const text = value.trim()
  if (mode === 'time') {
    const match = TIME.exec(text)
    if (!match) return null
    const [, h, m, s = '0', fraction = '', suffix = ''] = match
    const parts = {
      year: 0,
      month: 0,
      day: 0,
      hour: Number(h),
      minute: Number(m),
      second: Number(s),
      fraction,
      suffix,
    }
    return validTime(parts.hour, parts.minute, parts.second) ? parts : null
  }

  const match = (mode === 'date' ? DATE : DATETIME).exec(text)
  if (!match) return null
  const [, y, mo, d, h = '0', m = '0', s = '0', fraction = '', suffix = ''] =
    match
  const parts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(m),
    second: Number(s),
    fraction,
    suffix,
  }
  return validDate(parts.year, parts.month, parts.day) &&
    validTime(parts.hour, parts.minute, parts.second)
    ? parts
    : null
}

/** 按数据库常用格式输出：`YYYY-MM-DD`、`HH:mm:ss`、`YYYY-MM-DD HH:mm:ss`。 */
export function formatDateValue(parts: DateParts, mode: DateValueMode): string {
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
  if (mode === 'date') return date
  const time = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${parts.fraction}${parts.suffix}`
  return mode === 'time' ? time : `${date} ${time}`
}

/** 当前本地时间，不带小数秒和时区。 */
export function currentDateParts(now = new Date()): DateParts {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
    fraction: '',
    suffix: '',
  }
}

/** 6×7 的月历网格，首列为 weekStart（0 = 周日，1 = 周一）。 */
export function calendarDays(
  year: number,
  month: number,
  weekStart: 0 | 1 = 1
): CalendarDay[] {
  const offset = (localDate(year, month - 1, 1).getDay() - weekStart + 7) % 7
  return Array.from({ length: 42 }, (_, index) => {
    // Date 自动处理跨月与跨年，只用来推算网格里的年月日。
    const date = localDate(year, month - 1, index - offset + 1)
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      outside: date.getMonth() + 1 !== month,
    }
  })
}

/** 按月翻页，跨年时自动进位或借位。 */
export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const index = year * 12 + month - 1 + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}
