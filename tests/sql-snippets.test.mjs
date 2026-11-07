import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { expandSnippet, snippetOrder, matchSnippets, BUILTIN_SQL_SNIPPETS } =
  await load('src/utils/sql-snippets.ts')
const { scanSqlParams, bindSqlParams } = await load('src/utils/sql-params.ts')

test('expands placeholders with mirrors, indentation and literal dollar', () => {
  const { text, stops } = expandSnippet('A ${1:x}\nB $1 \\$ $0', '  ')
  assert.equal(text, 'A x\n  B  $ ')
  assert.deepEqual(snippetOrder(stops), [1, 0])
  assert.equal(stops.length, 3)
})

test('matches triggers by case-insensitive prefix', () => {
  assert.ok(
    matchSnippets(BUILTIN_SQL_SNIPPETS, 'SEL').some(s => s.prefix === 'sel')
  )
  assert.deepEqual(matchSnippets(BUILTIN_SQL_SNIPPETS, ''), [])
})

test('binds named, positional and numbered params per dialect', () => {
  const pg = 'SELECT $2, :a, $2'
  assert.deepEqual(
    bindSqlParams(pg, 'postgresql', scanSqlParams(pg, 'postgresql'), {
      $2: 'x',
      a: 'y',
    }),
    { sql: 'SELECT $1, $2, $1', params: ['x', 'y'] }
  )
  const lite = "SELECT ?2, ?1, ?2, ':no'"
  assert.deepEqual(
    bindSqlParams(lite, 'sqlite', scanSqlParams(lite, 'sqlite'), {
      '?1': 'a',
      '?2': 'b',
    }),
    { sql: "SELECT ?, ?, ?, ':no'", params: ['b', 'a', 'b'] }
  )
})

test('resolves alias columns and infers FROM tables', async () => {
  const { parseSql, completeSql } = await load('src/utils/sql-completion.ts')
  const tables = { orders: ['order_no', 'total'], users: ['name'] }
  const run = source => {
    const cursor = source.indexOf('|')
    const sql = source.replace('|', '')
    return completeSql(parseSql(sql), cursor, [], true, tables).options.map(
      item => item.label
    )
  }
  assert.deepEqual(run('SELECT o.| FROM orders o'), ['order_no', 'total'])
  assert.deepEqual(run('SELECT * FROM orders AS o JOIN users u ON u.|'), [
    'name',
  ])
  assert.equal(run('SELECT to| FROM orders')[0], 'total')
})
