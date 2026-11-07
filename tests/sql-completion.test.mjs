import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const { parseSql, completeSql } = await sourceLoader()(
  'src/utils/sql-completion.ts'
)
const fields = ['device', 'path', 'payload', 'created_at', 'app_logs']
function complete(source, kind = 'mysql', explicit = false) {
  const cursor = source.indexOf('|')
  const sql = source.replace('|', '')
  return completeSql(parseSql(sql, kind), cursor, fields, explicit)
}
const labels = result => result?.options.map(option => option.label) ?? []

test('SELECT、过滤、关联、分组、排序、写入和窗口子句均可提示真实字段', () => {
  for (const source of [
    'SELECT p| FROM app_logs',
    'SELECT * FROM app_logs WHERE p|',
    'SELECT * FROM app_logs l JOIN app_logs r ON l.p|',
    'SELECT device FROM app_logs GROUP BY p|',
    'SELECT device FROM app_logs HAVING p|',
    'SELECT device FROM app_logs ORDER BY p|',
    'SELECT ROW_NUMBER() OVER (PARTITION BY p|) FROM app_logs',
    'UPDATE app_logs SET p|',
    'INSERT INTO app_logs (p|)',
    'DELETE FROM app_logs WHERE p|',
  ])
    assert.ok(labels(complete(source)).includes('path'), source)
})

test('子句后的同行空格及点号自动触发，组合关键字一次插入', () => {
  for (const source of [
    'SELECT |',
    'SELECT * FROM app_logs GROUP BY |',
    'SELECT l.| FROM app_logs l',
  ])
    assert.ok(labels(complete(source)).includes('path'), source)
  assert.equal(labels(complete('SELECT * FROM app_logs GROUP |'))[0], 'BY')
  assert.equal(labels(complete('SELECT * FROM app_logs ORDER b|'))[0], 'BY')
  assert.ok(
    labels(complete('SELECT * FROM app_logs gro|')).includes('GROUP BY')
  )
  assert.ok(
    labels(complete('SELECT * FROM app_logs ord|')).includes('ORDER BY')
  )
})

test('回车及空白行缩进不自动补全，手动补全与继续输入仍可用', () => {
  for (const kind of ['mysql', 'postgresql']) {
    for (const source of [
      '|',
      '  |',
      'SHOW DATABASES\n|',
      'SHOW DATABASES;\n  |',
      'SELECT * FROM app_logs ORDER BY\n|',
      'SELECT\r\n\t|',
      'SELECT\n  |path FROM app_logs',
    ]) {
      assert.equal(complete(source, kind), null, source)
      assert.ok(labels(complete(source, kind, true)).includes('path'), source)
    }
    assert.ok(labels(complete('SELECT\n  p|', kind)).includes('path'))
  }
})

test('用户示例：ORDER BY 提示聚合别名 count，并保留其大小写', () => {
  const source =
    'SELECT device, COUNT(*) AS count FROM `solo-band`.`app_logs` GROUP BY device ORDER BY c| DESC;'
  assert.equal(labels(complete(source))[0], 'count')
  assert.equal(complete(source).options[0].kind, 'object')
  const implicit = 'SELECT SUM(id) total FROM app_logs ORDER BY t|'
  assert.equal(labels(complete(implicit))[0], 'total')
})

test('方言词库覆盖常用查询之外的关键字', () => {
  for (const [source, expected, kind] of [
    ['SELECT * FROM app_logs HAV|', 'HAVING', 'mysql'],
    ['SELECT * FROM app_logs ORDER BY device DE|', 'DESC', 'mysql'],
    ['EXP|', 'EXPLAIN', 'mysql'],
    ['TRUN|', 'TRUNCATE', 'mysql'],
    ['SELECT * FROM app_logs FOR UPD|', 'UPDATE', 'mysql'],
    ['VAC|', 'VACUUM', 'postgresql'],
    ['INSERT INTO app_logs VALUES (1) RET|', 'RETURNING', 'postgresql'],
    ['SELECT * FROM app_logs WHERE path ILI|', 'ILIKE', 'postgresql'],
  ])
    assert.ok(labels(complete(source, kind)).includes(expected), source)
})

test('字符串、注释和 PostgreSQL dollar quote 中不弹出补全', () => {
  for (const source of [
    "SELECT 'p|",
    'SELECT "p|',
    'SELECT 1 -- p|',
    'SELECT 1 # p|',
    'SELECT /* p| */',
  ])
    assert.equal(complete(source), null, source)
  assert.equal(complete('SELECT $$ p| $$', 'postgresql'), null)
  assert.equal(complete('SELECT $body$ p| $body$', 'postgresql'), null)
})

test('替换带引号的字段及词中间的内容，不留下重复引号或残余字符', () => {
  for (const [source, kind, expected] of [
    ['SELECT `pa|` FROM app_logs', 'mysql', 'SELECT `path` FROM app_logs'],
    ['SELECT "pa|" FROM app_logs', 'postgresql', 'SELECT "path" FROM app_logs'],
    ['SELECT pa|yload FROM app_logs', 'mysql', 'SELECT path FROM app_logs'],
    ['SELECT `pa| FROM app_logs', 'mysql', 'SELECT `path` FROM app_logs'],
  ]) {
    const result = complete(source, kind)
    const sql = source.replace('|', '')
    const option = result.options.find(item => item.label === 'path')
    assert.equal(
      sql.slice(0, result.from) + option.text + sql.slice(result.to),
      expected
    )
  }
})

test('别名不来自其它语句或字符串、注释，高亮保留完整原文', () => {
  const source =
    "SELECT 1 AS previous_alias; SELECT 'AS pretend_alias' /* AS comment_alias */ FROM app_logs ORDER BY p|"
  assert.ok(!labels(complete(source)).includes('previous_alias'))
  assert.ok(!labels(complete(source)).includes('pretend_alias'))
  assert.ok(!labels(complete(source)).includes('comment_alias'))
  const sql =
    'SELECT\n  路径, COUNT(*) AS count FROM `solo-band`.`app_logs`; -- 注释\n'
  assert.equal(
    parseSql(sql)
      .tokens.map(token => token.text)
      .join(''),
    sql
  )
})

test('增量解析在插入、删除、整段粘贴后与全量解析结果一致', () => {
  const base = [
    'SELECT device, COUNT(*) AS count FROM `solo-band`.`app_logs`',
    "WHERE path LIKE '/api/%' AND created_at > NOW() -- 最近日志",
    'GROUP BY device ORDER BY count DESC;',
    '/* 第二条 */ UPDATE app_logs SET payload = NULL WHERE id IN (1, 2, 3);',
    'INSERT INTO app_logs (device, path) VALUES ("a", \'b\');',
  ].join('\n')
  const at = (text, needle) => text.indexOf(needle)
  // 每一步都基于上一步文本，覆盖普通输入、开启注释/字符串等影响后文的编辑
  const edits = [
    text =>
      text.slice(0, at(text, 'FROM')) +
      ', path ' +
      text.slice(at(text, 'FROM')),
    text =>
      text.slice(0, at(text, 'GROUP')) + '/*' + text.slice(at(text, 'GROUP')),
    text => text.replace('/*GROUP', 'GROUP'),
    text =>
      text.slice(0, at(text, 'UPDATE')) + "'" + text.slice(at(text, 'UPDATE')),
    text => text.replace("'UPDATE", 'UPDATE'),
    text =>
      text.slice(0, at(text, 'WHERE id')) + text.slice(at(text, ';\nINSERT')),
    text => text + '\nSELECT 1;',
    text => text.slice(1),
    text => text.slice(0, -5),
    () => "DELETE FROM app_logs WHERE device = 'x' /* 粘贴整段 */;",
    text => `SELECT * FROM t;\n${text}`,
    () => '',
    () => base,
  ]
  for (const kind of ['mysql', 'postgresql', 'sqlite']) {
    let previous = parseSql(base, kind)
    for (const [index, edit] of edits.entries()) {
      const sql = edit(previous.sql)
      const incremental = parseSql(sql, kind, previous)
      const full = parseSql(sql, kind)
      assert.deepEqual(incremental.tokens, full.tokens, `${kind} #${index}`)
      assert.deepEqual(incremental.lexemes, full.lexemes, `${kind} #${index}`)
      assert.equal(incremental.tree.toString(), full.tree.toString())
      previous = incremental
    }
  }
  // 切换方言时不复用其它方言的语法树
  const mysql = parseSql(base, 'mysql')
  assert.deepEqual(
    parseSql(base, 'postgresql', mysql).tokens,
    parseSql(base, 'postgresql').tokens
  )
})
