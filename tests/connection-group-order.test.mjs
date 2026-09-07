import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
}
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
}

const load = sourceLoader({
  '@/types/connection': dataModule(`
    export const groupKindOf = kind =>
      kind === 'mysql' || kind === 'postgresql' ? 'database' : 'ssh'
  `),
})
const connections = await load('src/api/connections.ts')
const group = (id, kind, createdAt) => ({ id, name: id, kind, createdAt })

test('group reorder persists independently for SSH and database lists', async () => {
  storage.clear()
  storage.set(
    'miraihub.connection-groups.v1',
    JSON.stringify([
      group('ssh-a', 'ssh', 1),
      group('db-a', 'database', 2),
      group('ssh-b', 'ssh', 3),
      group('db-b', 'database', 4),
    ])
  )

  await connections.reorderGroup('ssh-b', 'ssh-a', 'before')
  assert.deepEqual(
    (await connections.listGroups()).map(item => item.id),
    ['ssh-b', 'ssh-a', 'db-a', 'db-b']
  )

  await connections.reorderGroup('db-a', 'db-b', 'after')
  assert.deepEqual(
    (await connections.listGroups()).map(item => item.id),
    ['ssh-b', 'ssh-a', 'db-b', 'db-a']
  )

  await connections.reorderGroup('ssh-a', 'db-a', 'before')
  assert.deepEqual(
    (await connections.listGroups()).map(item => item.id),
    ['ssh-b', 'ssh-a', 'db-b', 'db-a']
  )
})
