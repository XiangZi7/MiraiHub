import type { DateValueMode } from '@/utils/date-value'

/**
 * 按列类型决定单元格是否挂日期选择器。
 *
 * 选择器的输入框仍是文本框，微秒、零日期、超过 24 小时的 TIME 和时区后缀
 * 都能原样键入和保留，所以这里只看类型，不再因为值的格式退回纯文本。
 */
export function databaseInputType(dataType = ''): DateValueMode | 'text' {
  const type = dataType
    .trim()
    .toLowerCase()
    .replace(/\(\d+\)/g, '')
  if (type === 'date') return 'date'
  if (
    [
      'time',
      'time without time zone',
      'time with time zone',
      'timetz',
    ].includes(type)
  )
    return 'time'
  if (
    [
      'datetime',
      'timestamp',
      'timestamp without time zone',
      'timestamp with time zone',
      'timestamptz',
      'datetime2',
      'smalldatetime',
      'datetimeoffset',
    ].includes(type)
  )
    return 'datetime'
  return 'text'
}
