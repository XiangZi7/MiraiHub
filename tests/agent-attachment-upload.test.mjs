import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope } from 'vue'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

const load = sourceLoader()
const { readAgentAttachment } = await load('src/utils/agent-attachments.ts')
const { textChunks } = await load('src/utils/agent-attachment-upload.ts')

function uploader(overrides = {}) {
  const chunks = []
  const discarded = []
  const calls = {
    begin: async name => {
      calls.name = name
      return 'test-id'
    },
    append: async (id, index, content) => {
      assert.equal(id, 'test-id')
      assert.equal(index, chunks.length)
      assert.ok(Buffer.byteLength(content) <= 256 * 1024)
      chunks.push(content)
    },
    finish: async id => ({
      id,
      name: calls.name,
      size: Buffer.byteLength(chunks.join('')),
      preview: chunks.join('').slice(0, 80),
    }),
    discard: async id => {
      discarded.push(id)
    },
    ...overrides,
  }
  return { calls, chunks, discarded }
}

test('native upload streams UTF-8 across boundaries and sends a reference without embedding the whole file', async () => {
  const content = 'a'.repeat(127999) + '中文🙂'.repeat(50000) + '\nlast line'
  const input = new File([content], 'large.log')
  input.arrayBuffer = () => {
    throw new Error('Must not read the whole file')
  }
  const storage = uploader()
  const progress = []
  const result = await readAgentAttachment(input, {
    uploader: storage.calls,
    onProgress: (done, total) => progress.push([done, total]),
  })
  assert.equal(storage.chunks.join(''), content)
  assert.ok(storage.chunks.length > 3)
  assert.equal(result.attachmentId, 'test-id')
  assert.equal(result.size, Buffer.byteLength(content))
  assert.ok(result.content.length < 100)
  assert.deepEqual(progress.at(-1), [input.size, input.size])
  assert.ok(
    progress.every(
      (value, index) => index === 0 || value[0] > progress[index - 1][0]
    )
  )
  assert.deepEqual(storage.discarded, [])
})

test('cancel, invalid UTF-8, binary input and append failure discard only the staged upload', async () => {
  for (const kind of ['cancel', 'utf8', 'binary', 'append']) {
    const controller = new AbortController()
    const storage = uploader()
    const originalAppend = storage.calls.append
    storage.calls.append = async (...args) => {
      await originalAppend(...args)
      if (kind === 'cancel') controller.abort()
      if (kind === 'append') throw new Error('disk full')
    }
    const input = new File(
      [
        kind === 'utf8'
          ? new Uint8Array([255])
          : kind === 'binary'
            ? 'a\0b'
            : 'a'.repeat(300000),
      ],
      'test.log'
    )
    await assert.rejects(
      readAgentAttachment(input, {
        uploader: storage.calls,
        signal: controller.signal,
      })
    )
    assert.deepEqual(storage.discarded, ['test-id'])
  }
})

test('Office text chunks never split a surrogate pair or drop characters', async () => {
  const content = 'a'.repeat(31999) + '🙂'.repeat(20000) + '终'
  const parts = []
  for await (const part of textChunks(content)) parts.push(part)
  assert.equal(parts.join(''), content)
  for (const part of parts)
    assert.equal(
      new TextDecoder('utf-8', { fatal: true }).decode(
        new TextEncoder().encode(part)
      ),
      part
    )
})

test('draft preserves file references on failed sends and releases removed/cancelled drafts', async () => {
  const discarded = []
  globalThis.__agentUploadTest = { discarded }
  const custom = sourceLoader({
    '@/api/agent': dataModule(
      'export async function discardAttachment(id) { globalThis.__agentUploadTest.discarded.push(id) }'
    ),
    '@/utils/agent-attachments': dataModule(`
      export const AGENT_MAX_FILES=16,AGENT_MAX_IMAGES=4,AGENT_MAX_PROMPT_BYTES=256000,AGENT_MAX_ATTACHMENT_BYTES=1000000000
      export const bytesToSize = value => value + ' B'
      export async function readAgentAttachment(file, options) {
        options.onProgress?.(file.size, file.size)
        if(file.name === 'slow.txt') await new Promise(resolve => { globalThis.__agentUploadTest.finish=resolve })
        return {id:file.name,attachmentId:file.name,name:file.name,content:'preview',size:file.size}
      }
    `),
  })
  const { useAgentDraft } = await custom('src/composables/useAgentDraft.ts')
  let accepted = false
  let payload
  const scope = effectScope()
  const draft = scope.run(() =>
    useAgentDraft(async (prompt, attachments) => {
      payload = attachments
      return accepted
    })
  )
  try {
    await draft.addFiles([new File(['first'], 'first.txt')])
    await draft.submit()
    assert.equal(payload[0].attachmentId, 'first.txt')
    assert.equal(draft.attachments.value.length, 1)
    assert.deepEqual(discarded, [])
    draft.removeFile('first.txt')
    assert.deepEqual(discarded, ['first.txt'])
    const pending = draft.addFiles([new File(['second'], 'slow.txt')])
    assert.ok(draft.readingProgress.value.includes('slow.txt'))
    draft.cancelReading()
    globalThis.__agentUploadTest.finish()
    await pending
    assert.equal(draft.attachments.value.length, 0)
    assert.deepEqual(discarded, ['first.txt', 'slow.txt'])
    await draft.addFiles([new File(['third'], 'third.txt')])
    accepted = true
    await draft.submit()
    assert.equal(draft.attachments.value.length, 0)
    assert.deepEqual(discarded, ['first.txt', 'slow.txt'])
  } finally {
    scope.stop()
    delete globalThis.__agentUploadTest
  }
})

test('draft allows sixteen text files while retaining four-image and 256KB message boundaries', async () => {
  const { useAgentDraft } = await load('src/composables/useAgentDraft.ts')
  let sent = false
  const scope = effectScope()
  const draft = scope.run(() =>
    useAgentDraft(async () => {
      sent = true
      return true
    })
  )
  try {
    await draft.addFiles(
      Array.from(
        { length: 16 },
        (_, index) => new File(['text'], `${index}.txt`)
      )
    )
    assert.equal(draft.attachments.value.length, 16)
    draft.reset()
    await draft.addFiles(
      Array.from(
        { length: 5 },
        () => new File(['image'], 'test.png', { type: 'image/png' })
      )
    )
    assert.equal(draft.attachments.value.length, 0)
    assert.ok(draft.attachmentError.value)
    draft.prompt.value = '文'.repeat(86000)
    await draft.submit()
    assert.equal(sent, false)
    assert.ok(draft.attachmentError.value)
    draft.prompt.value = 'a'.repeat(30000)
    await draft.submit()
    assert.equal(sent, true)
  } finally {
    scope.stop()
  }
})
