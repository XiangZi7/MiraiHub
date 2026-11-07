import type { DatabaseKind } from '@/types/database'

/** 一条 SQL 片段。正文使用 `${1:默认值}` / `$1` / `$0` 占位，同号占位会在离开时同步内容。 */
export interface SqlSnippet {
  id: string
  /** 补全触发词，按前缀匹配 */
  prefix: string
  /** 列表里展示的说明 */
  label: string
  body: string
  /** 仅在这些方言下出现；缺省表示通用 */
  kinds?: DatabaseKind[]
  builtin?: boolean
}

const builtin = (
  id: string,
  prefix: string,
  label: string,
  body: string,
  kinds?: DatabaseKind[]
): SqlSnippet => ({ id: `builtin:${id}`, prefix, label, body, kinds, builtin: true })

/** 内置模板；中文说明在界面上经 i18n 翻译。 */
export const BUILTIN_SQL_SNIPPETS: readonly SqlSnippet[] = [
  builtin('select', 'sel', '查询', 'SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:1 = 1};$0'),
  builtin(
    'select-limit',
    'sell',
    '查询前 N 行',
    'SELECT ${1:*}\nFROM ${2:table_name}\nORDER BY ${3:id} DESC\nLIMIT ${4:100};$0'
  ),
  builtin('count', 'cnt', '统计行数', 'SELECT COUNT(*)\nFROM ${1:table_name}\nWHERE ${2:1 = 1};$0'),
  builtin(
    'insert',
    'ins',
    '插入',
    'INSERT INTO ${1:table_name} (${2:column1}, ${3:column2})\nVALUES (${4:value1}, ${5:value2});$0'
  ),
  builtin(
    'update',
    'upd',
    '更新',
    'UPDATE ${1:table_name}\nSET ${2:column} = ${3:value}\nWHERE ${4:id = 1};$0'
  ),
  builtin('delete', 'del', '删除', 'DELETE FROM ${1:table_name}\nWHERE ${2:id = 1};$0'),
  builtin(
    'join',
    'join',
    '内连接',
    'SELECT ${1:a}.*, ${2:b}.*\nFROM ${3:table_a} ${1:a}\nJOIN ${4:table_b} ${2:b} ON ${2:b}.${5:a_id} = ${1:a}.${6:id};$0'
  ),
  builtin(
    'left-join',
    'ljoin',
    '左连接',
    'SELECT ${1:a}.*, ${2:b}.*\nFROM ${3:table_a} ${1:a}\nLEFT JOIN ${4:table_b} ${2:b} ON ${2:b}.${5:a_id} = ${1:a}.${6:id}\nWHERE ${2:b}.${5:a_id} IS NULL;$0'
  ),
  builtin(
    'group',
    'grp',
    '分组统计',
    'SELECT ${1:column}, COUNT(*) AS total\nFROM ${2:table_name}\nGROUP BY ${1:column}\nORDER BY total DESC;$0'
  ),
  builtin(
    'cte',
    'cte',
    '公用表表达式（CTE）',
    'WITH ${1:cte_name} AS (\n  SELECT ${2:*}\n  FROM ${3:table_name}\n  WHERE ${4:1 = 1}\n)\nSELECT *\nFROM ${1:cte_name};$0'
  ),
  builtin(
    'recursive-cte',
    'rcte',
    '递归 CTE',
    'WITH RECURSIVE ${1:tree} AS (\n  SELECT ${2:id}, ${3:parent_id}, 1 AS depth\n  FROM ${4:table_name}\n  WHERE ${3:parent_id} IS NULL\n  UNION ALL\n  SELECT c.${2:id}, c.${3:parent_id}, t.depth + 1\n  FROM ${4:table_name} c\n  JOIN ${1:tree} t ON c.${3:parent_id} = t.${2:id}\n)\nSELECT *\nFROM ${1:tree};$0'
  ),
  builtin(
    'window',
    'win',
    '窗口函数排名',
    'SELECT ${1:column},\n  ROW_NUMBER() OVER (PARTITION BY ${2:group_column} ORDER BY ${3:order_column} DESC) AS rn\nFROM ${4:table_name};$0'
  ),
  builtin(
    'top-n',
    'topn',
    '每组取前 N 条',
    'SELECT *\nFROM (\n  SELECT t.*,\n    ROW_NUMBER() OVER (PARTITION BY ${1:group_column} ORDER BY ${2:order_column} DESC) AS rn\n  FROM ${3:table_name} t\n) ranked\nWHERE rn <= ${4:3};$0'
  ),
  builtin(
    'running-total',
    'cum',
    '累计求和',
    'SELECT ${1:day}, ${2:amount},\n  SUM(${2:amount}) OVER (ORDER BY ${1:day}) AS running_total\nFROM ${3:table_name};$0'
  ),
  builtin(
    'case',
    'case',
    'CASE 表达式',
    'CASE\n  WHEN ${1:condition} THEN ${2:result}\n  ELSE ${3:other}\nEND$0'
  ),
  builtin(
    'exists',
    'exi',
    'EXISTS 子查询',
    'WHERE EXISTS (\n  SELECT 1\n  FROM ${1:table_name} ${2:t}\n  WHERE ${2:t}.${3:id} = ${4:outer_id}\n)$0'
  ),
  builtin(
    'create-mysql',
    'crt',
    '建表',
    'CREATE TABLE ${1:table_name} (\n  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\n  ${2:name} VARCHAR(${3:255}) NOT NULL,\n  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,\n  PRIMARY KEY (id)\n) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = \'${4:comment}\';$0',
    ['mysql']
  ),
  builtin(
    'create-postgresql',
    'crt',
    '建表',
    'CREATE TABLE ${1:table_name} (\n  id BIGSERIAL PRIMARY KEY,\n  ${2:name} VARCHAR(${3:255}) NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);$0',
    ['postgresql']
  ),
  builtin(
    'create-sqlite',
    'crt',
    '建表',
    'CREATE TABLE ${1:table_name} (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  ${2:name} TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n);$0',
    ['sqlite']
  ),
  builtin(
    'index',
    'idx',
    '创建索引',
    'CREATE INDEX ${1:idx_name} ON ${2:table_name} (${3:column});$0'
  ),
  builtin(
    'alter-add',
    'addcol',
    '添加字段',
    'ALTER TABLE ${1:table_name}\nADD COLUMN ${2:column_name} ${3:VARCHAR(255)};$0'
  ),
  builtin(
    'upsert-mysql',
    'ups',
    '插入或更新',
    'INSERT INTO ${1:table_name} (${2:id}, ${3:column})\nVALUES (${4:1}, ${5:value})\nON DUPLICATE KEY UPDATE ${3:column} = VALUES(${3:column});$0',
    ['mysql']
  ),
  builtin(
    'upsert',
    'ups',
    '插入或更新',
    'INSERT INTO ${1:table_name} (${2:id}, ${3:column})\nVALUES (${4:1}, ${5:value})\nON CONFLICT (${2:id}) DO UPDATE SET ${3:column} = excluded.${3:column};$0',
    ['postgresql', 'sqlite']
  ),
]

export interface SnippetStop {
  index: number
  from: number
  to: number
}

export interface ExpandedSnippet {
  text: string
  /** 所有占位（含同号镜像），按出现位置排序，位置相对片段起点 */
  stops: SnippetStop[]
}

/** 展开片段正文：去掉占位语法得到纯文本，并记录每个占位的范围。`\$` 表示字面量 `$`。 */
export function expandSnippet(body: string, indent = ''): ExpandedSnippet {
  let text = ''
  const stops: SnippetStop[] = []
  const pattern = /\\\$|\$\{(\d+)(?::([^}]*))?\}|\$(\d+)|\n/gu
  let cursor = 0
  for (const match of body.matchAll(pattern)) {
    text += body.slice(cursor, match.index)
    cursor = match.index + match[0].length
    if (match[0] === '\\$') text += '$'
    else if (match[0] === '\n') text += `\n${indent}`
    else {
      const index = Number(match[1] ?? match[3])
      const placeholder = (match[2] ?? '').replaceAll('\n', `\n${indent}`)
      stops.push({ index, from: text.length, to: text.length + placeholder.length })
      text += placeholder
    }
  }
  text += body.slice(cursor)
  return { text, stops }
}

/** 跳转顺序：1、2、3…，最后是 $0；没有 $0 时停在片段末尾。 */
export function snippetOrder(stops: readonly SnippetStop[]): number[] {
  const indexes = [...new Set(stops.map(stop => stop.index))].sort(
    (a, b) => (a || Infinity) - (b || Infinity)
  )
  return indexes
}

export function snippetsFor(
  kind: DatabaseKind,
  custom: readonly SqlSnippet[]
): SqlSnippet[] {
  const own = custom.filter(item => !item.kinds?.length || item.kinds.includes(kind))
  const builtins = BUILTIN_SQL_SNIPPETS.filter(
    item => !item.kinds?.length || item.kinds.includes(kind)
  )
  return [...own, ...builtins]
}

/** 按触发词前缀匹配片段（忽略大小写），供编辑器把片段并入补全候选；空前缀不匹配。 */
export function matchSnippets(
  snippets: readonly SqlSnippet[],
  prefix: string
): SqlSnippet[] {
  const lower = prefix.toLowerCase()
  if (!lower) return []
  return snippets.filter(item => item.prefix.toLowerCase().startsWith(lower))
}

/** 自定义片段的基本校验，返回错误文案键或空字符串。 */
export function validateSnippet(snippet: Pick<SqlSnippet, 'prefix' | 'body'>): string {
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(snippet.prefix.trim()))
    return '触发词只能包含字母、数字和下划线，且不能以数字开头'
  if (!snippet.body.trim()) return '片段内容不能为空'
  return ''
}
