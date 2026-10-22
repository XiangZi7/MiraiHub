import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const { readOfficeText, officeTextFromWorker } = await sourceLoader()(
  'src/utils/agent-office-worker.ts'
)

function workerFixture() {
  return {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminated: 0,
    received: null,
    postMessage(value) {
      this.received = value
    },
    terminate() {
      this.terminated++
    },
  }
}

test('Office worker receives the File without reading it on the caller and retains all returned text', async () => {
  const worker = workerFixture()
  const file = {
    name: 'large.xlsx',
    arrayBuffer() {
      throw new Error('UI thread must not read this file')
    },
  }
  const pending = officeTextFromWorker(worker, file)
  assert.equal(worker.received, file)
  const text = 'full cell text'.repeat(1000)
  worker.onmessage({ data: { ok: true, text } })
  assert.equal(await pending, text)
  assert.equal(worker.terminated, 1)
  assert.equal(worker.onmessage, null)
})

test('Office worker cancellation terminates parsing and rejects without an attachment', async () => {
  const worker = workerFixture()
  const controller = new AbortController()
  const pending = officeTextFromWorker(
    worker,
    new File(['data'], 'test.xlsx'),
    controller.signal
  )
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(worker.terminated, 1)
  assert.equal(worker.onmessage, null)
  const neverStarted = workerFixture()
  await assert.rejects(
    officeTextFromWorker(
      neverStarted,
      new File(['data'], 'test.xlsx'),
      controller.signal
    ),
    { name: 'AbortError' }
  )
  assert.equal(neverStarted.received, null)
  assert.equal(neverStarted.terminated, 1)
})

test('Office worker reports parser and transport errors and always releases its worker', async () => {
  for (const failure of ['parser', 'worker', 'transport', 'post']) {
    const worker = workerFixture()
    if (failure === 'post')
      worker.postMessage = () => {
        throw new Error('post failed')
      }
    const pending = officeTextFromWorker(
      worker,
      new File(['data'], 'test.xlsx')
    )
    if (failure === 'parser')
      worker.onmessage({
        data: { ok: false, error: 'Office entry exceeds 128 MB' },
      })
    if (failure === 'worker') worker.onerror({ preventDefault() {} })
    if (failure === 'transport') worker.onmessageerror({})
    await assert.rejects(pending, failure === 'parser' ? /128 MB/ : undefined)
    assert.equal(worker.terminated, 1)
  }
})

test('non-browser Office extraction shares the parser and honors cancellation', async () => {
  const text = '完整文件'.repeat(1000)
  const file = new File(
    [`<html><table><tr><td>${text}</td></tr></table></html>`],
    'legacy.xls'
  )
  assert.ok((await readOfficeText(file)).includes(text))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readOfficeText(file, controller.signal), {
    name: 'AbortError',
  })
})

test('oversized Office files are rejected before reading or creating a worker', async () => {
  const originalWorker = globalThis.Worker
  let constructed = false
  let read = false
  globalThis.Worker = class {
    constructor() {
      constructed = true
    }
  }
  try {
    await assert.rejects(
      readOfficeText({
        name: 'oversized.xlsx',
        size: 128 * 1024 * 1024 + 1,
        async arrayBuffer() {
          read = true
          return new ArrayBuffer(0)
        },
      }),
      /Office 源文件超过 128 MiB/
    )
    assert.equal(constructed, false)
    assert.equal(read, false)
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker
    else globalThis.Worker = originalWorker
  }
})
