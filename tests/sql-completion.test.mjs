import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const { parseSql, completeSql } = await sourceLoader()(
  'src/utils/sql-completion.ts'
)
const fields = ['device', 'path', 'payload', 'created_at', 'app_logs']
function complete(source, kind = 'mysql') {
  const cursor = source.indexOf('|')
  const sql = source.replace('|', '')
  return completeSql(parseSql(sql, kind), cursor, fields)
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

test('子句后的空格、换行及点号自动触发，组合关键字一次插入', () => {
  for (const source of [
    'SELECT |',
    'SELECT * FROM app_logs GROUP BY |',
    'SELECT * FROM app_logs ORDER BY\n|',
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
