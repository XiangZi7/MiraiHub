import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

const api = dataModule(`
  export const mock = { calls: [], handlers: {} }
  const call = async (name, args) => {
    mock.calls.push([name, ...args]); return mock.handlers[name]?.(...args)
  }
  export const connect = (...args) => call('connect', args)
  export const disconnect = (...args) => call('disconnect', args)
  export const listDatabases = (...args) => call('listDatabases', args)
  export const listObjects = (...args) => call('listObjects', args)
  export const useDatabase = (...args) => call('useDatabase', args)
  export const completionColumns = (...args) => call('completionColumns', args)
  export const errorMessage = error => error.message ?? String(error)
  export const isAppError = () => false
`)
const load = sourceLoader(
  {
    '@/api/database': api,
    '@/composables/useToast': dataModule(
      'export const toast = { error(){}, warning(){} }'
    ),
    '@/components/ui/AppIcon.vue': dataModule(`
      import { h } from ${JSON.stringify(import.meta.resolve('vue'))}
      export default { props:['name'], setup: props => () => h('i', { 'data-icon':props.name }) }
    `),
  },
  [
    'src/components/workspace/DatabaseView.vue',
    'src/components/workspace/database/DatabaseObjectTree.vue',
    'src/components/workspace/database/DatabaseTableOverview.vue',
    'src/components/workspace/database/DatabaseConnectingSkeleton.vue',
    'src/components/ui/AppButton.vue',
  ]
)
const { mock } = await import(api)
const { i18n } = await load('src/i18n/index.ts')
const { default: DatabaseView } = await load(
  'src/components/workspace/DatabaseView.vue'
)
i18n.global.locale.value = 'zh-CN'

const node = (type, text = '') =>
  markRaw({ type, text, style: {}, props: {}, children: [], parent: null })
const renderer = createRenderer({
  createElement: type => node(type),
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (el, text) => {
    el.text = text
  },
  setElementText: (el, text) => {
    el.text = text
    el.children = []
  },
  patchProp: (el, key, _old, value) => {
    el.props[key] = value
  },
  parentNode: el => el.parent,
  nextSibling: el =>
    el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  insert(el, parent, anchor) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    el.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el)
  },
  remove(el) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
  },
})
const all = el => [el, ...el.children.flatMap(all)]
const textOf = el =>
  (el.type === '#comment' ? '' : el.text) + el.children.map(textOf).join('')
const flush = async () => {
  for (let i = 0; i < 25; i++) await nextTick()
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const session = database => ({
  sessionId: 'db-browse',
  database,
  endpoint: 'fixture.invalid:3306',
  serverVersion: '8',
})
const object = (schema, name = `${schema}_table`) => ({
  schema,
  name,
  kind: 'table',
  identity: '',
  comment: '',
})

async function fixture(
  t,
  { database = '', kind = 'mysql', handlers = {} } = {}
) {
  const originalWindow = globalThis.window
  const originalStorage = globalThis.localStorage
  globalThis.window = new EventTarget()
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  }
  mock.calls = []
  mock.handlers = {
    connect: async () => session(database),
    listDatabases: async () => ['alpha', 'beta'],
    useDatabase: async (_id, name) => session(name),
    listObjects: async () => [object('alpha'), object('beta')],
    completionColumns: async () => [],
    ...handlers,
  }
  const root = node('root')
  const errors = []
  const app = renderer.createApp({
    render: () =>
      h(DatabaseView, {
        connection: {
          id: 'browse-test',
          kind,
          name: 'Fixture connection',
          host: 'fixture.invalid',
          port: 3306,
          username: 'fixture',
          settings: { database, password: '', ssl: false },
          tags: [],
          tagColor: 'green',
          group: '',
          createdAt: 1,
          updatedAt: 1,
        },
      }),
  })
  app.config.errorHandler = error => errors.push(error)
  app.use(createPinia()).use(i18n).mount(root)
  t.after(() => {
    app.unmount()
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    if (originalStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = originalStorage
    assert.deepEqual(errors, [])
  })
  await flush()
  return {
    root,
    overview: () =>
      all(root).find(el => el.props['aria-label'] === '当前数据库的表'),
    async select(name) {
      const button = all(root).find(
        el =>
          el.type === 'button' &&
          el.props['aria-expanded'] !== undefined &&
          textOf(el) === name
      )
      assert.ok(button, `Schema button ${name} must be visible`)
      button.props.onClick({ stopPropagation() {} })
      await flush()
    },
  }
}

test('MySQL initially shows no tables or metadata requests, including configured databases', async t => {
  for (const database of ['', 'alpha']) {
    await t.test(database || 'no default database', async t => {
      const view = await fixture(t, { database })
      assert.equal(textOf(view.overview()), '')
      assert.equal(
        mock.calls.some(
          ([name]) => name === 'listObjects' || name === 'completionColumns'
        ),
        false
      )
      await view.select('alpha')
      assert.match(textOf(view.overview()), /alpha_table/)
      assert.doesNotMatch(textOf(view.overview()), /beta_table/)
      assert.equal(
        mock.calls.filter(([name]) => name === 'listObjects').length,
        1
      )
      assert.equal(
        mock.calls.filter(([name]) => name === 'useDatabase').length,
        database ? 0 : 1
      )
    })
  }
})

test('connection and table loading use skeletons without extra spinners or loading text', async t => {
  const connected = deferred(),
    objects = deferred()
  const view = await fixture(t, {
    handlers: {
      connect: () => connected.promise,
      listObjects: () => objects.promise,
    },
  })
  assert.ok(
    all(view.root).some(
      el =>
        el.props.role === 'status' &&
        el.props['aria-label'] === '正在连接数据库…'
    )
  )
  assert.doesNotMatch(textOf(view.root), /Connecting|正在连接数据库/)
  assert.equal(
    all(view.root).some(el => el.props['data-icon'] === 'lucide:loader-circle'),
    false
  )
  connected.resolve(session(''))
  await flush()
  await view.select('alpha')
  assert.ok(
    all(view.overview()).some(
      el =>
        el.props.role === 'status' &&
        el.props['aria-label'] === '正在加载表列表…'
    )
  )
  assert.equal(textOf(view.overview()), '')
  assert.equal(
    all(view.root).some(el => el.props['data-icon'] === 'lucide:loader-circle'),
    false
  )
  objects.resolve([object('alpha')])
  await flush()
  assert.match(textOf(view.overview()), /alpha_table/)
})

test('switching clears old tables and ignores a late response from the previous database', async t => {
  const oldObjects = deferred()
  let requests = 0
  const view = await fixture(t, {
    handlers: {
      listObjects: () =>
        ++requests === 1
          ? oldObjects.promise
          : Promise.resolve([object('beta')]),
    },
  })
  await view.select('alpha')
  await view.select('beta')
  assert.match(textOf(view.overview()), /beta_table/)
  oldObjects.resolve([object('alpha')])
  await flush()
  assert.match(textOf(view.overview()), /beta_table/)
  assert.doesNotMatch(textOf(view.overview()), /alpha_table/)
})

test('rapid database changes serialize pool switches and keep the last selection', async t => {
  const firstSwitch = deferred()
  const view = await fixture(t, {
    handlers: {
      useDatabase: (_id, name) =>
        name === 'alpha' ? firstSwitch.promise : Promise.resolve(session(name)),
    },
  })
  await view.select('alpha')
  await view.select('beta')
  assert.deepEqual(
    mock.calls.filter(([name]) => name === 'useDatabase').map(call => call[2]),
    ['alpha']
  )
  firstSwitch.resolve(session('alpha'))
  await flush()
  assert.deepEqual(
    mock.calls.filter(([name]) => name === 'useDatabase').map(call => call[2]),
    ['alpha', 'beta']
  )
  assert.match(textOf(view.overview()), /beta_table/)
  assert.doesNotMatch(textOf(view.overview()), /alpha_table/)
})

test('a failed database selection can be retried from the table overview', async t => {
  let switches = 0
  const view = await fixture(t, {
    handlers: {
      useDatabase: async (_id, name) => {
        if (++switches === 1) throw new Error('fixture connection failed')
        return session(name)
      },
    },
  })
  await view.select('alpha')
  assert.match(textOf(view.overview()), /表列表加载失败/)
  const retry = all(view.overview()).find(
    el => el.type === 'button' && textOf(el) === '重新加载'
  )
  retry.props.onClick()
  await flush()
  assert.equal(switches, 2)
  assert.match(textOf(view.overview()), /alpha_table/)
})

test('PostgreSQL initially leaves the overview empty and filters by the clicked schema', async t => {
  const view = await fixture(t, {
    kind: 'postgresql',
    database: 'postgres',
    handlers: {
      listObjects: async () => [
        object('public', 'users'),
        object('audit', 'events'),
      ],
    },
  })
  assert.equal(textOf(view.overview()), '')
  await view.select('public')
  assert.match(textOf(view.overview()), /users/)
  assert.doesNotMatch(textOf(view.overview()), /events/)
  await view.select('audit')
  assert.match(textOf(view.overview()), /events/)
  assert.doesNotMatch(textOf(view.overview()), /users/)
  assert.equal(
    mock.calls.some(([name]) => name === 'useDatabase'),
    false
  )
})
