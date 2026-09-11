import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, disposePinia } from 'pinia'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
}
globalThis.window = new EventTarget()

const pointerEvents = dataModule(`
  export const listeners = new Map()
  export const useEventListener = (_target, event, handler) => {
    listeners.set(event, handler)
    return () => listeners.delete(event)
  }
`)

const load = sourceLoader({
  '@/types/connection': dataModule(`
    export const groupKindOf = kind =>
      kind === 'mysql' || kind === 'postgresql' ? 'database' : 'ssh'
  `),
  '@/composables/useSettings': dataModule(`
    export const settingsSnapshot = () => ({ saveSessionHistory: true })
  `),
  '@vueuse/core': pointerEvents,
})
const connections = await load('src/api/connections.ts')
const { useConnectionsStore } = await load('src/stores/connections.ts')
const { useConnectionGroupReorder } = await load(
  'src/composables/useConnectionGroupReorder.ts'
)
const group = (id, kind, createdAt) => ({ id, name: id, kind, createdAt })
const ids = (store, kind = 'ssh') =>
  store.groupsFor(kind).map(group => group.id)

async function openStore(t) {
  const pinia = createPinia()
  t.after(() => disposePinia(pinia))
  const store = useConnectionsStore(pinia)
  await store.initialize()
  return store
}

async function fixture(t) {
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
  storage.set(
    'miraihub.connections.v1',
    JSON.stringify(
      ['ssh', 'local', 'mysql', 'postgresql'].map(kind => ({
        id: kind,
        name: kind,
        kind,
        group: '',
        tags: [],
        createdAt: 1,
        settings: {},
      }))
    )
  )
  return openStore(t)
}

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

test('Ungrouped moves to the first, middle and last position and survives reloading', async t => {
  const store = await fixture(t)
  assert.deepEqual(ids(store), ['ssh-a', 'ssh-b', 'ungrouped-ssh'])
  assert.deepEqual(
    store
      .groupsFor('ssh')
      .at(-1)
      .items.map(item => item.id),
    ['ssh', 'local']
  )

  for (const [target, position, expected] of [
    ['ssh-a', 'before', ['ungrouped-ssh', 'ssh-a', 'ssh-b']],
    ['ssh-b', 'before', ['ssh-a', 'ungrouped-ssh', 'ssh-b']],
    ['ssh-b', 'after', ['ssh-a', 'ssh-b', 'ungrouped-ssh']],
  ]) {
    await store.reorderGroup('ungrouped-ssh', target, position)
    assert.deepEqual(ids(store), expected)
    assert.deepEqual(ids(await openStore(t)), expected)
    assert.deepEqual(ids(store, 'database'), [
      'db-a',
      'db-b',
      'ungrouped-database',
    ])
  }
  assert.equal(
    (await connections.listGroups()).some(group =>
      group.id.startsWith('ungrouped-')
    ),
    false
  )
})

test('named groups can move before or after Ungrouped without crossing connection kinds', async t => {
  const store = await fixture(t)
  await store.reorderGroup('ssh-b', 'ungrouped-ssh', 'after')
  assert.deepEqual(ids(store), ['ssh-a', 'ungrouped-ssh', 'ssh-b'])
  await store.reorderGroup('ssh-a', 'ungrouped-ssh', 'after')
  assert.deepEqual(ids(store), ['ungrouped-ssh', 'ssh-a', 'ssh-b'])
  await store.reorderGroup('ssh-b', 'ungrouped-ssh', 'before')
  assert.deepEqual(ids(store), ['ssh-b', 'ungrouped-ssh', 'ssh-a'])

  await store.reorderGroup('ungrouped-database', 'db-a', 'before')
  assert.deepEqual(ids(store, 'database'), [
    'ungrouped-database',
    'db-a',
    'db-b',
  ])
  for (const [source, target] of [
    ['ungrouped-ssh', 'db-a'],
    ['db-a', 'ungrouped-ssh'],
    ['ungrouped-ssh', 'ungrouped-database'],
    ['missing', 'ssh-a'],
    ['ssh-a', 'missing'],
    ['ssh-a', 'ssh-a'],
  ])
    await store.reorderGroup(source, target, 'before')

  const restored = await openStore(t)
  assert.deepEqual(ids(restored), ['ssh-b', 'ungrouped-ssh', 'ssh-a'])
  assert.deepEqual(ids(restored, 'database'), [
    'ungrouped-database',
    'db-a',
    'db-b',
  ])
})

test('Ungrouped retains its place when emptied, restored or a preceding group is removed', async t => {
  const store = await fixture(t)
  await store.reorderGroup('ungrouped-ssh', 'ssh-b', 'before')
  await store.update('ssh', { group: 'ssh-a' })
  await store.update('local', { group: 'ssh-a' })
  assert.deepEqual(ids(store), ['ssh-a', 'ssh-b'])
  await store.update('local', { group: '' })
  assert.deepEqual(ids(store), ['ssh-a', 'ungrouped-ssh', 'ssh-b'])

  await store.removeGroup('ssh-a')
  assert.deepEqual(ids(store), ['ungrouped-ssh', 'ssh-b'])
  assert.deepEqual(ids(await openStore(t)), ['ungrouped-ssh', 'ssh-b'])
  assert.deepEqual(
    store.groupsFor('ssh')[0].items.map(item => item.id),
    ['ssh', 'local']
  )
  await store.renameGroup('ungrouped-ssh', 'Renamed')
  await store.removeGroup('ungrouped-ssh')
  assert.equal(store.groupsFor('ssh')[0].name, 'Ungrouped')
})

test('a named Ungrouped group remains separate from connections with no group', async t => {
  const store = await fixture(t)
  await store.createGroup('ssh', 'Ungrouped')
  await store.update('ssh', { group: 'Ungrouped' })
  const views = store.groupsFor('ssh')
  assert.deepEqual(
    views
      .find(group => group.name === 'Ungrouped' && !group.virtual)
      .items.map(item => item.id),
    ['ssh']
  )
  assert.deepEqual(
    views
      .find(group => group.id === 'ungrouped-ssh')
      .items.map(item => item.id),
    ['local']
  )
})

test('invalid saved positions fall back to the default and large positions stay within the list', async t => {
  const store = await fixture(t)
  for (const value of [
    null,
    [],
    { ssh: -1, database: 'first' },
    { ssh: 0.5 },
  ]) {
    storage.set('miraihub.ungrouped-positions.v1', JSON.stringify(value))
    await store.refresh()
    assert.deepEqual(ids(store), ['ssh-a', 'ssh-b', 'ungrouped-ssh'])
  }
  storage.set('miraihub.ungrouped-positions.v1', JSON.stringify({ ssh: 100 }))
  await store.refresh()
  assert.deepEqual(ids(store), ['ssh-a', 'ssh-b', 'ungrouped-ssh'])
  await store.reorderGroup('ssh-a', 'ungrouped-ssh', 'after')
  assert.deepEqual(ids(store), ['ssh-b', 'ungrouped-ssh', 'ssh-a'])
})

test('a failed reorder restores the previous position and storage events refresh other stores', async t => {
  const store = await fixture(t)
  await store.reorderGroup('ungrouped-ssh', 'ssh-b', 'before')
  const before = new Map(storage)
  const originalSetItem = localStorage.setItem
  localStorage.setItem = (key, value) => {
    if (key === 'miraihub.connection-groups.v1') throw new Error('storage full')
    originalSetItem(key, value)
  }
  try {
    await assert.rejects(
      connections.reorderGroup('ungrouped-ssh', 'ssh-a', 'before'),
      /storage full/
    )
    assert.deepEqual(storage, before)
  } finally {
    localStorage.setItem = originalSetItem
  }

  storage.set('miraihub.ungrouped-positions.v1', JSON.stringify({ ssh: 0 }))
  const event = new Event('storage')
  Object.defineProperty(event, 'key', {
    value: 'miraihub.ungrouped-positions.v1',
  })
  window.dispatchEvent(event)
  await store.initialize()
  assert.deepEqual(ids(store), ['ungrouped-ssh', 'ssh-a', 'ssh-b'])
})

test('pointer dragging accepts Ungrouped as both source and target without toggling on drop', async () => {
  const { listeners } = await import(pointerEvents)
  const groups = [
    group('ssh-a', 'ssh', 1),
    group('ssh-b', 'ssh', 2),
    { ...group('ungrouped-ssh', 'ssh', 0), virtual: true },
  ]
  const container = {
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 100 }),
    querySelectorAll: () =>
      groups.map((group, index) => ({
        dataset: {
          reorderableConnectionGroupId: group.id,
          connectionGroupKind: group.kind,
        },
        getBoundingClientRect: () => ({ top: index * 35, height: 28 }),
      })),
  }
  const drops = []
  const drag = useConnectionGroupReorder({
    container: () => container,
    onReorder: (...args) => drops.push(args),
  })
  const pointer = y => ({
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 20,
    clientY: y,
    currentTarget: { setPointerCapture() {} },
    preventDefault() {},
  })

  drag.start(pointer(84), groups[2])
  listeners.get('pointermove')(pointer(4))
  assert.equal(drag.dragging.value, true)
  listeners.get('pointerup')(pointer(4))
  assert.deepEqual(drops, [['ungrouped-ssh', 'ssh-a', 'before']])
  assert.equal(drag.consumeSuppressedClick('ungrouped-ssh'), true)
  assert.equal(drag.consumeSuppressedClick('ungrouped-ssh'), false)

  drag.start(pointer(14), groups[0])
  listeners.get('pointermove')(pointer(95))
  listeners.get('pointerup')(pointer(95))
  assert.deepEqual(drops[1], ['ssh-a', 'ungrouped-ssh', 'after'])
  drag.consumeSuppressedClick('ssh-a')

  drag.start(pointer(84), groups[2])
  listeners.get('pointermove')(pointer(85))
  listeners.get('pointerup')(pointer(85))
  assert.equal(drops.length, 2)
  assert.equal(drag.consumeSuppressedClick('ungrouped-ssh'), false)

  drag.start(pointer(84), groups[2])
  listeners.get('pointermove')(pointer(4))
  listeners.get('pointercancel')(pointer(4))
  listeners.get('pointerup')(pointer(4))
  assert.equal(drag.dragging.value, false)
  assert.equal(drops.length, 2)
})
