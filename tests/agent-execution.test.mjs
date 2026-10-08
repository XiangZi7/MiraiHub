import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope } from 'vue'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { summarizeAgentTurn } = await load('src/utils/agent-execution.ts')
const { useAgentDraft } = await load('src/composables/useAgentDraft.ts')
const operation = (
  status,
  exitCode,
  command = 'systemctl status nginx --no-pager'
) => ({
  role: 'tool',
  text: '执行 Shell 命令',
  operation: {
    id: Math.random().toString(),
    label: '执行 Shell 命令',
    command,
    reason: '检查服务',
    status,
    startedAt: 100,
    durationMs: 250,
    ...(exitCode === undefined ? {} : { exitCode }),
  },
})

test('task results belong only to the latest turn and preserve measured exit code changes', () => {
  const entries = [
    { role: 'user', text: 'old task' },
    operation('failed', 9),
    { role: 'user', text: 'new task' },
    operation('failed', 3),
    operation('completed', 0, 'systemctl restart nginx'),
    operation('completed', 0),
  ]
  const result = summarizeAgentTurn(entries, 'completed')
  assert.equal(result.operations.length, 3)
  assert.equal(result.completed, 2)
  assert.equal(result.failed, 1)
  assert.equal(result.durationMs, 750)
  assert.deepEqual(result.comparisons, [
    { command: 'systemctl status nginx --no-pager', before: 3, after: 0 },
  ])
  assert.equal(result.needsAttention, true)
})

test('unknown exits, errors and stopped turns cannot be presented as verified success', () => {
  const entries = [
    { role: 'user', text: 'test' },
    operation('unknown'),
    { role: 'error', text: 'network lost' },
  ]
  const result = summarizeAgentTurn(entries, 'cancelled')
  assert.equal(result.completed, 0)
  assert.equal(result.unknown, 1)
  assert.equal(result.needsAttention, true)
  assert.equal(result.finished, true)
  assert.equal(summarizeAgentTurn(entries, 'running').finished, false)
  assert.equal(
    summarizeAgentTurn([{ role: 'tool', text: 'old history' }], 'completed')
      .operations.length,
    0
  )
})

test('selected context stays exact, preserves typed prompts and reaches the model only on submit', async () => {
  const sent = []
  const scope = effectScope()
  const draft = scope.run(() =>
    useAgentDraft(async (prompt, attachments) => {
      sent.push({ prompt, attachments })
      return true
    })
  )
  draft.prompt.value = '我自己写的需求'
  const content = '  SELECT * FROM orders;\n'
  assert.equal(
    draft.addContext({
      id: 'sql-one',
      source: 'sql',
      intent: 'optimize',
      content,
    }),
    true
  )
  assert.equal(draft.prompt.value, '我自己写的需求')
  assert.equal(draft.attachments.value[0].content, content)
  assert.equal(draft.attachments.value[0].source, 'context')
  assert.equal(sent.length, 0)
  await draft.submit()
  assert.deepEqual(sent[0], {
    prompt: '我自己写的需求',
    attachments: [{ name: 'SQL selection.sql', content }],
  })
  assert.equal(draft.attachments.value.length, 0)
  scope.stop()
})

test('context count, UTF-8 size and content validation reject invalid selections without changing drafts', () => {
  const scope = effectScope()
  const draft = scope.run(() => useAgentDraft(async () => true))
  const request = {
    id: 'one',
    source: 'terminal',
    intent: 'explain',
    content: '有效选区',
  }
  for (const content of [' ', 'bad\0text', '文'.repeat(21334)]) {
    assert.equal(draft.addContext({ ...request, content }), false)
    assert.equal(draft.attachments.value.length, 0)
  }
  for (let i = 0; i < 4; i++)
    assert.equal(draft.addContext({ ...request, id: String(i) }), true)
  assert.equal(draft.addContext({ ...request, id: 'overflow' }), false)
  assert.equal(draft.attachments.value.length, 4)
  draft.removeFile('0')
  assert.equal(draft.addContext(request), true)
  scope.stop()
})
