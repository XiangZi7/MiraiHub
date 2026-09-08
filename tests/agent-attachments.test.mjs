import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope } from 'vue'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { readAgentAttachment } = await load('src/utils/agent-attachments.ts')
const { useAgentDraft } = await load('src/composables/useAgentDraft.ts')
const file = (content, name = 'server.log') => new File([content], name)

test('reads UTF-8 attachments without truncation and rejects empty, binary and oversized files', async () => {
  const result = await readAgentAttachment(
    file('服务器\nerror: connection refused')
  )
  assert.equal(result.content, '服务器\nerror: connection refused')
  assert.equal(result.size, Buffer.byteLength(result.content))
  for (const input of [
    file(''),
    file(' \n'),
    file('a\0b'),
    file(new Uint8Array([255, 254, 128])),
    file('文'.repeat(21334)),
    file('abc', '../test'),
  ])
    await assert.rejects(readAgentAttachment(input))
})

test('attachment batches are atomic and enforce count and combined size', async () => {
  const scope = effectScope()
  const draft = scope.run(() => useAgentDraft(async () => true))
  await draft.addFiles([file('original')])
  await draft.addFiles([file('good'), file('bad\0')])
  assert.equal(draft.attachments.value.length, 1)
  assert.ok(draft.attachmentError.value)
  await draft.addFiles(Array.from({ length: 4 }, () => file('a')))
  assert.match(draft.attachmentError.value, /4/)
  draft.reset()
  await draft.addFiles([file('a'.repeat(64000)), file('b'.repeat(64000))])
  assert.equal(draft.attachments.value.length, 2)
  await draft.addFiles([file('c')])
  assert.match(draft.attachmentError.value, /128 KB/)
  draft.removeFile(draft.attachments.value[0].id)
  assert.equal(draft.attachments.value.length, 1)
  scope.stop()
})

test('late file reads cannot repopulate a new conversation or an unmounted draft', async () => {
  const scope = effectScope()
  const draft = scope.run(() => useAgentDraft(async () => true))
  let finish
  const pending = draft.addFiles([
    {
      name: 'slow.txt',
      size: 3,
      arrayBuffer: () =>
        new Promise(resolve => {
          finish = resolve
        }),
    },
  ])
  draft.reset()
  finish(new TextEncoder().encode('old').buffer)
  await pending
  assert.equal(draft.attachments.value.length, 0)
  assert.equal(draft.reading.value, false)
  scope.stop()
})

test('file-only sending works, rejected sends restore drafts, and late rejections cannot overwrite new work', async () => {
  const scope = effectScope()
  let accept = false
  let payload
  let finish
  const draft = scope.run(() =>
    useAgentDraft(async (prompt, attachments) => {
      payload = { prompt, attachments }
      return accept === null
        ? new Promise(resolve => {
            finish = resolve
          })
        : accept
    })
  )
  await draft.addFiles([file('SELECT 1', 'query.sql')])
  await draft.submit()
  assert.equal(payload.prompt, '')
  assert.deepEqual(payload.attachments, [
    { name: 'query.sql', content: 'SELECT 1' },
  ])
  assert.equal(draft.attachments.value.length, 1)
  accept = true
  await draft.submit()
  assert.equal(draft.attachments.value.length, 0)
  accept = null
  draft.prompt.value = 'old'
  const pending = draft.submit()
  draft.reset()
  draft.prompt.value = 'new'
  finish(false)
  await pending
  assert.equal(draft.prompt.value, 'new')
  scope.stop()
})
