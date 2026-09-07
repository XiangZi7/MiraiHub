import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const memory = new Map()
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
}
globalThis.window = new EventTarget()
const load = sourceLoader()
const api = await load('src/api/terminal-commands.ts')
const key = 'miraihub.terminal-commands.v1'

test('custom commands keep their order through add, move, edit and reload', () => {
  memory.clear()
  assert.equal(api.list().length, 10)
  api.save('查看容器', 'docker ps')
  const added = api.list().at(-1)
  api.move(added.id, -1)
  assert.equal(api.list().at(-2).id, added.id)
  api.save('容器详情', 'docker ps -a', added.id)
  assert.equal(api.list().at(-2).command, 'docker ps -a')
  assert.equal(JSON.parse(memory.get(key)).at(-2).id, added.id)
  api.move(added.id, 1)
  assert.equal(api.list().at(-1).id, added.id)
  api.remove(added.id)
  assert.equal(api.list().length, 10)
})

test('removing all defaults stays empty; stale edits and invalid commands cannot overwrite storage', () => {
  memory.clear()
  for (const item of api.list()) api.remove(item.id)
  assert.deepEqual(api.list(), [])
  assert.throws(() => api.save('名称', 'pwd', 'removed-command'), /已被删除/)
  for (const command of ['pwd\nwhoami', 'pwd\rwhoami', 'pwd\x1b[A', '']) {
    assert.throws(() => api.save('名称', command), /单行命令/)
  }
  assert.equal(memory.get(key), '[]')
  api.move('missing', -1)
  assert.equal(memory.get(key), '[]')
})

test('malformed storage does not get overwritten; mutations notify other terminal menus', () => {
  memory.set(key, 'bad-json')
  assert.throws(() => api.save('名称', 'pwd'))
  assert.equal(memory.get(key), 'bad-json')
  memory.clear()
  let notifications = 0
  const unsubscribe = api.subscribe(() => notifications++)
  api.save('路径', 'pwd')
  const first = api.list()[0]
  api.move(first.id, 1)
  api.remove(first.id)
  assert.equal(notifications, 3)
  unsubscribe()
  api.save('负载', 'uptime')
  assert.equal(notifications, 3)
})
