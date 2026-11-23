import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const vue = JSON.stringify(import.meta.resolve('vue'))
const vueBoundary = dataModule(
  `export * from ${vue}; export const vModelText = {}`
)
const workspaceBoundary = dataModule(`
  import { reactive, shallowRef, computed, toRefs, h, onUnmounted } from ${vue};
  export const state = reactive({session:{sessionId:'s1',database:'0',endpoint:'unit'},status:'connected',error:'',errorKind:'',needsPassword:false,busy:false,keys:[],cursor:'0',detail:null,result:null});
  export const visibility = shallowRef('visible');
  export const events = []; export const calls = [];
  export function panel(name) { return {props:['sessionId','database','active','detail'],emits:['open','dirty'],setup(props,{emit}) { const context=props.sessionId+':'+props.database; events.push(['mount',name,context]); onUnmounted(()=>events.push(['unmount',name,context])); return ()=>h('div',{'data-panel':name,session:props.sessionId,database:props.database,active:props.active,onOpen:key=>emit('open',key),onDirty:value=>emit('dirty',value)}); }} }
  export const useRedisSession = ()=>({...toRefs(state),connected:computed(()=>state.status==='connected'&&!!state.session),connect:async()=>{},disconnect:async()=>{},scan:async()=>{},inspect:async key=>calls.push(['inspect',key]),switchDatabase:async()=>{},execute:async()=>{},saveString:async()=>{},deleteKey:async()=>{},expireKey:async()=>{}});
  export const useDatabaseSidebarWidth = ()=>({width:shallowRef(240),min:160,max:400,style:{width:'240px'}});
  export const useAgentPaneWidth = ()=>({width:shallowRef(320),min:200,max:600,style:{width:'320px'}});
  export const useDocumentVisibility = ()=>visibility;
`)
const ui = dataModule(`
  import {h} from ${vue};
  export const Button = {props:['icon','title','disabled'],setup:props=>()=>h('button',{'data-icon':props.icon,disabled:props.disabled,title:props.title})};
  export const Select = {props:['modelValue','disabled'],emits:['update:modelValue'],setup:(props,{emit})=>()=>h('select',{'data-select':true,value:props.modelValue,disabled:props.disabled,onSelect:value=>emit('update:modelValue',value)})};
  export const Confirm = {props:['open'],emits:['confirm','close'],setup:(props,{emit})=>()=>h('div',{'data-confirm':true,open:props.open,onConfirm:()=>emit('confirm'),onClose:()=>emit('close')})};
  export const Tabs = {props:['tabs','active'],emits:['update:active'],setup:(props,{emit})=>()=>h('nav',{'data-tabs':true,items:props.tabs,active:props.active,onSelect:id=>emit('update:active',id)})};
`)
/** 给公共 UI 提供保留事件与属性的轻量宿主，业务组件和模板仍使用实际源码。 */
function uiComponent(name) {
  return dataModule(`export { ${name} as default } from ${JSON.stringify(ui)}`)
}
/** 用挂载/卸载探针替代其他工具，验证主页面的按需挂载和上下文边界。 */
function probe(name) {
  return dataModule(
    `import {panel} from ${JSON.stringify(workspaceBoundary)}; export default panel(${JSON.stringify(name)});`
  )
}
const apiBoundary = dataModule(`
  export const mock = {calls:[], notices:[], info:null, log:null, reset:null};
  export async function serverInfo(id){mock.calls.push(['info',id]);return mock.info(id)}
  export async function slowlog(id,count){mock.calls.push(['log',id,count]);return mock.log(id,count)}
  export async function slowlogReset(id){mock.calls.push(['reset',id]);return mock.reset(id)}
  export const errorMessage = error=>error.message??String(error);
  export const toast = {error:value=>mock.notices.push(['error',value]),success:value=>mock.notices.push(['success',value])};
  export async function copyText(){}
`)
const { state, events, calls, visibility } = await import(workspaceBoundary)
const { mock } = await import(apiBoundary)
const common = {
  vue: vueBoundary,
  '@/components/ui/IconButton.vue': uiComponent('Button'),
  '@/components/ui/AppSelect.vue': uiComponent('Select'),
  '@/components/ui/AppConfirmDialog.vue': uiComponent('Confirm'),
  '@/composables/useToast': apiBoundary,
}
const workspaceLoad = sourceLoader(
  {
    ...common,
    '@vueuse/core': workspaceBoundary,
    '@/composables/useRedisSession': workspaceBoundary,
    '@/composables/useDatabaseSidebarWidth': workspaceBoundary,
    '@/composables/useAgentPaneWidth': workspaceBoundary,
    '@/components/ui/TabBar.vue': uiComponent('Tabs'),
    '@/components/workspace/redis/RedisKeyBrowser.vue': probe('browser'),
    '@/components/workspace/redis/RedisKeyDetail.vue': probe('detail'),
    '@/components/workspace/redis/RedisConsole.vue': probe('console'),
    '@/components/workspace/redis/RedisServerPanel.vue': probe('server'),
    '@/components/workspace/redis/RedisBigKeyPanel.vue': probe('bigkeys'),
    '@/components/workspace/redis/RedisPubSubPanel.vue': probe('pubsub'),
  },
  ['src/pages/databases/components/redis-view.vue']
)
const panelLoad = sourceLoader(
  { ...common, '@/api/redis': apiBoundary, '@/utils/clipboard': apiBoundary },
  [
    'src/components/workspace/redis/RedisServerPanel.vue',
    'src/components/workspace/redis/RedisSlowlogPanel.vue',
    'src/components/ui/AppButton.vue',
  ]
)
const { default: Workspace } = await workspaceLoad(
  'src/pages/databases/components/redis-view.vue'
)
const { default: Server } = await panelLoad(
  'src/components/workspace/redis/RedisServerPanel.vue'
)
const { default: Slowlog } = await panelLoad(
  'src/components/workspace/redis/RedisSlowlogPanel.vue'
)
const { i18n } = await workspaceLoad('src/i18n/index.ts')
const { i18n: panelI18n } = await panelLoad('src/i18n/index.ts')
i18n.global.locale.value = panelI18n.global.locale.value = 'zh-CN'

/** 轻量 renderer 保存真实模板的属性、文本和显隐样式，不访问浏览器。 */
function node(type, text = '') {
  return markRaw({
    type,
    text,
    props: {},
    style: {},
    children: [],
    parent: null,
    addEventListener() {},
    removeEventListener() {},
    getRootNode() {
      return null
    },
  })
}
const renderer = createRenderer({
  createElement: node,
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
/** 遍历虚拟宿主，用实际渲染的标签、按钮及属性断言行为。 */
function all(el) {
  return [el, ...el.children.flatMap(all)]
}
/** 汇总实际文本，检查迟到快照不会污染新连接。 */
function text(el) {
  return [el.text, ...el.children.map(text)].join(' ')
}
/** 等待 Vue 更新和有限的 Promise 微任务链。 */
async function flush() {
  for (let i = 0; i < 12; i++) await nextTick()
}
/** 创建可控制返回时序的 IPC Promise。 */
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
/** 挂载实际组件，在测试结束时释放其 watcher 和定时器。 */
function mount(t, Component, initial, locale = panelI18n) {
  const props = reactive(initial),
    root = node('root')
  const app = renderer.createApp({ render: () => h(Component, props) })
  app.use(locale).mount(root)
  t.after(() => app.unmount())
  return { props, root, app }
}
/** 提供只含可识别测试标记的 INFO 快照，不伪装成真实服务器。 */
function info(marker) {
  return [
    {
      name: 'Server',
      entries: [
        ['redis_version', marker],
        ['used_memory', '1024'],
      ],
    },
  ]
}
/** 提供一条用于清空确认测试的慢日志。 */
function log(marker) {
  return {
    total: 1,
    entries: [
      {
        id: 1,
        timestamp: 1,
        durationUs: 100,
        args: ['GET', marker],
        client: 'unit',
        clientName: '',
      },
    ],
  }
}
/** 重置 IPC 边界，保持每项测试互不污染。 */
function resetApi() {
  mock.calls = []
  mock.notices = []
  mock.info = async id => info(id)
  mock.log = async id => log(id)
  mock.reset = async () => {}
}
/** 初始化主工作区，只模拟会话边界，不发起连接。 */
function mountWorkspace(t) {
  events.length = 0
  calls.length = 0
  visibility.value = 'visible'
  Object.assign(state, {
    session: { sessionId: 's1', database: '0', endpoint: 'unit' },
    status: 'connected',
    busy: false,
    error: '',
    detail: null,
  })
  return mount(
    t,
    Workspace,
    {
      connection: { id: 'redis', name: 'Unit Redis', kind: 'redis' },
      active: true,
    },
    i18n
  )
}

test('Redis tools mount on demand, retain internal tabs and release on DB switch or disconnect', async t => {
  const { root } = mountWorkspace(t)
  await flush()
  const nav = all(root).find(el => el.props['data-tabs'])
  assert.deepEqual(
    nav.props.items.map(item => item.id),
    ['keys', 'command', 'server', 'bigkeys', 'pubsub']
  )
  assert.equal(
    events.filter(event => ['server', 'bigkeys', 'pubsub'].includes(event[1]))
      .length,
    0
  )
  nav.props.onSelect('server')
  await flush()
  assert.equal(
    events.filter(event => event[0] === 'mount' && event[1] === 'server')
      .length,
    1
  )
  assert.equal(
    all(root).find(el => el.props['data-panel'] === 'browser').style.display,
    'none'
  )
  nav.props.onSelect('keys')
  await flush()
  nav.props.onSelect('server')
  await flush()
  assert.equal(
    events.filter(event => event[0] === 'mount' && event[1] === 'server')
      .length,
    1
  )
  nav.props.onSelect('bigkeys')
  await flush()
  nav.props.onSelect('pubsub')
  await flush()
  state.session = { sessionId: 's1', database: '2', endpoint: 'unit' }
  await flush()
  assert.ok(
    events.some(event => event[0] === 'unmount' && event[1] === 'bigkeys')
  )
  assert.ok(
    events.some(
      event =>
        event[0] === 'unmount' && event[1] === 'pubsub' && event[2] === 's1:0'
    )
  )
  assert.equal(
    all(root).find(el => el.props['data-panel'] === 'pubsub').props.database,
    '2'
  )
  state.status = 'disconnected'
  state.session = null
  await flush()
  assert.ok(
    !all(root).some(el =>
      ['server', 'bigkeys', 'pubsub'].includes(el.props['data-panel'])
    )
  )
})

test('Redis monitoring follows workspace visibility and big-key navigation preserves dirty guard', async t => {
  const { root, props } = mountWorkspace(t)
  await flush()
  const nav = all(root).find(el => el.props['data-tabs'])
  nav.props.onSelect('server')
  await flush()
  const server = () => all(root).find(el => el.props['data-panel'] === 'server')
  assert.equal(server().props.active, true)
  props.active = false
  await flush()
  assert.equal(server().props.active, false)
  props.active = true
  visibility.value = 'hidden'
  await flush()
  assert.equal(server().props.active, false)
  visibility.value = 'visible'
  nav.props.onSelect('bigkeys')
  await flush()
  all(root)
    .find(el => el.props['data-panel'] === 'detail')
    .props.onDirty(true)
  await flush()
  const key = { id: 'aw==', name: 'k' }
  all(root)
    .find(el => el.props['data-panel'] === 'bigkeys')
    .props.onOpen(key)
  await flush()
  assert.deepEqual(calls, [])
  const confirm = all(root).find(el => el.props['data-confirm'])
  assert.equal(confirm.props.open, true)
  confirm.props.onConfirm()
  await flush()
  assert.deepEqual(calls, [['inspect', key]])
  assert.equal(nav.props.active, 'keys')
})

test('Server INFO ignores stale sessions and hidden failures, and pauses polling', async t => {
  resetApi()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = deferred()
  mock.info = id =>
    id === 'OLD' ? pending.promise : Promise.resolve(info('CURRENT'))
  const { props, root } = mount(t, Server, { sessionId: 'OLD', active: false })
  await flush()
  assert.equal(mock.calls.length, 0)
  props.active = true
  await flush()
  props.sessionId = 'NEW'
  await flush()
  assert.match(text(root), /CURRENT/)
  pending.resolve(info('STALE'))
  await flush()
  assert.doesNotMatch(text(root), /STALE/)
  const before = mock.calls.length
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(mock.calls.length, before + 1)
  props.active = false
  await flush()
  const paused = mock.calls.length
  t.mock.timers.tick(20000)
  await flush()
  assert.equal(mock.calls.length, paused)
  const late = deferred()
  mock.info = () => late.promise
  props.active = true
  await flush()
  props.active = false
  await flush()
  late.reject(new Error('old-failure'))
  await flush()
  assert.deepEqual(mock.notices, [])
})

test('Slowlog requires reset confirmation and cannot reload a new session from an old RESET', async t => {
  resetApi()
  const pending = deferred()
  mock.reset = () => pending.promise
  const { props, root } = mount(t, Slowlog, { sessionId: 'OLD', active: false })
  await flush()
  assert.equal(mock.calls.length, 0)
  props.active = true
  await flush()
  assert.deepEqual(mock.calls, [['log', 'OLD', 128]])
  const button = all(root).find(
    el => el.type === 'button' && text(el).trim() === '清空慢日志'
  )
  assert.ok(button)
  button.props.onClick()
  await flush()
  assert.ok(!mock.calls.some(call => call[0] === 'reset'))
  all(root)
    .find(el => el.props['data-confirm'])
    .props.onConfirm()
  await flush()
  assert.ok(mock.calls.some(call => call[0] === 'reset' && call[1] === 'OLD'))
  props.sessionId = 'NEW'
  await flush()
  const callsBefore = mock.calls.length
  pending.resolve()
  await flush()
  assert.equal(mock.calls.length, callsBefore)
  assert.match(text(root), /NEW/)
  assert.doesNotMatch(text(root), /GET OLD/)
})

test('Slowlog ignores late reads after a connection change', async t => {
  resetApi()
  const pending = deferred()
  mock.log = id =>
    id === 'OLD' ? pending.promise : Promise.resolve(log('LATEST'))
  const { props, root } = mount(t, Slowlog, { sessionId: 'OLD', active: true })
  await flush()
  props.sessionId = 'NEW'
  await flush()
  pending.resolve(log('STALE'))
  await flush()
  assert.match(text(root), /LATEST/)
  assert.doesNotMatch(text(root), /STALE/)
})
