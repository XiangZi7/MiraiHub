import type {
  DatabaseDataExportFormat,
  DatabaseExportData,
} from '@/types/database-export'

export const databaseExportFormats = [
  { id: 'sql', label: 'SQL', extension: 'sql', mime: 'application/sql' },
  {
    id: 'xlsx',
    label: 'Excel',
    extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    id: 'dictionary',
    label: '数据字典',
    extension: 'html',
    mime: 'text/html;charset=utf-8',
  },
  {
    id: 'txt',
    label: 'TXT',
    extension: 'txt',
    mime: 'text/plain;charset=utf-8',
  },
  { id: 'csv', label: 'CSV', extension: 'csv', mime: 'text/csv;charset=utf-8' },
  {
    id: 'json',
    label: 'JSON',
    extension: 'json',
    mime: 'application/json;charset=utf-8',
  },
] as const

/** 按 CSV 标准转义单元格，保留逗号、双引号和换行。 */
export function exportCsvCell(value: string | null): string {
  if (value === null) return ''
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** 转义字典中的文本，防止字段名和备注被浏览器解释为 HTML。 */
function html(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!
  )
}

/** 将一批已提交数据编码成指定文本格式，保留空值、长整数及重名字段。 */
export function exportDataText(
  data: DatabaseExportData,
  format: Exclude<DatabaseDataExportFormat, 'xlsx'>,
  tableName = data.name,
  includeHeader = true
): string {
  const names = data.columns.map(column => column.name)
  if (format === 'csv')
    return [
      ...(includeHeader ? [names.map(exportCsvCell).join(',')] : []),
      ...data.rows.map(row =>
        names.map((_, index) => exportCsvCell(row[index] ?? null)).join(',')
      ),
    ].join('\r\n')
  if (format === 'txt') {
    const cell = (value: string | null): string =>
      value === null
        ? '\\N'
        : value
            .replaceAll('\\', '\\\\')
            .replaceAll('\t', '\\t')
            .replaceAll('\r', '\\r')
            .replaceAll('\n', '\\n')
    return [
      ...(includeHeader ? [names.map(cell).join('\t')] : []),
      ...data.rows.map(row =>
        names.map((_, index) => cell(row[index] ?? null)).join('\t')
      ),
    ].join('\r\n')
  }
  if (format === 'json') {
    // 重名字段使用位置键，避免 JOIN 结果导出时静默覆盖同名列。
    const used = new Set<string>()
    const keys = names.map(name => {
      let key = name
      let suffix = 2
      while (used.has(key)) key = `${name}_${suffix++}`
      used.add(key)
      return key
    })
    return JSON.stringify(
      data.rows.map(row =>
        Object.fromEntries(keys.map((key, index) => [key, row[index] ?? null]))
      ),
      null,
      2
    )
  }
  if (format === 'sql') {
    const quote = (value: string): string =>
      data.databaseKind === 'mysql'
        ? `\`${value.replaceAll('`', '``')}\``
        : `"${value.replaceAll('"', '""')}"`
    const target = [data.schema, tableName]
      .filter((part): part is string => Boolean(part))
      .map(quote)
      .join('.')
    // 字符串用 UTF-8 十六进制表达式保存，独立于 MySQL 的反斜线转义模式。
    const literal = (value: string | null, dataType: string): string => {
      if (value === null) return 'NULL'
      const type = dataType.toUpperCase()
      if (/^(BOOL|BOOLEAN)$/u.test(type) && /^(true|false)$/iu.test(value))
        return value.toUpperCase()
      if (
        /(BINARY|BLOB|BYTEA|^BIT)/u.test(type) &&
        value.startsWith('base64:')
      ) {
        const encoded = value.slice(7)
        if (/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded))
          return data.databaseKind === 'mysql'
            ? `FROM_BASE64('${encoded}')`
            : `decode('${encoded}', 'base64')`
      }
      if (data.databaseKind === 'mysql') {
        const hex = Array.from(new TextEncoder().encode(value), byte =>
          byte.toString(16).padStart(2, '0')
        ).join('')
        return `CONVERT(X'${hex}' USING utf8mb4)`
      }
      return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
    }
    return (
      [
        ...(includeHeader
          ? [
              `-- ${target}\n-- ${data.rows.length} rows${data.truncated ? ' (limited result)' : ''}`,
            ]
          : []),
        ...data.rows.map(
          row =>
            `INSERT INTO ${target} (${names.map(quote).join(', ')})${data.databaseKind === 'postgresql' ? ' OVERRIDING SYSTEM VALUE' : ''} VALUES (${names.map((_, index) => literal(row[index] ?? null, data.columns[index]?.dataType ?? '')).join(', ')});`
        ),
      ].join('\n') + '\n'
    )
  }
  const rows = data.columns.map(column => {
    const metadata = 'nullable' in column ? column : undefined
    return [
      column.name,
      column.dataType,
      metadata ? (metadata.nullable ? 'YES' : 'NO') : '',
      metadata?.primaryKey ? 'YES' : '',
      metadata?.defaultValue ?? '',
      metadata?.comment ?? '',
    ]
      .map(value => `<td>${html(value)}</td>`)
      .join('')
  })
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${html(data.name)} · 数据字典</title><style>body{font:14px system-ui;max-width:1100px;margin:40px auto;color:#222}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:10px;text-align:left;white-space:pre-wrap}th{background:#f4f4f5}</style><h1>${html([data.schema, data.name].filter(Boolean).join('.'))}</h1><p>数据字典 · ${data.columns.length} 个字段</p><table><thead><tr>${['字段名', '类型', '允许空值', '主键', '默认值', '备注'].map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row}</tr>`).join('')}</tbody></table></html>`
}

/** 为小型文件或测试生成字节；生产数据导出使用 Worker 分批编码与文件流写入。 */
export async function exportDataBytes(
  data: DatabaseExportData,
  format: DatabaseDataExportFormat,
  tableName = data.name
): Promise<Uint8Array> {
  if (format !== 'xlsx') {
    const text = exportDataText(data, format, tableName)
    return new TextEncoder().encode(
      format === 'csv' || format === 'txt' ? `\uFEFF${text}` : text
    )
  }
  if (data.rows.length >= 1_048_576 || data.columns.length > 16_384)
    throw new Error('数据超出 Excel 工作表的行列上限，请使用 CSV 或 SQL 导出')
  // 按需加载工作簿库，数据库界面的首屏不承担 Excel 编码器体积。
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const name =
    data.name
      .replace(/[\\/*?:[\]]/gu, '_')
      .replace(/^'+|'+$/gu, '')
      .slice(0, 31) || 'Result'
  const sheet = workbook.addWorksheet(name)
  sheet.addRow(data.columns.map(column => column.name))
  for (const row of data.rows)
    sheet.addRow(data.columns.map((_, index) => row[index] ?? null))
  // 数据以文本写入，保留 BIGINT、前导零和公式样式字符串的原值。
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.columns.forEach(column => {
    column.width = 24
  })
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** 生成当前本地时间的默认文件名；日期和时间开关可独立选择，移除系统不允许的字符。 */
export function databaseExportFileName(
  name: string,
  extension: string,
  options: { database?: string; date?: boolean; time?: boolean },
  now = new Date()
): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const parts = [options.database, name].filter(Boolean)
  if (options.date)
    parts.push(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    )
  if (options.time)
    parts.push(
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    )
  const base =
    parts
      .join('_')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
      .trim()
      .replace(/[. ]+$/gu, '')
      .slice(0, 180) || 'result'
  return `${base}.${extension}`
}
