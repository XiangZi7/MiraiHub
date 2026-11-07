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
const { workbookFromWorker } = await sourceLoader()(
  'src/utils/database-xlsx-worker.ts'
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

/** 模拟浏览器 Worker：结构化克隆并转移缓冲区后交给真实 Worker 处理器。 */
function routedWorker() {
  return {
    onmessage: null,
    onerror: null,
    terminated: 0,
    transfer: null,
    postMessage(message, transfer) {
      this.transfer = transfer
      const cloned = structuredClone(message, { transfer })
      const previous = self.postMessage
      self.postMessage = data => {
        self.postMessage = previous
        queueMicrotask(() => this.onmessage?.({ data }))
      }
      void self.onmessage({ data: cloned })
    },
    terminate() {
      this.terminated++
    },
  }
}

test('main-thread workbook requests transfer bytes to the shared worker and return parsed sources and templates', async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('users').addRow(['id', 'name'])
  workbook.getWorksheet('users').addRow(['1', '中文'])
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
  const worker = routedWorker()
  const { sources } = await workbookFromWorker(
    worker,
    { action: 'parse', bytes },
    [bytes.buffer]
  )
  assert.equal(bytes.byteLength, 0)
  assert.equal(worker.transfer.length, 1)
  assert.deepEqual(sources[0].rows, [['1', '中文']])
  assert.equal(worker.terminated, 1)
  const template = await workbookFromWorker(routedWorker(), {
    action: 'template',
    targets: [
      {
        schema: 'demo',
        name: 'users',
        columns: [
          {
            name: 'id',
            dataType: 'INT',
            nullable: false,
            defaultValue: null,
            autoIncrement: true,
          },
        ],
      },
    ],
  })
  const loaded = new ExcelJS.Workbook()
  await loaded.xlsx.load(template.bytes)
  assert.equal(loaded.getWorksheet('users').getCell('A1').value, 'id')
  const exported = await workbookFromWorker(routedWorker(), {
    action: 'workbook',
    data: { name: 'users', columns: source.columns, rows },
  })
  await loaded.xlsx.load(exported.bytes)
  assert.equal(
    loaded.getWorksheet('users').getCell('A2').value,
    '9007199254740993'
  )
})

test('workbook worker errors keep their original message and cancellation releases the worker', async () => {
  const worker = routedWorker()
  await assert.rejects(
    workbookFromWorker(worker, {
      action: 'parse',
      bytes: new Uint8Array(16 * 1024 * 1024 + 1),
    }),
    { message: 'Excel 文件超过 16 MB，请拆分后导入' }
  )
  assert.equal(worker.terminated, 1)
  const controller = new AbortController()
  controller.abort()
  const cancelled = routedWorker()
  await assert.rejects(
    workbookFromWorker(
      cancelled,
      { action: 'parse', bytes: new Uint8Array() },
      [],
      controller.signal
    ),
    { name: 'AbortError' }
  )
  assert.equal(cancelled.transfer, null)
  assert.equal(cancelled.terminated, 1)
})
