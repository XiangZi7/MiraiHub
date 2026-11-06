/** 只为无时区日期类型启用本地日历，保留带时区值的原始文本及精度。 */
export function databaseInputType(
  dataType = '',
  value = ''
): 'text' | 'date' | 'time' | 'datetime-local' {
  // 原生日期输入仅支持毫秒精度；微秒、零日期和超出一天的 TIME 保留原始文本。
  if (
    /\.\d{4,}/.test(value) ||
    /^0000-|^\d{4}-00-|^\d{4}-\d{2}-00/.test(value) ||
    /^-\d|^(?:2[4-9]|[3-9]\d|\d{3,}):/.test(value)
  )
    return 'text'
  const type = dataType
    .trim()
    .toLowerCase()
    .replace(/\(\d+\)/g, '')
  if (type === 'date') return 'date'
  if (type === 'time' || type === 'time without time zone') return 'time'
  if (
    [
      'datetime',
      'timestamp',
      'timestamp without time zone',
      'datetime2',
      'smalldatetime',
    ].includes(type)
  )
    return 'datetime-local'
  return 'text'
}

/** HTML 日期输入使用 T 分隔，不经过 Date 对象，避免时区偏移。 */
export function dateInputValue(value: string, type: string): string {
  return type === 'datetime-local' ? value.replace(' ', 'T') : value
}

/** 日历的空值由调用方决定是否设为 NULL，普通清空仍是空字符串。 */
export function databaseDateValue(value: string, type: string): string {
  const result = type === 'datetime-local' ? value.replace('T', ' ') : value
  return result &&
    ['datetime-local', 'time'].includes(type) &&
    /\d{2}:\d{2}$/.test(result)
    ? `${result}:00`
    : result
}
