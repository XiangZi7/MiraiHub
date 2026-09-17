import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope } from 'vue'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { i18n } = await load('src/i18n/index.ts')
const {
  readAgentAttachment,
  AGENT_MAX_FILE_BYTES,
  AGENT_MAX_ATTACHMENT_BYTES,
  bytesToSize,
} = await load('src/utils/agent-attachments.ts')
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
    file('abc', '../test'),
  ])
    await assert.rejects(readAgentAttachment(input))
  // ~64 KB is now well within the 1 GB per-file cap.
  const ok = await readAgentAttachment(file('文'.repeat(21334)))
  assert.ok(ok.content.length > 0)
})

test('enforces the 1 GB per-file cap and formats byte sizes', async () => {
  assert.equal(AGENT_MAX_FILE_BYTES, 1_000_000_000)
  assert.equal(AGENT_MAX_ATTACHMENT_BYTES, 1_000_000_000)
  const oversized = {
    name: 'huge.log',
    size: AGENT_MAX_FILE_BYTES + 1,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
  await assert.rejects(readAgentAttachment(oversized))
  assert.equal(bytesToSize(500), '500 B')
  assert.equal(bytesToSize(2048), '2.0 KB')
  assert.equal(bytesToSize(5_000_000), '5.0 MB')
  assert.equal(bytesToSize(1_500_000_000), '1.5 GB')
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
  // 128 KB combined no longer trips the cap (now 1 GB).
  await draft.addFiles([file('c'), file('d')])
  assert.equal(draft.attachments.value.length, 4)
  draft.removeFile(draft.attachments.value[0].id)
  assert.equal(draft.attachments.value.length, 3)
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
  assert.equal(payload.prompt, 'Please analyze the attached files.')
  assert.deepEqual(payload.attachments, [
    { name: 'query.sql', content: 'SELECT 1' },
  ])
  assert.equal(draft.attachments.value.length, 1)
  i18n.global.locale.value = 'zh-CN'
  accept = true
  await draft.submit()
  assert.equal(payload.prompt, '请分析上传的文件。')
  i18n.global.locale.value = 'en-US'
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
