import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, shallowRef, nextTick } from 'vue'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

const settings = dataModule(
  `export const settingNumber = (_key, fallback) => fallback; export const settingsSnapshot = () => ({})`
)
const api = dataModule(`
  export const mock = { calls: [], handlers: {} }
  const call = async (name, args) => { mock.calls.push([name, ...args]); return mock.handlers[name]?.(...args) }
  export const connect = (...args) => call('connect', args)
  export const disconnect = (...args) => call('disconnect', args)
  export const scan = (...args) => call('scan', args)
  export const inspect = (...args) => call('inspect', args)
  export const useDatabase = (...args) => call('useDatabase', args)
  export const execute = (...args) => call('execute', args)
  export const saveString = (...args) => call('saveString', args)
  export const deleteKey = (...args) => call('deleteKey', args)
  export const expireKey = (...args) => call('expireKey', args)
  export const errorMessage = error => error.message ?? String(error)
  export const isAppError = error => !!error?.kind
`)
const load = sourceLoader({
  '@/api/redis': api,
  '@/composables/useSettings': settings,
})
const { mock } = await import(api)
const { useRedisSession } = await load('src/composables/useRedisSession.ts')
const {
  isDatabaseConnection,
  isSqlConnection,
  groupKindOf,
  endpointOf,
  toDatabaseConfig,
  toDatabaseConnectionConfig,
} = await load('src/types/connection.ts')
const { createConnectionBackup, parseConnectionBackup } = await load(
  'src/utils/connection-backup.ts'
)
const connection = () => ({
  id: 'redis',
  name: 'Redis',
  kind: 'redis',
  host: 'localhost',
  port: 6379,
  username: '',
  group: '',
  tags: [],
  description: '',
  tagColor: 'red',
  createdAt: 1,
  lastUsedAt: 0,
  settings: { database: '0', password: '', ssl: false, sslMode: 'disable' },
})
const session = (id = 's1', database = '0') => ({
  sessionId: id,
  database,
  endpoint: 'localhost:6379',
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await nextTick()
}

async function fixture(t, handlers = {}) {
  mock.calls = []
  mock.handlers = {
    connect: async () => session(),
    scan: async () => ({ cursor: '0', keys: [] }),
    ...handlers,
  }
  let state
  const target = shallowRef(connection())
  const events = []
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      state = useRedisSession(target, (...args) => events.push(args))
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  await flush()
  return { state, target, events, app }
}

test('Redis joins database groups, keeps credential policy, and cannot enter SQL config', () => {
  const c = connection()
  assert.equal(isDatabaseConnection(c), true)
  assert.equal(isSqlConnection(c), false)
  assert.equal(groupKindOf(c.kind), 'database')
  assert.equal(endpointOf(c), 'localhost:6379')
  assert.equal(toDatabaseConnectionConfig(c, 'temporary').password, 'temporary')
  assert.equal(c.settings.password, '')
  assert.throws(() => toDatabaseConfig(c), /SQL/)
  c.settings.password = 'saved'
  const snapshot = { connections: [c], groups: [], tags: [] }
  const plain = parseConnectionBackup(createConnectionBackup(snapshot, false))
  assert.equal(plain.connections[0].kind, 'redis')
  assert.equal(plain.connections[0].settings.password, '')
  assert.equal(
    parseConnectionBackup(createConnectionBackup(snapshot, true)).connections[0]
      .settings.password,
    'saved'
  )
})

test('late connect is released after close and cannot resurrect the session', async t => {
  const pending = deferred()
  const { state } = await fixture(t, { connect: () => pending.promise })
  await state.disconnect()
  pending.resolve(session('late'))
  await flush()
  assert.equal(state.status.value, 'disconnected')
  assert.equal(state.session.value, null)
  assert.ok(
    mock.calls.some(([name, id]) => name === 'disconnect' && id === 'late')
  )
  assert.ok(!mock.calls.some(([name]) => name === 'scan'))
})

test('SCAN preserves large string cursors, empty batches, duplicates and matching pattern', async t => {
  const { state } = await fixture(t, {
    scan: async () => ({ cursor: '18446744073709551615', keys: [] }),
  })
  assert.equal(state.cursor.value, '18446744073709551615')
  const key = { id: 'aw==', name: 'k' }
  mock.handlers.scan = async () => ({ cursor: '4', keys: [key, key] })
  await state.scan()
  assert.deepEqual(mock.calls.at(-1), [
    'scan',
    's1',
    '18446744073709551615',
    '*',
  ])
  assert.equal(state.keys.value.length, 1)
  mock.handlers.scan = async () => ({ cursor: '0', keys: [key] })
  await state.scan()
  assert.equal(state.keys.value.length, 1)
  const calls = mock.calls.length
  await state.scan()
  assert.equal(mock.calls.length, calls)
  await state.scan(true, 'user:*')
  assert.deepEqual(mock.calls.at(-1), ['scan', 's1', '0', 'user:*'])
})

test('failed SELECT keeps the active database and successful switch resets keys', async t => {
  const { state } = await fixture(t)
  mock.handlers.useDatabase = async () => {
    throw { kind: 'invalidInput', message: 'ERR invalid DB index' }
  }
  await state.switchDatabase('999')
  assert.equal(state.session.value.database, '0')
  assert.equal(state.connected.value, true)
  assert.match(state.error.value, /invalid DB/)
  mock.handlers.useDatabase = async () => session('s1', '2')
  await state.switchDatabase('2')
  assert.equal(state.session.value.database, '2')
  assert.deepEqual(mock.calls.at(-1), ['scan', 's1', '0', '*'])
})

test('operation results from a disconnected session cannot overwrite a new connection', async t => {
  const { state } = await fixture(t)
  const pending = deferred()
  mock.handlers.scan = () => pending.promise
  const scan = state.scan(true)
  assert.equal(state.busy.value, true)
  await state.disconnect()
  mock.handlers.scan = async () => ({ cursor: '0', keys: [] })
  mock.handlers.connect = async () => session('s2')
  await state.connect()
  pending.resolve({ cursor: '2', keys: [{ id: 'old', name: 'old' }] })
  await scan
  assert.equal(state.session.value.sessionId, 's2')
  assert.deepEqual(state.keys.value, [])
  assert.equal(state.busy.value, false)
})

test('auth retry uses only a runtime password; network failures close without replaying writes', async t => {
  const { state } = await fixture(t, {
    connect: async () => {
      throw { kind: 'auth', message: 'NOAUTH' }
    },
  })
  assert.equal(state.needsPassword.value, true)
  mock.handlers.connect = async config => {
    assert.equal(config.password, 'runtime')
    return session()
  }
  await state.connect('runtime')
  assert.equal(state.connected.value, true)
  mock.handlers.execute = async () => {
    throw { kind: 'network', message: 'timeout' }
  }
  await state.execute('SET k v')
  await flush()
  assert.equal(state.connected.value, false)
  assert.equal(state.busy.value, false)
  assert.equal(mock.calls.filter(([name]) => name === 'execute').length, 1)
})
