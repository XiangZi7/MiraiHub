import { MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql'
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
const dialects = { mysql: MySQL, postgresql: PostgreSQL, sqlite: SQLite }

/** 候选项附带预先算好的小写形式，按键过滤时不再逐个转换。 */
interface SqlCandidate {
  suggestion: SqlSuggestion
  lower: string
}

const candidate = (suggestion: SqlSuggestion): SqlCandidate => ({
  suggestion,
  lower: suggestion.label.toLocaleLowerCase(),
})
const objectCandidate = (label: string) =>
  candidate({ label, text: label, kind: 'object' })

const vocabularies = new Map<DatabaseKind, SqlCandidate[]>()
// 字段/表名数组由上层整体替换，按数组引用缓存即可跨按键复用。
const objectCandidates = new WeakMap<readonly string[], SqlCandidate[]>()

function vocabulary(kind: DatabaseKind): SqlCandidate[] {
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
      .map(label =>
        candidate({
          label,
          text: label,
          kind: functions.has(label) ? 'function' : 'keyword',
        })
      )
    vocabularies.set(kind, values)
  }
  return values
}

function objects(labels: readonly string[]): SqlCandidate[] {
  let values = objectCandidates.get(labels)
  if (!values) {
    values = labels.map(objectCandidate)
    objectCandidates.set(labels, values)
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

const SUGGESTION_LIMIT = 60

/** 按前缀过滤（忽略大小写），同名只保留首个；凑满上限即停止扫描。
 *  候选按分组依次传入，避免每次按键拼接整份词库。 */
function filterCandidates(
  groups: readonly (readonly SqlCandidate[])[],
  prefix: string
): SqlSuggestion[] {
  const seen = new Set<string>()
  const lower = prefix.toLocaleLowerCase()
  const result: SqlSuggestion[] = []
  for (const group of groups)
    for (const value of group) {
      const key = value.lower
      if (seen.has(key) || key === lower || !key.startsWith(lower)) continue
      seen.add(key)
      result.push(value.suggestion)
      if (result.length >= SUGGESTION_LIMIT) return result
    }
  return result
}

export function filterSqlSuggestions(
  values: readonly string[],
  prefix: string
): string[] {
  return filterCandidates([objects(values)], prefix).map(item => item.label)
}

/**
 * 在语句词法单元中把别名解析成表名：支持 `FROM orders o`、`JOIN orders AS o`
 * 以及直接用表名限定（`orders.`）。找不到时返回 null。
 */
export function resolveSqlQualifier(
  words: readonly { text: string; name: string }[],
  qualifier: string
): string | null {
  const unquote = (text: string) => text.replace(/^[`"]|[`"]$/gu, '')
  const target = unquote(qualifier).toLowerCase()
  for (const [index, token] of words.entries()) {
    if (unquote(token.text).toLowerCase() !== target) continue
    // 后面紧跟点号说明这里本身是限定符引用，不是定义位置
    if (words[index + 1]?.text === '.') continue
    const previous = words[index - 1]
    const table =
      previous?.text.toUpperCase() === 'AS' ? words[index - 2] : previous
    // 别名前紧跟的标识符就是表名；否则它本身就是表名
    if (table && /Identifier$/u.test(table.name)) return unquote(table.text)
    return unquote(token.text)
  }
  return target
}

/** 字段可用于任意子句；空白行仅响应手动补全，避免回车或缩进时自动弹窗。
 *  columnsByTable 提供“表名 → 字段”映射时，`别名.` 之后只补该表的字段。 */
export function completeSql(
  document: SqlDocument,
  cursor: number,
  suggestions: readonly string[],
  explicit = false,
  columnsByTable?: Readonly<Record<string, readonly string[]>>
) {
  const range = completionRange(document, cursor)
  if (!range) return null
  const { sql, tree, lexemes } = document
  const before = sql.slice(0, range.from)
  if (
    !explicit &&
    !range.prefix &&
    (/(?:^|\n)[^\S\n]*$/u.test(before) || !/[\s.,(=<>]$/u.test(before))
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
  let qualifiedColumns: readonly string[] | null = null
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
  // `别名.` / `表名.` 之后只补对应表的字段
  const beforeDot = sql
    .slice(0, range.from)
    .match(/([\p{L}_][\p{L}\p{N}_$]*|`[^`]+`|"[^"]+")\.$/u)
  if (beforeDot && columnsByTable && statement) {
    const words = lexemes.filter(
      token =>
        token.from >= statement.from &&
        token.to <= statement.to &&
        !/Comment$/u.test(token.name) &&
        token.from !== range.from
    )
    const table = resolveSqlQualifier(words, beforeDot[1]!)
    if (table) {
      const key = Object.keys(columnsByTable).find(
        name => name.toLowerCase() === table.toLowerCase()
      )
      if (key) qualifiedColumns = columnsByTable[key]!
    }
  }
  // GROUP/ORDER/PARTITION 后优先 BY；同一行的空格、点号后也可以自动触发。
  const preceding = lexemes
    .filter(token => token.to <= range.from && !/Comment$/u.test(token.name))
    .at(-1)
    ?.text.toUpperCase()
  const preferred = ['GROUP', 'ORDER', 'PARTITION'].includes(preceding ?? '')
    ? ['BY']
    : ['LEFT', 'RIGHT', 'INNER', 'CROSS', 'FULL'].includes(preceding ?? '')
      ? ['JOIN']
      : []
  const groups: SqlCandidate[][] = qualifiedColumns
    ? [objects(qualifiedColumns)]
    : [
        preferred.map(label =>
          candidate({ label, text: label, kind: 'keyword' })
        ),
        localNames.map(objectCandidate),
        objects(suggestions),
        !range.quote && preceding !== '.' ? vocabulary(document.kind) : [],
      ]
  // 过滤直接产出候选对象（同名取首个），无需再按 label 回查。
  const options = filterCandidates(groups, range.prefix).map(item => {
    if (item.kind !== 'object') return item
    const label = item.label
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
    return { ...item, text }
  })
  return { ...range, options }
}
