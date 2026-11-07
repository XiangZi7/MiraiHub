import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const {
  cleanInlineCompletion,
  diffSqlLines,
  extractSqlBlock,
  parseChartSpec,
  sqlDangerReason,
  stripChartBlock,
} = await load('src/utils/sql-ai.ts')

test('extracts sql from fenced and bare replies', () => {
  assert.equal(extractSqlBlock('x\n```sql\nSELECT 1\n```\ny'), 'SELECT 1')
  assert.equal(extractSqlBlock('SELECT 2'), 'SELECT 2')
})

test('diffs lines keeping shared lines', () => {
  assert.deepEqual(
    diffSqlLines('a\nb', 'a\nc').map(line => line.kind + line.text),
    ['samea', 'removeb', 'addc']
  )
})

test('flags dangerous statements but ignores strings and comments', () => {
  assert.equal(sqlDangerReason('SELECT 1; DROP TABLE t'), 'DROP')
  assert.equal(sqlDangerReason('DELETE FROM t'), 'DELETE (no WHERE)')
  assert.equal(sqlDangerReason('DELETE FROM t WHERE id = 1'), '')
  assert.equal(sqlDangerReason("SELECT 'DROP TABLE t' -- DROP"), '')
})

test('parses chart specs only with existing columns', () => {
  const text = '```chart\n{"type":"bar","x":"a","y":["b","nope"]}\n```'
  assert.deepEqual(parseChartSpec(text, ['a', 'b']).y, ['b'])
  assert.equal(parseChartSpec(text, ['b']), null)
  assert.equal(stripChartBlock('hi\n```chart\n{"t'), 'hi')
})

test('removes repeated line prefix from inline completion', () => {
  assert.equal(cleanInlineCompletion('SELECT id', 'SELECT '), 'id')
})
