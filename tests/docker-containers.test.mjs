import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, markRaw, nextTick, reactive } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const boundary = dataModule(`
  export const mocks = {};
  export const useRoute = () => mocks.route, useRouter = () => mocks.router;
  export const useConnectionsStore = () => mocks.connections;
  export const listContainers = (...args) => mocks.list(...args);
  export const containerAction = (...args) => mocks.action(...args);
  export const openDockerLogsWindow = (...args) => mocks.openLogs(...args);
  export const openConnectionWindow = () => {};
  export const toast = { success: message => mocks.messages.push(message), error: error => mocks.messages.push(error) };
  export const errorMessage = error => error.message;
  export const useI18n = () => ({locale: {value: 'zh-CN'}, t: (key, params) => key.replace('{name}', params?.name ?? '')});
`)
const select = dataModule(`
  import { h } from ${JSON.stringify(import.meta.resolve('vue'))};
  export default { props:['options'], setup: props => () => h('select', { options: props.options }) };
`)
const page = 'src/pages/docker/index.vue'
const load = sourceLoader(
  {
    ...Object.fromEntries(
      [
        'vue-i18n',
        'vue-router',
        '@/stores/connections',
        '@/api/docker',
        '@/api/ssh',
        '@/utils/window',
        '@/composables/useToast',
      ].map(key => [key, boundary])
    ),
    '@/components/ui/AppSelect.vue': select,
    '@/composables/useSettings': dataModule(
      'export const settingNumber = () => 0, settingsSnapshot = {};'
    ),
  },
  [
    page,
    'src/components/ui/AppDataTable.vue',
    'src/components/ui/AppColumnResizeHandle.vue',
    'src/components/ui/AppButton.vue',
    'src/components/ui/IconButton.vue',
  ]
)
const { mocks } = await import(boundary)
const { default: DockerPage } = await load(page)
const node = (type, text = '') =>
  markRaw({ type, text, props: {}, children: [], parent: null })
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
    el.parent = null
  },
})
const walk = el => [el, ...el.children.flatMap(walk)]
const flush = async () => {
  await nextTick()
  await nextTick()
  await nextTick()
}
const deferred = () => {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

const container = (id, name, state) => ({
  id,
  name,
  state,
  status: state,
  image: 'sample',
  ports: '',
})
const profile = id => ({
  id,
  name: id,
  kind: 'docker',
  settings: { endpoint: id, protocol: 'unix', transport: 'direct' },
})
const first = container('same-id', 'web', 'running')
const second = container('stopped-id', 'worker', 'exited')
const other = container('same-id', 'other-endpoint', 'running')

async function mount(t, overrides = {}) {
  Object.assign(mocks, {
    route: reactive({ name: 'docker', params: { connectionId: 'alpha' } }),
    router: { push: route => Object.assign(mocks.route, route) },
    connections: reactive({
      items: [
        profile('alpha'),
        { id: 'ssh-only', kind: 'ssh' },
        profile('beta'),
      ],
    }),
    messages: [],
    list: async settings =>
      settings.endpoint === 'alpha' ? [first, second] : [other],
    action: async () => {},
    openLogs: async () => {},
    ...overrides,
  })
  const root = node('root')
  const app = renderer.createApp(DockerPage)
  app.mount(root)
  t.after(() => app.unmount())
  await flush()
  const elements = () => walk(root)
  return {
    elements,
    button: title =>
      elements().find(el => el.type === 'button' && el.props.title === title)
        ?.props,
    switchTo: async id => {
      mocks.route.params.connectionId = id
      await flush()
    },
  }
}

test('each row targets its saved Docker connection and container, and only locks its own pending action', async t => {
  const pending = deferred()
  const calls = []
  const { button, elements, switchTo } = await mount(t, {
    action: (settings, id, action) => {
      calls.push([settings.endpoint, id, action])
      if (action === 'stop') return pending.promise
    },
  })
  assert.deepEqual(
    elements()
      .find(el => el.type === 'select')
      .props.options.map(o => o.value),
    ['alpha', 'beta']
  )
  assert.equal(button('启动容器“web”').disabled, true)
  assert.equal(button('停止容器“worker”').disabled, true)
  const stop = button('停止容器“web”').onClick
  void stop()
  void stop()
  await flush()
  assert.equal(button('重启容器“web”').disabled, true)
  assert.equal(button('启动容器“worker”').disabled, false)
  await button('启动容器“worker”').onClick()
  await switchTo('beta')
  assert.equal(button('重启容器“other-endpoint”').disabled, false)
  await button('重启容器“other-endpoint”').onClick()
  await switchTo('alpha')
  assert.equal(button('重启容器“web”').disabled, true)
  mocks.list = async () => [{ ...first, state: 'exited' }, second]
  pending.resolve()
  await flush()
  assert.equal(button('启动容器“web”').disabled, false)
  assert.deepEqual(calls, [
    ['alpha', 'same-id', 'stop'],
    ['alpha', 'stopped-id', 'start'],
    ['beta', 'same-id', 'restart'],
  ])
  mocks.action = async () => {
    throw new Error('engine unavailable')
  }
  await button('启动容器“web”').onClick()
  assert.deepEqual(mocks.messages.at(-1), {
    title: '容器“web”操作失败',
    description: 'engine unavailable',
  })
})

test('the shared sortable and resizable table opens a dedicated logs window for the selected connection and container', async t => {
  const windows = []
  const { button, elements, switchTo } = await mount(t, {
    openLogs: (...args) => windows.push(args),
  })
  const header = elements().find(el => el.props['data-column'] === 'name')
  const names = () =>
    elements()
      .filter(el => el.props.scope === 'row')
      .map(el => el.text)
  const sortByName = walk(header).find(el => el.type === 'button')
  const grip = walk(header).find(el => el.props.role === 'separator')
  const measuredHeader = {
    dataset: { column: 'name' },
    getBoundingClientRect: () => ({ width: 280 }),
  }
  const table = { querySelectorAll: () => [measuredHeader] }
  grip.props.onKeydown({
    key: 'ArrowRight',
    shiftKey: true,
    currentTarget: { closest: selector => selector === 'th' ? measuredHeader : table },
    preventDefault() {},
  })
  await flush()
  assert.equal(elements().find(el => el.type === 'col').props.style.width, '312px')
  sortByName.props.onClick()
  await flush()
  assert.deepEqual(names(), ['web', 'worker'])
  assert.equal(header.props['aria-sort'], 'ascending')
  sortByName.props.onClick()
  await flush()
  assert.deepEqual(names(), ['worker', 'web'])
  assert.equal(header.props['aria-sort'], 'descending')
  await button('查看容器“worker”的日志').onClick()
  assert.equal(elements().filter(el => el.type === 'tr').length, 3)
  assert.equal(button('刷新日志'), undefined)
  await button('查看容器“web”的日志').onClick()
  const delayedList = deferred()
  mocks.list = settings =>
    settings.endpoint === 'alpha' ? delayedList.promise : [other]
  void button('刷新').onClick()
  await switchTo('beta')
  delayedList.resolve([first, second])
  await flush()
  assert.equal(button('查看容器“web”的日志'), undefined)
  await button('查看容器“other-endpoint”的日志').onClick()
  assert.deepEqual(windows, [
    ['alpha', 'stopped-id', 'worker'],
    ['alpha', 'same-id', 'web'],
    ['beta', 'same-id', 'other-endpoint'],
  ])
  mocks.openLogs = async () => {
    throw new Error('window unavailable')
  }
  await button('查看容器“other-endpoint”的日志').onClick()
  assert.deepEqual(mocks.messages.at(-1), {
    title: '无法打开容器日志窗口',
    description: 'window unavailable',
  })
})

test('changing SSH proxy, jump selection or a referenced jump host invalidates the previous Docker target', async t => {
  const docker = profile('alpha')
  Object.assign(docker.settings, {
    transport: 'ssh',
    sshConnectionId: 'tunnel',
  })
  const connections = reactive({
    items: [
      docker,
      { id: 'tunnel', kind: 'ssh', settings: { jumpHostIds: ['gateway'] } },
      { id: 'gateway', kind: 'ssh', host: 'gateway-a', settings: {} },
    ],
    find(id) {
      return this.items.find(item => item.id === id)
    },
  })
  let reads = 0
  const delayed = deferred()
  const { button } = await mount(t, {
    connections,
    list: () => (++reads === 2 ? delayed.promise : [first]),
  })
  connections.find('gateway').host = 'gateway-b'
  await flush()
  assert.equal(button('查看容器“web”的日志'), undefined)
  connections.find('tunnel').settings.jumpHostIds = []
  await flush()
  assert.ok(button('查看容器“web”的日志'))
  connections.find('tunnel').settings.proxy = { type: 'socks5', host: 'proxy' }
  await flush()
  delayed.resolve([other])
  await flush()
  assert.equal(reads, 4)
  assert.ok(button('查看容器“web”的日志'))
  assert.equal(button('查看容器“other-endpoint”的日志'), undefined)
})
