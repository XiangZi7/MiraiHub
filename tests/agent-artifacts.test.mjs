import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'
const load = sourceLoader()
const {
  configurationDiff,
  chartNumber,
  numericColumns,
  chartGeometry,
  queryCsv,
} = await load('src/utils/agent-artifacts.ts')
const { summarizeAgentTurn } = await load('src/utils/agent-execution.ts')
test('diff reconstructs both complete originals including Unicode, empty and trailing lines', () => {
  for (const [before, after] of [
    ['a\nold\nz\n', 'a\n新内容\nz\n'],
    ['', 'hello'],
    ['x\n', 'x'],
    ['a\n'.repeat(700), 'b\n'.repeat(700)],
  ]) {
    const diff = configurationDiff(before, after)
    assert.equal(
      diff
        .filter(line => line.kind !== 'add')
        .map(line => line.text)
        .join('\n'),
      before
    )
    assert.equal(
      diff
        .filter(line => line.kind !== 'remove')
        .map(line => line.text)
        .join('\n'),
      after
    )
  }
})
test('charts retain actual numbers, NULL gaps, negative bars and result order', () => {
  for (const input of [
    null,
    '',
    ' ',
    '1,200',
    'Infinity',
    'NaN',
    '9007199254740993',
    '<script>',
  ])
    assert.equal(chartNumber(input), null)
  assert.equal(chartNumber('-2.5'), -2.5)
  const result = {
    columns: ['day', 'orders', 'id'],
    rows: [
      ['Tue', '10', 'first'],
      ['Mon', null, 'second'],
      ['Fri', '-5', 'third'],
    ],
  }
  assert.deepEqual(numericColumns(result), [1])
  const chart = chartGeometry(result, 0, 1)
  assert.deepEqual(
    chart.points.map(point => point.label),
    ['Tue', 'Mon', 'Fri']
  )
  assert.equal(chart.points[1].y, null)
  assert.equal((chart.path.match(/M/g) || []).length, 2)
  assert.ok(chart.baseline >= 34 && chart.baseline <= 178)
  assert.equal(chart.min, -5)
  assert.equal(chart.max, 10)
})
test('CSV preserves quoting and NULL and metric comparisons only use identical commands in this turn', () => {
  assert.equal(
    queryCsv({
      columns: ['name', 'value'],
      rows: [
        ['a"b', 'line\nnext'],
        [null, '0'],
      ],
    }),
    '"name","value"\r\n"a""b","line\nnext"\r\n,"0"'
  )
  const record = (command, value) => ({
    role: 'tool',
    text: 'test',
    operation: {
      command,
      status: 'completed',
      metrics: [{ name: '查询耗时', value, unit: 'ms' }],
    },
  })
  const result = summarizeAgentTurn(
    [
      { role: 'user', text: 'old' },
      record('SELECT x', '999'),
      { role: 'user', text: 'new' },
      record('SELECT x', '32'),
      record('SELECT y', '1'),
      record('SELECT x', '12'),
    ],
    'completed'
  )
  assert.deepEqual(result.metricComparisons, [
    {
      command: 'SELECT x',
      name: '查询耗时',
      before: '32',
      after: '12',
      unit: 'ms',
    },
  ])
})
