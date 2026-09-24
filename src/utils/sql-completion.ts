import { MySQL, PostgreSQL } from '@codemirror/lang-sql'
import type { DatabaseKind } from '@/types/database'

export interface SqlToken {
  text: string
  kind:
    | 'plain'
    | 'keyword'
    | 'function'
    | 'string'
    | 'number'
    | 'comment'
    | 'operator'
    | 'identifier'
}

export interface SqlSuggestion {
  label: string
  text: string
  kind: 'keyword' | 'function' | 'object'
}

// 方言完整关键字/类型由 CodeMirror 维护；常用函数和短语用于提高排序及整段插入体验。
const functions = new Set(
  'COUNT SUM AVG MIN MAX COALESCE CAST NOW LOWER UPPER LENGTH ROUND CONCAT SUBSTRING TRIM REPLACE ABS CEIL FLOOR ROW_NUMBER RANK DENSE_RANK LAG LEAD'.split(
    ' '
  )
)
const phrases = [
  'GROUP BY',
  'ORDER BY',
  'PARTITION BY',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'CROSS JOIN',
  'UNION ALL',
  'INSERT INTO',
  'DELETE FROM',
  'IS NULL',
  'IS NOT NULL',
  'NOT IN',
  'NOT EXISTS',
  'PRIMARY KEY',
  'FOREIGN KEY',
]
const dialects = { mysql: MySQL, postgresql: PostgreSQL }
const vocabularies = new Map<DatabaseKind, SqlSuggestion[]>()

function vocabulary(kind: DatabaseKind): SqlSuggestion[] {
  let values = vocabularies.get(kind)
  if (!values) {
    const spec = dialects[kind].spec
    values = [
      ...phrases,
      ...functions,
      ...`${spec.keywords} ${spec.types} ${spec.builtin ?? ''}`
        .toUpperCase()
        .split(/\s+/u),
    ]
      .filter(Boolean)
      .map(label => ({
        label,
        text: label,
        kind: functions.has(label) ? 'function' : 'keyword',
      }))
    vocabularies.set(kind, values)
  }
  return values
}

/** 同一次解析同时服务高亮、字符串/注释判断和语句内标识符补全。 */
export function parseSql(sql: string, kind: DatabaseKind = 'mysql') {
  const tree = dialects[kind].language.parser.parse(sql)
  const lexemes: { name: string; text: string; from: number; to: number }[] = []
  tree.iterate({
    enter(node) {
      if (!node.node.firstChild && node.to > node.from)
        lexemes.push({
          name: node.name,
          text: sql.slice(node.from, node.to),
          from: node.from,
          to: node.to,
        })
    },
  })
  const tokens: SqlToken[] = []
  let offset = 0
  for (const token of lexemes) {
    if (token.from > offset)
      tokens.push({ text: sql.slice(offset, token.from), kind: 'plain' })
    let tokenKind: SqlToken['kind'] = 'plain'
    if (/Comment$/u.test(token.name)) tokenKind = 'comment'
    else if (/^(String|Bytes)$/u.test(token.name)) tokenKind = 'string'
    else if (/^(Number|Bits)$/u.test(token.name)) tokenKind = 'number'
    else if (/Identifier$/u.test(token.name)) tokenKind = 'identifier'
    else if (functions.has(token.text.toUpperCase())) tokenKind = 'function'
    else if (/^(Keyword|Type|Bool|Null)$/u.test(token.name))
      tokenKind = 'keyword'
    else if (/^(Operator|Punctuation|[.;(){}\[\]])$/u.test(token.name))
      tokenKind = 'operator'
    tokens.push({ text: token.text, kind: tokenKind })
    offset = token.to
  }
  if (offset < sql.length)
    tokens.push({ text: sql.slice(offset), kind: 'plain' })
  return { sql, kind, tree, lexemes, tokens }
}

type SqlDocument = ReturnType<typeof parseSql>

function completionRange(document: SqlDocument, cursor: number) {
  const token = document.lexemes.find(
    item => item.from < cursor && item.to >= cursor
  )
  if (token && /^(String|Bytes|LineComment|BlockComment)$/u.test(token.name))
    return null
  if (token?.name === 'QuotedIdentifier') {
    const quote = token.text[0]!
    const partial = document.sql.slice(token.from + 1, cursor)
    const closed = token.text.length > 1 && token.text.endsWith(quote)
    // 已闭合的标识符不再弹提示；光标在结束引号前时替换整个标识符。
    if (cursor === token.to && closed) return null
    return {
      from: token.from,
      to: closed ? token.to : cursor,
      prefix: partial.replaceAll(quote + quote, quote),
      quote,
    }
  }
  const prefix =
    document.sql.slice(0, cursor).match(/[\p{L}_][\p{L}\p{N}_$]*$/u)?.[0] ?? ''
  return {
    from: cursor - prefix.length,
    to: prefix && token ? token.to : cursor,
    prefix,
    quote: '',
  }
}

/** 保留给无需缓存解析树的调用者使用。 */
export function sqlCompletionPrefix(
  sql: string,
  cursor: number,
  kind: DatabaseKind = 'mysql'
): string | null {
  return completionRange(parseSql(sql, kind), cursor)?.prefix ?? null
}

export function filterSqlSuggestions(
  values: readonly string[],
  prefix: string
): string[] {
  const seen = new Set<string>()
  const lower = prefix.toLocaleLowerCase()
  return values
    .filter(value => {
      const key = value.toLocaleLowerCase()
      if (seen.has(key) || key === lower || !key.startsWith(lower)) return false
      seen.add(key)
      return true
    })
    .slice(0, 60)
}

/** 字段可用于任意子句；解析器限定当前语句并排除字符串、注释中的伪别名。 */
export function completeSql(
  document: SqlDocument,
  cursor: number,
  suggestions: readonly string[],
  explicit = false
) {
  const range = completionRange(document, cursor)
  if (!range) return null
  const { sql, tree, lexemes } = document
  const before = sql.slice(0, range.from)
  if (
    !explicit &&
    !range.prefix &&
    (!before.trim() || !/[\s.,(=<>]$/u.test(before))
  )
    return null
  const statements = tree.topNode.getChildren('Statement')
  const statement =
    statements.find(node => node.from <= cursor && node.to >= cursor) ??
    [...statements]
      .reverse()
      .find(
        node =>
          node.to < cursor &&
          !sql.slice(node.from, node.to).trimEnd().endsWith(';')
      )
  const localNames: string[] = []
  if (statement) {
    const words = lexemes.filter(
      token =>
        token.from >= statement.from &&
        token.to <= statement.to &&
        !/Comment$/u.test(token.name)
    )
    for (const [index, token] of words.entries()) {
      if (token.from === range.from || token.name === 'String') continue
      // AS 后的别名可以和 COUNT 等关键字同名。
      if (
        /Identifier$/u.test(token.name) ||
        (words[index - 1]?.text.toUpperCase() === 'AS' &&
          /^(Keyword|Type|Builtin)$/u.test(token.name))
      ) {
        const quote = token.name === 'QuotedIdentifier' ? token.text[0]! : ''
        localNames.push(
          quote
            ? token.text
                .slice(1, token.text.endsWith(quote) ? -1 : undefined)
                .replaceAll(quote + quote, quote)
            : token.text
        )
      }
    }
  }
  // GROUP/ORDER/PARTITION 后优先 BY；空格、换行、点号后也可以自动触发。
  const preceding = lexemes
    .filter(token => token.to <= range.from && !/Comment$/u.test(token.name))
    .at(-1)
    ?.text.toUpperCase()
  const preferred = ['GROUP', 'ORDER', 'PARTITION'].includes(preceding ?? '')
    ? ['BY']
    : ['LEFT', 'RIGHT', 'INNER', 'CROSS', 'FULL'].includes(preceding ?? '')
      ? ['JOIN']
      : []
  const object = (label: string): SqlSuggestion => ({
    label,
    text: label,
    kind: 'object',
  })
  const candidates: SqlSuggestion[] = [
    ...preferred.map(label => ({
      label,
      text: label,
      kind: 'keyword' as const,
    })),
    ...localNames.map(object),
    ...suggestions.map(object),
    ...(!range.quote && preceding !== '.' ? vocabulary(document.kind) : []),
  ]
  const labels = filterSqlSuggestions(
    candidates.map(item => item.label),
    range.prefix
  )
  const options = labels.map(label => {
    const candidate = candidates.find(item => item.label === label)!
    if (candidate.kind !== 'object') return candidate
    const quote = range.quote || (document.kind === 'mysql' ? '`' : '"')
    const quoteName = (name: string) =>
      quote + name.replaceAll(quote, quote + quote) + quote
    const text = range.quote
      ? quoteName(label)
      : label
          .split('.')
          .map(part =>
            /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(part) ? part : quoteName(part)
          )
          .join('.')
    return { ...candidate, text }
  })
  return { ...range, options }
}
