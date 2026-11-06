import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const memory = new Map()
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
}
const load = sourceLoader()
const snippets = await load('src/utils/terminal-snippets.ts')
const recording = await load('src/utils/terminal-recording.ts')
const { directoryDifferences } = await load('src/utils/directory-sync.ts')
const prompts = await load('src/api/agent-prompts.ts')

test('snippet variables preserve Unicode names, replace repeated values and reject incomplete or control input', () => {
  const command = 'tail -n {{ 行数 }} {{路径}}; echo {{路径}}'
  assert.deepEqual(snippets.snippetVariables(command), ['行数', '路径'])
  assert.equal(
    snippets.renderSnippet(command, { 行数: '50', 路径: '/var/log/app.log' }),
    'tail -n 50 /var/log/app.log; echo /var/log/app.log'
  )
  assert.throws(() => snippets.renderSnippet(command, { 行数: '50' }))
  assert.throws(() =>
    snippets.renderSnippet(command, { 行数: '50', 路径: '/tmp/a\nrm -rf /' })
  )
})

test('recording keeps split UTF-8, ANSI and resize events and exports standard asciicast v2', () => {
  const terminal = { cols: 100, rows: 30 }
  const output = '\u001b[31m中文\u001b[0m\r\n'
  const bytes = new TextEncoder().encode(output)
  recording.startRecording(terminal)
  recording.recordOutput(terminal, bytes.slice(0, 7))
  recording.recordOutput(terminal, bytes.slice(7))
  recording.recordResize(terminal, 120, 35)
  const cast = recording.stopRecording(terminal)
  assert.equal(
    cast.events
      .filter(event => event[1] === 'o')
      .map(event => event[2])
      .join(''),
    output
  )
  assert.deepEqual(cast.events.at(-1).slice(1), ['r', '120x35'])
  assert.equal(recording.stopRecording(terminal), null)
  assert.deepEqual(recording.parseCast(recording.serializeCast(cast)), {
    width: 100,
    height: 30,
    events: cast.events,
  })
})

test('recording import rejects broken headers, reversed time and invalid event payloads', () => {
  for (const text of [
    '{"version":1,"width":80,"height":24}',
    '{"version":2,"width":0,"height":24}',
    '{"version":2,"width":80,"height":24}\n[2,"o","x"]\n[1,"o","y"]',
    '{"version":2,"width":80,"height":24}\n[0,"o",{}]',
    '{"version":2,"width":80,"height":24}\n[0,"r","-1x24"]',
  ])
    assert.throws(() => recording.parseCast(text))
})

test('directory sync compares metadata in either direction, flags parent type conflicts and never deletes target files', () => {
  const file = (path, size = 10, modifiedAt = 10000) => ({
    path,
    name: path,
    size,
    modifiedAt,
    directory: false,
  })
  const scan = {
    local: [
      file('same'),
      file('new'),
      file('changed', 12),
      file('blocked/child'),
    ],
    remote: [
      file('same', 10, 11000),
      file('changed'),
      file('remote-only'),
      file('blocked'),
    ],
  }
  const upload = directoryDifferences(scan, 'upload')
  assert.deepEqual(
    upload.map(item => [item.path, item.conflict]),
    [
      ['new', false],
      ['changed', false],
      ['blocked/child', true],
    ]
  )
  assert.ok(!upload.some(item => item.path === 'remote-only'))
  assert.ok(
    directoryDifferences(scan, 'download').some(
      item => item.path === 'remote-only'
    )
  )
})

test('prompt templates persist edits and preserve the previous configuration after invalid save', () => {
  const defaults = prompts.listAgentPrompts()
  assert.equal(defaults.length, 4)
  const custom = [{ id: 'one', name: '/巡检', content: '请检查磁盘状态' }]
  prompts.saveAgentPrompts(custom)
  assert.deepEqual(prompts.listAgentPrompts(), custom)
  for (const invalid of [
    [{ ...custom[0], name: 'missing-slash' }],
    [...custom, { ...custom[0], id: 'two' }],
    [{ ...custom[0], content: '' }],
  ])
    assert.throws(() => prompts.saveAgentPrompts(invalid))
  assert.deepEqual(prompts.listAgentPrompts(), custom)
})
