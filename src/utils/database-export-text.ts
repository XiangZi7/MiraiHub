import type { DatabaseKind } from '@/types/database'
import type {
  DatabaseDataExportFormat,
  DatabaseExportData,
} from '@/types/database-export'

// 文本格式编码不依赖 Worker 客户端，导出 Worker 可直接引用而不形成 Worker 循环引用。

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

/** 按方言引用标识符。 */
export function exportSqlQuote(kind: DatabaseKind, value: string): string {
  return kind === 'mysql'
    ? `\`${value.replaceAll('`', '``')}\``
    : `"${value.replaceAll('"', '""')}"`
}

/** 按方言生成字面量；字符串用 UTF-8 十六进制表达式保存，独立于 MySQL 的反斜线转义模式。 */
export function exportSqlLiteral(
  kind: DatabaseKind,
  value: string | null,
  dataType: string
): string {
  if (value === null) return 'NULL'
  const type = dataType.toUpperCase()
  if (/^(BOOL|BOOLEAN)$/u.test(type) && /^(true|false)$/iu.test(value))
    return value.toUpperCase()
  if (/(BINARY|BLOB|BYTEA|^BIT)/u.test(type) && value.startsWith('base64:')) {
    const encoded = value.slice(7)
    if (/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded))
      return kind === 'mysql'
        ? `FROM_BASE64('${encoded}')`
        : `decode('${encoded}', 'base64')`
  }
  if (kind === 'mysql') {
    const hex = Array.from(new TextEncoder().encode(value), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    return `CONVERT(X'${hex}' USING utf8mb4)`
  }
  // SQLite 不支持 E'' 语法，也不处理反斜线转义
  if (kind === 'sqlite') return `'${value.replaceAll("'", "''")}'`
  return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
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
      exportSqlQuote(data.databaseKind, value)
    const target = [data.schema, tableName]
      .filter((part): part is string => Boolean(part))
      .map(quote)
      .join('.')
    const literal = (value: string | null, dataType: string): string =>
      exportSqlLiteral(data.databaseKind, value, dataType)
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
