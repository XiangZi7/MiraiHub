import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { parseSql, completeSql } = await load('src/utils/sql-completion.ts')
const { statementAtCursor, formatSql } = await load('src/utils/sql-format.ts')
const { parseExplainPlan, maxPlanCost } = await load('src/utils/explain-plan.ts')
const { diffSchemas } = await load('src/utils/schema-diff.ts')
const { layoutErDiagram } = await load('src/utils/er-layout.ts')

const tableColumns = {
  orders: ['id', 'user_id', 'total'],
  users: ['id', 'email'],
}

/** 以 | 标记光标位置执行补全。 */
function complete(source, kind = 'mysql') {
  const cursor = source.indexOf('|')
  const sql = source.replace('|', '')
  const result = completeSql(parseSql(sql, kind), cursor, ['id', 'email', 'total'], true, tableColumns)
  return result?.options.map(option => option.label) ?? []
}

test('别名限定后只补对应表的字段', () => {
  assert.deepEqual(complete('SELECT o.| FROM orders o'), ['id', 'user_id', 'total'])
  assert.deepEqual(complete('SELECT u.e| FROM orders o JOIN users AS u ON u.id = o.user_id'), ['email'])
  assert.deepEqual(complete('SELECT users.| FROM users'), ['id', 'email'])
})

test('SQLite 方言也能解析与补全', () => {
  assert.deepEqual(complete('SELECT o.t| FROM orders o', 'sqlite'), ['total'])
})

test('按光标定位当前语句，忽略字符串和注释里的分号', () => {
  const sql = "SELECT 1;\nSELECT ';' AS x; -- a;b\nSELECT 3"
  assert.equal(statementAtCursor(sql, 2), 'SELECT 1')
  assert.equal(statementAtCursor(sql, sql.indexOf('AS')), "SELECT ';' AS x")
  assert.match(statementAtCursor(sql, sql.length), /^-- a;b\nSELECT 3$/u)
  assert.equal(statementAtCursor('SELECT 1;   ', 11), 'SELECT 1')
})

test('格式化按方言输出大写关键字', () => {
  assert.match(formatSql('select id from users where id=1', 'mysql'), /^SELECT\n {2}id\nFROM/u)
})

test('解析三种方言的执行计划', () => {
  const pg = parseExplainPlan(
    'postgresql',
    JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'users', 'Plan Rows': 10, 'Total Cost': 4.5 } }])
  )
  assert.equal(pg.target, 'users')
  assert.equal(pg.warning, true)
  assert.equal(maxPlanCost(pg), 4.5)

  const mysql = parseExplainPlan(
    'mysql',
    JSON.stringify({ query_block: { cost_info: { query_cost: '1.2' }, table: { table_name: 't', access_type: 'ALL' } } })
  )
  assert.equal(mysql.target, 't')
  assert.equal(mysql.warning, true)

  const sqlite = parseExplainPlan(
    'sqlite',
    JSON.stringify([
      { id: 2, parent: 0, detail: 'SCAN orders' },
      { id: 5, parent: 2, detail: 'SEARCH users USING INTEGER PRIMARY KEY (rowid=?)' },
    ])
  )
  assert.equal(sqlite.children[0].target, 'orders')
  assert.equal(sqlite.children[0].children[0].warning, false)
})

const column = (name, dataType, nullable = true) => ({
  name,
  dataType,
  nullable,
  defaultValue: null,
  ordinal: 1,
  primaryKey: false,
  autoIncrement: false,
  comment: null,
})
const table = (name, columns, extra = {}) => ({
  schema: 'main',
  name,
  kind: 'table',
  columns,
  indexes: [],
  foreignKeys: [],
  primaryKey: [],
  rowEstimate: null,
  ddl: '',
  options: null,
  ...extra,
})

test('结构对比生成新增 / 修改 / 删除语句', () => {
  const source = [
    table('users', [column('id', 'int', false), column('email', 'varchar(64)')], {
      indexes: [{ name: 'idx_email', columns: ['email'], unique: true, primary: false, subPart: null }],
    }),
    table('orders', [column('id', 'int', false)]),
  ]
  const target = [
    table('users', [column('id', 'int', false), column('email', 'varchar(32)'), column('legacy', 'text')]),
    table('old_logs', [column('id', 'int')]),
  ]
  const kinds = diffSchemas('mysql', source, target, '').map(item => `${item.kind}:${item.name}`)
  assert.deepEqual(kinds.sort(), [
    'add-index:idx_email',
    'add-table:orders',
    'drop-column:legacy',
    'drop-table:old_logs',
    'modify-column:email',
  ])
  const modify = diffSchemas('mysql', source, target, '').find(item => item.kind === 'modify-column')
  assert.equal(modify.sql, 'ALTER TABLE `users` MODIFY COLUMN `email` varchar(64);')
})

test('ER 布局让被引用的表位于左侧', () => {
  const users = table('users', [column('id', 'int')])
  const orders = table('orders', [column('user_id', 'int')], {
    foreignKeys: [{ name: 'fk', columns: ['user_id'], referencedSchema: 'main', referencedTable: 'users', referencedColumns: ['id'], updateRule: '', deleteRule: '' }],
  })
  const { nodes, edges } = layoutErDiagram([orders, users])
  const x = name => nodes.find(node => node.name === name).x
  assert.ok(x('users') < x('orders'))
  assert.deepEqual(edges, [{ from: 'orders', to: 'users', label: 'user_id' }])
})
