import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createRenderer,
  h,
  markRaw,
  nextTick,
  onUnmounted,
  reactive,
  shallowRef,
} from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const vue = JSON.stringify(import.meta.resolve('vue'))
const load = sourceLoader(
  {
    vue: dataModule(`export * from ${vue}; export const vModelText = {}`),
    '@vueuse/core': dataModule(
      `import {shallowRef} from ${vue}; export const useStorage=(_key,value)=>shallowRef(value)`
    ),
    '@/composables/useConnectionGroupDrag': dataModule(
      `import {shallowRef} from ${vue}; export const useConnectionGroupDrag=()=>({draggedConnectionId:shallowRef(''),targetGroupId:shallowRef(''),rootActive:shallowRef(false),dragging:shallowRef(false),start(){},consumeSuppressedClick(){return false}})`
    ),
    '@/composables/useConnectionGroupReorder': dataModule(
      `import {shallowRef} from ${vue}; export const useConnectionGroupReorder=()=>({draggedGroupId:shallowRef(''),targetGroupId:shallowRef(''),targetPosition:shallowRef(''),dragging:shallowRef(false),start(){},consumeSuppressedClick(){return false}})`
    ),
    './ConnectionListTools.vue': dataModule(
      `import {h} from ${vue}; export default {props:['keyword'],emits:['update:keyword'],setup:(props,{emit})=>()=>h('input',{'data-search':true,value:props.keyword,onInput:value=>emit('update:keyword',value)})}`
    ),
    '@/components/ui/TabBar.vue': dataModule(
      `import {h} from ${vue}; export default {props:['tabs','active','contextItems'],emits:['update:active','add','close','closeMany','reorder'],setup:(props,{emit})=>()=>h('nav',{'data-main-tabs':true,items:props.tabs,active:props.active,onSelect:id=>emit('update:active',id),onAdd:()=>emit('add'),onClose:id=>emit('close',id),onCloseMany:ids=>emit('closeMany',ids),onReorder:(a,b)=>emit('reorder',a,b)})}`
    ),
  },
  [
    'src/components/workspace/SidebarProjects.vue',
    'src/pages/connection/components/connection-tag-editor.vue',
    'src/components/workspace/WorkspaceTabBar.vue',
    'src/components/workspace/WorkspaceSplitNode.vue',
    'src/components/ui/IconButton.vue',
    'src/components/workspace/database/DatabaseTabWorkspace.vue',
  ]
)
const { i18n } = await load('src/i18n/index.ts')
i18n.global.locale.value = 'zh-CN'
const { default: SidebarProjects } = await load(
  'src/components/workspace/SidebarProjects.vue'
)
const { default: ConnectionTagEditor } = await load(
  'src/pages/connection/components/connection-tag-editor.vue'
)
const { default: WorkspaceTabBar } = await load(
  'src/components/workspace/WorkspaceTabBar.vue'
)
const {
  provideDatabaseWorkspaceTabs,
  databaseWorkspaceTabId,
  workspaceViewTabs,
} = await load('src/composables/useDatabaseWorkspaceTabs.ts')
const { useRemoteFileSelection } = await load(
  'src/components/workspace/useRemoteFileSelection.ts'
)
const { useWorkspaceTabSplit, provideWorkspaceTabSplit } = await load(
  'src/composables/useWorkspaceTabSplit.ts'
)
const { default: DatabaseTabWorkspace } = await load(
  'src/components/workspace/database/DatabaseTabWorkspace.vue'
)
const { default: WorkspaceSplitNode } = await load(
  'src/components/workspace/WorkspaceSplitNode.vue'
)
const node = (type, text = '') =>
  markRaw({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getRootNode() {
      return { activeElement: null }
    },
  })
const renderer = createRenderer({
  querySelector: () => node('body'),
  createElement(type) {
    const el = node(type)
    if (type === 'pre') {
      el.scrollTop = 0
      el.clientHeight = 40
      Object.defineProperty(el, 'scrollHeight', { get: () => el.text.split('\n').length * 20 })
    }
    return el
  },
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
const mount = (component, t) => {
  const root = node('root')
  const app = renderer.createApp(component)
  app.use(i18n).mount(root)
  t.after(() => app.unmount())
  return root
}
const connection = (id, name) => ({
  id,
  name,
  kind: 'mysql',
  host: 'test.invalid',
  port: 3306,
  username: 'test',
  settings: { database: 'demo' },
  tags: [],
  tagColor: 'green',
  group: '',
  createdAt: 1,
  updatedAt: 1,
})

test('关闭分屏按钮收起所在分组并保留全部标签和会话', async t => {
  const tabs = ['ssh', 'db'].map(id => ({
    id,
    connection: connection(id, id),
    status: 'connected',
    sessionId: `session-${id}`,
  }))
  const active = shallowRef('ssh')
  let layout
  const closedTabs = []
  const root = mount(
    {
      setup() {
        layout = useWorkspaceTabSplit({
          tabs: () => tabs,
          activeId: () => active.value,
          enabled: () => true,
        })
        provideWorkspaceTabSplit(layout)
        return () =>
          h(WorkspaceSplitNode, {
            node: layout.tree.value,
            tabs,
            closeWarning: () => '',
            onActivate: id => (active.value = id),
            onCloseMany: ids => closedTabs.push(...ids),
          })
      },
    },
    t
  )
  const closeButtons = () =>
    all(root).filter(
      el => el.type === 'button' && el.props['aria-label'] === '关闭分屏'
    )
  assert.equal(closeButtons().length, 0)
  layout.moveTab('db', layout.tree.value.id, 'right')
  active.value = 'db'
  await nextTick()
  assert.equal(closeButtons().length, 2)
  const closingGroup = all(root).find(
    el => el.props['data-workspace-tab-group'] === layout.groupForTab('db').id
  )
  all(closingGroup)
    .find(el => el.type === 'button' && el.props['aria-label'] === '关闭分屏')
    .props.onClick()
  await nextTick()
  assert.equal(layout.split.value, false)
  assert.equal(closeButtons().length, 0)
  assert.equal(layout.groups.value[0].activeId, 'db')
  assert.deepEqual(layout.groups.value[0].tabIds, ['ssh', 'db'])
  assert.deepEqual(closedTabs, [])
  assert.deepEqual(
    tabs.map(tab => tab.sessionId),
    ['session-ssh', 'session-db']
  )
})

test('server search temporarily expands matches and restores manual group folding when cleared', async t => {
  const groups = ['a', 'b'].map(id => ({
    id,
    name: id,
    kind: 'ssh',
    items: [{ ...connection(id, 'Server ' + id), kind: 'ssh' }],
  }))
  const root = mount(
    {
      render: () =>
        h(SidebarProjects, {
          label: 'Servers',
          kind: 'ssh',
          groups,
          loaded: true,
          connectedIds: new Set(),
          openIds: new Set(),
        }),
    },
    t
  )
  const group = id =>
    all(root).find(
      el => el.props['data-reorderable-connection-group-id'] === id
    )
  const search = () => all(root).find(el => el.props['data-search'])
  assert.equal(group('a').props['aria-expanded'], false)
  group('b').props.onClick()
  await nextTick()
  search().props.onInput('Server')
  await nextTick()
  assert.equal(group('a').props['aria-expanded'], true)
  assert.equal(group('b').props['aria-expanded'], true)
  group('a').props.onClick()
  await nextTick()
  assert.equal(group('a').props['aria-expanded'], false)
  search().props.onInput('')
  await nextTick()
  assert.equal(group('a').props['aria-expanded'], false)
  assert.equal(group('b').props['aria-expanded'], true)
})

test('tag input preserves explicit casing even when a shared tag has different casing', async t => {
  const tags = shallowRef('')
  const root = mount(
    {
      render: () =>
        h(ConnectionTagEditor, {
          modelValue: tags.value,
          'onUpdate:modelValue': value => {
            tags.value = value
          },
          color: 'green',
          availableTags: [{ name: 'prod', color: 'blue', createdAt: 1 }],
        }),
    },
    t
  )
  const input = () => all(root).find(el => el.type === 'input')
  input().props['onUpdate:modelValue']('Prod')
  await nextTick()
  input().props.onKeydown({ key: 'Enter', preventDefault() {} })
  await nextTick()
  assert.equal(tags.value, 'Prod')
})

test('Docker form tests and saves the displayed engine, keeps SSH by ID, and excludes an inactive proxy', async t => {
  const boundary = dataModule(`
    export const calls = { tests: [], created: [], warnings: [] }
    export const useConnections = () => ({
      connections: [{ id: 'ssh-a', kind: 'ssh', name: 'Server', host: 'server.example', port: 22 }],
      create: async c => calls.created.push(c)
    })
    export const testConnection = async settings => calls.tests.push(settings)
    export const toast = { warning: text => calls.warnings.push(text), success() {}, error(e) { throw Error(JSON.stringify(e)) } }
    export const get = async () => undefined
  `)
  const field = dataModule(`
    import { h } from ${vue}
    export default { props: ['label', 'modelValue'], emits: ['update:modelValue'],
      setup: (props, { emit }) => () => h('input', {
        label: props.label, value: props.modelValue, onChange: value => emit('update:modelValue', value),
      }) }
  `)
  const path = 'src/pages/connection/components/docker-connection-form.vue'
  const dockerLoad = sourceLoader({
    '@/composables/useConnections': boundary,
    '@/api/connections': boundary,
    '@/api/docker': boundary,
    '@/composables/useToast': boundary,
    '@/api/ssh': dataModule('export const errorMessage = String'),
    '@/utils/platform': dataModule("export const DESKTOP_PLATFORM = 'windows', DEFAULT_LOCAL_SHELL = 'powershell'; export const normalizeLocalShell = shell => shell"),
    '@/components/ui/AppSelect.vue': field,
    '@/components/ui/AppTextField.vue': field,
  }, [path, 'src/components/ui/AppButton.vue'])
  const { default: Form } = await dockerLoad(path)
  const { calls } = await import(boundary)
  const root = mount({ render: () => h(Form, { connectionId: '', defaultGroup: 'Engines' }) }, t)
  const input = key => all(root).find(n => n.props.label === i18n.global.t(key))
  const button = key => all(root).find(n => n.type === 'button' && all(n).some(child => child.text === i18n.global.t(key)))
  assert.equal(input('协议').props.value, 'npipe')
  input('Name').props.onChange('Team engine')
  input('协议').props.onChange('https')
  await nextTick()
  button('Proxy').props.onClick()
  await nextTick()
  input('HTTP(S) 代理地址').props.onChange('http://proxy.example:8080')
  await button('Test Connection').props.onClick()
  assert.deepEqual(calls.tests[0], {
    protocol: 'https', endpoint: 'https://127.0.0.1:2376', transport: 'direct', proxyUrl: 'http://proxy.example:8080',
  })
  button('General').props.onClick()
  await nextTick()
  input('协议').props.onChange('unix')
  await nextTick()
  assert.equal(input('连接方式').props.value, 'ssh')
  await button('Test Connection').props.onClick()
  assert.equal(calls.tests.length, 1)
  assert.equal(calls.warnings.at(-1), i18n.global.t('请选择 SSH 隧道连接'))
  input('SSH 隧道').props.onChange('ssh-a')
  const form = all(root).find(n => n.type === 'form')
  await form.props.onSubmit({ preventDefault() {} })
  assert.equal(calls.created[0].name, 'Team engine')
  assert.equal(calls.created[0].group, 'Engines')
  assert.deepEqual(calls.created[0].settings, {
    protocol: 'unix', endpoint: '/var/run/docker.sock', transport: 'ssh', sshConnectionId: 'ssh-a',
  })
})

test('remote file window keeps native close protection, titlebar save and keyboard save in the shared frame', async t => {
  const path = 'src/pages/remote-editor.vue'
  const boundary = dataModule(`
    export const fixture = { calls: [], keydown: null, closeRequested: null, finished: false }
    export const remoteEditorTarget = async () => ({ sessionId: 'ssh', path: '/etc/app.conf', connectionName: 'Server' })
    export const remoteEditorStatus = async () => {}, finishRemoteEditor = async () => { fixture.finished = true }
    const doc = { id: 'document', text: 'original', path: '/etc/app.conf', lineEnding: 'LF' }
    export const openText = async () => doc, closeText = async () => {}
    export const saveText = async (_id, text) => { fixture.calls.push(text); return { ...doc, text } }
    export const toast = { success() {}, info() {}, error(e) { throw Error(JSON.stringify(e)) } }
    export const errorMessage = String, isAppError = () => false
    export const useEventListener = (_target, kind, callback) => { if (kind === 'keydown') fixture.keydown = callback }
    export const getCurrentWindow = () => ({ listen: async (_event, callback) => { fixture.closeRequested = callback; return () => {} } })
    export const closeWindow = () => fixture.closeRequested(), minimizeWindow = () => {}, toggleMaximizeWindow = () => {}
    export const isMaximized = { value: false }, trackMaximized = () => () => {}
  `)
  const native = (await import(boundary)).fixture
  const before = globalThis.window
  if (!before) globalThis.window = {}
  const editorLoad = sourceLoader({
    ...Object.fromEntries([
      '@tauri-apps/api/window', '@/api/operations', '@/api/ssh', '@/utils/window', '@/composables/useToast', '@vueuse/core',
    ].map(module => [module, boundary])),
    '@/i18n': dataModule('export const i18n = { global: { t: key => key } }'),
    '@/components/operations/CodeEditor.vue': dataModule(`
      import { h } from ${vue}
      export default { props: ['modelValue'], emits: ['update:modelValue'], setup: (p, { emit }) => () =>
        h('textarea', { value: p.modelValue, onChange: value => emit('update:modelValue', value) }) }
    `),
    '@/components/operations/OperationDialog.vue': dataModule(`
      import { h } from ${vue}
      export default { setup: (_p, { slots }) => () => h('section', slots.default?.()) }
    `),
    '@/components/ui/AppConfirmDialog.vue': dataModule(`
      import { h } from ${vue}
      export default { props: ['open'], setup: (p, { slots }) => () =>
        p.open ? h('aside', {role: 'alertdialog'}, slots.actions?.()) : null }
    `),
  }, [path, 'src/components/operations/RemoteTextEditor.vue', 'src/components/ui/DocumentWindowFrame.vue', 'src/components/ui/WindowControls.vue', 'src/components/ui/AppButton.vue'])
  const { default: RemotePage } = await editorLoad(path)
  const root = mount(RemotePage, t)
  t.after(() => { if (!before) delete globalThis.window })
  const flush = async () => { for (let i = 0; i < 12; i++) await nextTick() }
  const nodes = () => all(root)
  const button = text => nodes().find(el => el.type === 'button' && (el.props.title === text || all(el).some(child => child.text === text)))
  const edit = text => nodes().find(el => el.type === 'textarea').props.onChange(text)
  await flush()
  assert.ok(nodes().some(el => el.props.class === 'document-window-titlebar'))
  assert.ok(nodes().some(el => el.text === 'app.conf'))
  assert.ok(nodes().some(el => el.text.includes('/etc · Server')))
  assert.equal(button('保存').props.disabled, true)
  edit('saved by button')
  await flush()
  assert.ok(nodes().some(el => el.props.title === '未保存'))
  await button('保存').props.onClick()
  edit('saved by shortcut')
  native.keydown({ key: 's', ctrlKey: true, preventDefault() {}, stopPropagation() {} })
  await flush()
  assert.deepEqual(native.calls, ['saved by button', 'saved by shortcut'])
  edit('pending draft')
  await flush()
  button('关闭').props.onClick()
  await flush()
  assert.ok(nodes().some(el => el.props.role === 'alertdialog'))
  assert.equal(native.finished, false)
  await button('保存并关闭').props.onClick()
  await flush()
  assert.equal(native.calls.at(-1), 'pending draft')
  assert.equal(native.finished, true)
})

async function mountLogWindow(t, snapshot = '') {
  const path = 'src/pages/docker/logs.vue'
  const boundary = dataModule(`
    export const mock = {}
    export const useConnectionsStore = () => mock.connections
    export const containerLogs = (...args) => mock.logs(...args)
    export const followContainerLogs = (...args) => mock.follow(...args)
    export const errorMessage = error => error.message
    export const translateNativeMessage = String
    export const IS_TAURI = true, closeWindow = () => { mock.closed = true }, toggleMaximizeWindow = () => {}
    export const minimizeWindow = () => {}, isMaximized = { value: false }, trackMaximized = () => () => {}
  `)
  const logLoad = sourceLoader({
    '@/api/docker': boundary,
    '@/api/ssh': boundary,
    '@/stores/connections': boundary,
    '@/i18n/native': boundary,
    '@/utils/window': boundary,
  }, [path, 'src/components/ui/AppButton.vue', 'src/components/ui/AppSwitch.vue', 'src/components/ui/IconButton.vue', 'src/components/ui/DocumentWindowFrame.vue', 'src/components/ui/WindowControls.vue'])
  const { default: LogPage } = await logLoad(path)
  const { mock } = await import(boundary)
  const id = 'a'.repeat(64)
  const engine = reactive({
    kind: 'docker', id: 'engine', name: 'Remote',
    settings: { protocol: 'unix', endpoint: '/var/run/docker.sock', transport: 'ssh', sshConnectionId: 'server' },
  })
  const server = reactive({ id: 'server', kind: 'ssh', host: 'example', settings: { jumpHostIds: ['jump'] } })
  const jump = reactive({ id: 'jump', kind: 'ssh', host: 'gateway', settings: {} })
  mock.connections = { find: key => [engine, server, jump].find(item => item.id === key), refresh: async () => {} }
  const calls = []
  mock.logs = async (...args) => { calls.push(args); return snapshot }
  const props = reactive({ connectionId: engine.id, containerId: id, containerName: 'worker' })
  const displayed = shallowRef(true)
  const root = mount({ render: () => displayed.value ? h(LogPage, props) : null }, t)
  const flush = async () => { for (let i = 0; i < 6; i++) await nextTick() }
  const nodes = () => all(root)
  const namedButton = key => nodes().find(el => el.props['aria-label'] === i18n.global.t(key))?.props
  const contains = text => nodes().some(el => el.text.includes(text))
  await flush()
  return { calls, id, engine, jump, nodes, namedButton, contains, mock, props, flush, displayed }
}

test('independent Docker log window reads only its container, retries failures and invalidates edited SSH targets', async t => {
  const { calls, id, engine, jump, nodes, namedButton, contains, mock, props, flush } = await mountLogWindow(t)
  assert.deepEqual(calls, [[engine.settings, id, engine.id]])
  assert.ok(nodes().some(el => el.props.class === 'document-window-titlebar'))
  assert.ok(namedButton('最小化') && namedButton('最大化'))
  assert.ok(contains('worker'))
  assert.ok(contains('该容器暂无日志'))

  engine.name = 'Renamed'
  mock.logs = async () => { throw Error('engine offline') }
  await namedButton('刷新日志').onClick()
  await flush()
  assert.ok(contains('engine offline'))
  mock.logs = async () => 'stdout\n<stderr>\n'
  const retry = nodes().find(el => el.type === 'button' && all(el).some(n => n.text === '重试'))
  await retry.props.onClick()
  await flush()
  assert.equal(nodes().find(el => el.type === 'pre').text, 'stdout\n<stderr>\n')

  let resolve
  mock.logs = () => new Promise(done => { resolve = done })
  const pending = namedButton('刷新日志').onClick()
  await flush()
  jump.host = 'another-gateway'
  await flush()
  resolve('stale')
  await pending
  assert.equal(namedButton('刷新日志').disabled, true)
  assert.ok(contains('关闭此窗口后从容器列表重新打开日志'))
  assert.equal(nodes().find(el => el.type === 'pre'), undefined)
  props.containerId = 'invalid'
  await flush()
  assert.ok(contains('日志窗口缺少有效'))
  props.containerId = 'b'.repeat(64)
  props.connectionId = 'deleted'
  await flush()
  assert.ok(contains('找不到此日志窗口'))
  namedButton('关闭').onClick()
  assert.equal(mock.closed, true)
})

test('Docker live output starts at the bottom, follows reader intent, bounds history, and cancels stale streams', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const history = Array.from({length: 200}, (_, i) => 'snapshot ' + i + '\n').join('')
  const { calls, nodes, namedButton, mock, flush, displayed, jump, contains } = await mountLogWindow(t, history)
  const streams = []
  mock.follow = (_settings, _id, _connection, text) => {
    const job = { text, stopped: false }
    const done = new Promise((resolve, reject) => Object.assign(job, {resolve, reject}))
    streams.push(job)
    return { done, stop: async () => { job.stopped = true; job.resolve() } }
  }
  const pre = () => nodes().find(el => el.type === 'pre')
  const bottom = () => pre().scrollHeight - pre().clientHeight
  const setLive = enabled => nodes().find(el => el.props.role === 'switch').props['onUpdate:modelValue'](enabled)
  const scrollTo = top => { pre().scrollTop = top; pre().props.onScrollPassive() }
  const draw = async () => { t.mock.timers.tick(50); await flush() }
  assert.equal(pre().scrollTop, bottom())
  assert.equal(streams.length, 0)
  scrollTo(60)
  await namedButton('刷新日志').onClick()
  await flush()
  assert.equal(pre().scrollTop, 60)
  setLive(true)
  await flush()
  streams[0].text(history)
  streams[0].text('line from stream\n')
  await draw()
  assert.equal(pre().text, history + 'line from stream\n')
  assert.equal(pre().scrollTop, 60)
  scrollTo(bottom() - 5)
  streams[0].text('partial ')
  streams[0].text('line\n')
  await draw()
  assert.ok(pre().text.endsWith('partial line\n'))
  assert.equal(pre().scrollTop, bottom())
  setLive(false)
  assert.equal(streams[0].stopped, true)
  streams[0].text('ignored after stop')
  setLive(true)
  await flush()
  streams[1].text('new stream\n')
  streams[1].text('x\n'.repeat(9000) + 'latest\n')
  await draw()
  assert.equal(pre().text.split('\n').length, 4001)
  assert.ok(pre().text.endsWith('latest\n'))
  assert.ok(contains('较早输出已省略'))
  streams[1].text('y'.repeat(700000))
  await draw()
  assert.equal(pre().text.length, 512 * 1024)
  streams[1].reject(Error('follow failed'))
  await flush()
  assert.ok(contains('follow failed'))
  const retry = nodes().find(el => el.type === 'button' && all(el).some(n => n.text === '重试'))
  void retry.props.onClick()
  await flush()
  assert.equal(streams.length, 3)
  streams[2].text('final\n')
  streams[2].resolve()
  await flush()
  assert.ok(contains('日志流已结束'))
  assert.equal(pre().text, 'final\n')
  setLive(true)
  await flush()
  jump.host = 'changed gateway'
  await flush()
  assert.ok(streams[3].stopped)
  assert.ok(contains('关闭此窗口后从容器列表重新打开日志'))
  assert.equal(calls.length, 2)
  displayed.value = false
  await flush()
  displayed.value = true
  await flush()
  setLive(true)
  await flush()
  displayed.value = false
  await flush()
  assert.ok(streams[4].stopped)
})

test('database content is shown in main tabs with connection-specific identity and working close/add/activation', async t => {
  const records = reactive({
    one: {
      active: 'same',
      tabs: [{ id: 'same', label: 'Users @demo', closable: true }],
    },
    two: {
      active: 'same',
      tabs: [{ id: 'same', label: 'Users @other', closable: true }],
    },
  })
  let active = 'one'
  const mainTabs = shallowRef('one')
  const closed = []
  const root = mount(
    {
      setup() {
        const registry = provideDatabaseWorkspaceTabs()
        for (const [id, record] of Object.entries(records))
          registry.set(id, {
            tabs: () => record.tabs,
            activeId: () => record.active,
            select: value => {
              record.active = value
            },
            add: () =>
              record.tabs.push({
                id: 'new',
                label: 'New query',
                closable: true,
              }),
            close: ids => {
              closed.push([id, ids])
              record.tabs = record.tabs.filter(tab => !ids.includes(tab.id))
            },
            reorder() {},
            contextItems: () => [],
            action: async () => {},
          })
        return () =>
          h(WorkspaceTabBar, {
            tabs: workspaceViewTabs(
              ['one', 'two'].map(id => ({
                id,
                connection: connection(id, id),
                status: 'connected',
                sessionId: id,
              })),
              registry
            ),
            active: mainTabs.value,
            closeWarning: () => '',
            'onUpdate:active': id => {
              active = id
              mainTabs.value = id
            },
          })
      },
    },
    t
  )
  const nav = () => all(root).find(el => el.props['data-main-tabs'])
  const one = databaseWorkspaceTabId('one', 'same'),
    two = databaseWorkspaceTabId('two', 'same')
  assert.notEqual(one, two)
  assert.deepEqual(
    nav().props.items.map(tab => tab.id),
    ['one', one, 'two', two]
  )
  nav().props.onSelect(two)
  await nextTick()
  assert.equal(active, two)
  assert.equal(records.two.active, 'same')
  assert.equal(nav().props.active, two)
  nav().props.onAdd()
  await nextTick()
  assert.equal(records.two.tabs.length, 2)
  nav().props.onClose(one)
  await nextTick()
  assert.deepEqual(closed, [['one', ['same']]])
  assert.equal(records.two.tabs.length, 2)
  nav().props.onSelect('two')
  await nextTick()
  assert.equal(records.two.active, '')
})

test('关闭数据库总览只移除入口，其他分屏的表和未保存查询继续保留', async t => {
  const connections = reactive([
    {
      id: 'db',
      connection: connection('db', '数据库'),
      status: 'connected',
      sessionId: 'original-session',
    },
  ])
  const record = reactive({
    active: 'table',
    tabs: [
      { id: 'table', label: 'Users', closable: true },
      { id: 'query', label: 'SQL 草稿', closable: true },
    ],
  })
  const closedContents = [],
    closedConnections = [],
    hidden = [],
    warnings = []
  const root = mount(
    {
      setup() {
        const registry = provideDatabaseWorkspaceTabs()
        registry.set('db', {
          tabs: () => record.tabs,
          activeId: () => record.active,
          select: id => {
            record.active = id
          },
          add() {},
          close: ids => {
            closedContents.push(ids)
          },
          reorder() {},
          contextItems: () => [],
          action: async () => {},
        })
        return () =>
          h(WorkspaceTabBar, {
            // 当前分屏只有总览；表和查询位于其他分屏，关闭时仍须检查全局注册表。
            tabs: workspaceViewTabs(connections, registry).filter(
              tab => !tab.contentId
            ),
            active: 'db',
            closeWarning: ids => {
              warnings.push(ids)
              return ids.length ? '有未保存草稿' : ''
            },
            onCloseOverview: id => {
              hidden.push(id)
              connections[0].databaseOverviewClosed = true
            },
            onCloseMany: ids => {
              closedConnections.push(ids)
            },
          })
      },
    },
    t
  )
  all(root)
    .find(el => el.props['data-main-tabs'])
    .props.onClose('db')
  await nextTick()
  assert.deepEqual(hidden, ['db'])
  assert.deepEqual(closedConnections, [])
  assert.deepEqual(closedContents, [])
  assert.deepEqual(warnings, [[]])
  assert.equal(connections[0].sessionId, 'original-session')
  assert.equal(record.active, 'table')
  assert.equal(record.tabs.length, 2)
  assert.deepEqual(
    all(root).find(el => el.props['data-main-tabs']).props.items,
    []
  )
})

test('批量关闭总览及部分表时只关闭选中的内容，关闭全部标签时释放连接', async t => {
  const record = reactive({
    tabs: [
      { id: 'a', label: 'Table A', closable: true },
      { id: 'b', label: 'Table B', closable: true },
    ],
  })
  const closedContents = [],
    closedConnections = [],
    hidden = []
  const root = mount(
    {
      setup() {
        const registry = provideDatabaseWorkspaceTabs()
        registry.set('db', {
          tabs: () => record.tabs,
          activeId: () => 'a',
          select() {},
          add() {},
          reorder() {},
          close: ids => {
            closedContents.push(ids)
            record.tabs = record.tabs.filter(tab => !ids.includes(tab.id))
          },
          contextItems: () => [],
          action: async () => {},
        })
        return () =>
          h(WorkspaceTabBar, {
            tabs: workspaceViewTabs(
              [
                {
                  id: 'db',
                  connection: connection('db', '数据库'),
                  status: 'connected',
                  sessionId: 'session',
                },
              ],
              registry
            ),
            active: 'db',
            closeWarning: () => '',
            onCloseOverview: id => hidden.push(id),
            onCloseMany: ids => closedConnections.push(ids),
          })
      },
    },
    t
  )
  const nav = () => all(root).find(el => el.props['data-main-tabs'])
  nav().props.onCloseMany(['db', databaseWorkspaceTabId('db', 'a')])
  await nextTick()
  assert.deepEqual(hidden, ['db'])
  assert.deepEqual(closedContents, [['a']])
  assert.deepEqual(
    record.tabs.map(tab => tab.id),
    ['b']
  )
  assert.deepEqual(closedConnections, [])

  nav().props.onCloseMany(['db', databaseWorkspaceTabId('db', 'b')])
  await nextTick()
  assert.deepEqual(closedConnections, [['db']])
  assert.deepEqual(closedContents, [['a']])
})

test('virtual file list selection supports Ctrl, Shift, drag range and offscreen autoscroll', async t => {
  const oldRaf = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame
  let onFrame
  globalThis.requestAnimationFrame = callback => {
    onFrame = callback
    return 1
  }
  globalThis.cancelAnimationFrame = () => {}
  const files = shallowRef(
    Array.from({ length: 30 }, (_, index) => ({ path: '/file-' + index }))
  )
  const selected = shallowRef([]),
    focused = shallowRef('')
  let selection
  const element = {
    scrollTop: 0,
    scrollLeft: 0,
    clientWidth: 300,
    clientHeight: 160,
    focus() {},
    setPointerCapture() {},
    hasPointerCapture() {
      return false
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 300, bottom: 160 }
    },
  }
  mount(
    {
      setup() {
        selection = useRemoteFileSelection(
          files,
          selected,
          focused,
          shallowRef(element),
          (paths, focus) => {
            selected.value = paths
            focused.value = focus
          },
          32
        )
        return () => null
      },
    },
    t
  )
  t.after(() => {
    globalThis.requestAnimationFrame = oldRaf
    globalThis.cancelAnimationFrame = oldCancel
  })
  selection.select(1)
  selection.select(3, false, true)
  assert.deepEqual(selected.value, ['/file-1', '/file-3'])
  selection.select(5, true)
  assert.deepEqual(selected.value, ['/file-3', '/file-4', '/file-5'])
  selection.pointerDown({
    button: 0,
    pointerId: 1,
    clientX: 240,
    clientY: 10,
    target: { closest: () => null },
    preventDefault() {},
  })
  selection.pointerMove({ pointerId: 1, clientX: 40, clientY: 110 })
  assert.deepEqual(selected.value, ['/file-0', '/file-1', '/file-2', '/file-3'])
  assert.equal(selection.box.value.width, 200)
  selection.pointerMove({ pointerId: 1, clientX: 40, clientY: 190 })
  onFrame()
  assert.ok(element.scrollTop > 0)
  assert.ok(selected.value.includes('/file-5'))
  selection.stopDrag()
  assert.equal(selection.box.value, null)
  assert.ok(selected.value.includes('/file-5'))
})

test('moving one database content tab keeps SSH and sibling tabs in place and preserves both editors', async t => {
  const a = databaseWorkspaceTabId('db', 'a'),
    b = databaseWorkspaceTabId('db', 'b')
  const tabs = shallowRef([{ id: 'db' }, { id: 'ssh' }, { id: a }, { id: b }])
  const active = shallowRef(a)
  const left = node('left'),
    right = node('right')
  const drafts = reactive({ a: 'SELECT first', b: 'SELECT second' })
  const mounts = [],
    unmounts = []
  let layout, rootId
  const Editor = {
    props: ['id'],
    setup(props) {
      mounts.push(props.id)
      onUnmounted(() => unmounts.push(props.id))
      return () =>
        h('input', {
          'data-editor': props.id,
          value: drafts[props.id],
          onInput: value => {
            drafts[props.id] = value
          },
        })
    },
  }
  const root = mount(
    {
      setup() {
        layout = useWorkspaceTabSplit({
          tabs: () => tabs.value,
          activeId: () => active.value,
          enabled: () => true,
        })
        provideWorkspaceTabSplit(layout)
        rootId = layout.groups.value[0].id
        layout.setTarget(rootId, left)
        return () =>
          h(
            DatabaseTabWorkspace,
            {
              tabs: [
                { id: 'a', label: 'A' },
                { id: 'b', label: 'B' },
              ],
              active: '',
              connectionId: 'db',
              workspaceHostId: 'db',
            },
            { default: ({ tab }) => h(Editor, { id: tab.id }) }
          )
      },
    },
    t
  )
  await nextTick()
  const first = all(left).find(el => el.props['data-editor'] === 'a')
  first.props.onInput('SELECT edited')
  assert.equal(layout.moveTab(b, rootId, 'right'), true)
  const destination = layout.groupForTab(b).id
  layout.setTarget(destination, right)
  active.value = b
  await nextTick()
  assert.deepEqual(layout.groupForTab('ssh').tabIds, ['db', 'ssh', a])
  assert.deepEqual(layout.groupForTab(b).tabIds, [b])
  assert.equal(layout.groupForTab(a).activeId, a)
  assert.equal(
    all(left).find(el => el.props['data-editor'] === 'a'),
    first
  )
  assert.equal(first.props.value, 'SELECT edited')
  assert.equal(
    all(right).find(el => el.props['data-editor'] === 'b').props.value,
    'SELECT second'
  )
  assert.deepEqual(mounts, ['a', 'b'])
  const current = layout.groupForTab(b).id
  layout.mergeGroup(current)
  await nextTick()
  assert.equal(
    all(left).find(el => el.props['data-editor'] === 'a'),
    first
  )
  assert.deepEqual(mounts, ['a', 'b'])
  assert.deepEqual(unmounts, [])
})
