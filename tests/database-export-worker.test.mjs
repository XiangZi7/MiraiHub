import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { sourceLoader } from './helpers/source-module.mjs'
const replies = []
globalThis.self = { postMessage: value => replies.push(value) }
await sourceLoader()('src/services/database-export.worker.ts')
const { exportDataText, databaseExportFileName } = await sourceLoader()(
  'src/utils/database-export.ts'
)
let sequence = 0
async function send(action, payload = {}) {
  await self.onmessage({ data: { id: ++sequence, action, ...payload } })
  const reply = replies.pop()
  if (reply.error) throw new Error(reply.error)
  return reply.bytes
}
const source = {
  name: 'users',
  schema: 'demo',
  databaseKind: 'mysql',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'message\r\n"x"', dataType: 'TEXT' },
  ],
  rows: [],
}
const rows = [
  ['9007199254740993', '中文, "引号"\n换行'],
  ['001', '=1+1'],
  ['2', null],
]

test('file names use local date and optional database/time parts and clean invalid characters', () => {
  const now = new Date(2026, 9, 30, 9, 8, 7)
  assert.equal(
    databaseExportFileName(
      'users',
      'xlsx',
      { database: 'demo', date: true, time: true },
      now
    ),
    'demo_users_2026-10-30_090807.xlsx'
  )
  assert.equal(databaseExportFileName('a/b:c', 'csv', {}, now), 'a_b_c.csv')
})
for (const format of ['csv', 'txt', 'json', 'sql'])
  test(`worker ${format} keeps page boundaries and only emits each header once`, async () => {
    const parts = [await send('start', { source, format, tableName: 'users' })]
    parts.push(await send('rows', { rows: rows.slice(0, 1) }))
    parts.push(await send('rows', { rows: [] }))
    parts.push(await send('rows', { rows: rows.slice(1) }))
    parts.push(await send('finish'))
    const text = new TextDecoder().decode(Buffer.concat(parts))
    const expected = exportDataText({ ...source, rows }, format)
    if (format === 'json')
      assert.deepEqual(JSON.parse(text), JSON.parse(expected))
    else if (format === 'sql')
      assert.equal(
        text.slice(text.indexOf('\n') + 1),
        exportDataText({ ...source, rows }, format, 'users', false)
      )
    else assert.equal(text, expected)
  })

test('Excel worker creates a real workbook off the UI thread and rejects unsafe capacity', async () => {
  await send('start', { source, format: 'xlsx', tableName: 'users' })
  await send('rows', { rows })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await send('finish'))
  assert.equal(
    workbook.getWorksheet('users').getCell('A2').value,
    '9007199254740993'
  )
  assert.equal(workbook.getWorksheet('users').getCell('B3').value, '=1+1')
  await send('start', {
    source: {
      ...source,
      columns: Array.from({ length: 1000 }, (_, index) => ({
        name: String(index),
        dataType: 'TEXT',
      })),
    },
    format: 'xlsx',
  })
  await assert.rejects(
    send('rows', { rows: Array.from({ length: 200 }, () => []) }),
    /安全容量/
  )
})
