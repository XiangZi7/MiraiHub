import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { createPinia } from 'pinia'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const vue = JSON.stringify(import.meta.resolve('vue'))
const boundary = dataModule(`
  export const mock = { calls: [], pending: null, history: [] }
  export async function connect(config) {
    mock.calls.push(['connect', config]);
    return { sessionId:'db-' + config.kind + '-' + config.host, database:config.database || 'alpha', endpoint:config.host, serverVersion:'fixture' }
  }
  export async function disconnect(id) { mock.calls.push(['disconnect', id]) }
  export async function listDatabases() { return ['alpha','beta','gamma'] }
  export async function listObjects() { return [] }
  export async function useDatabase(id, name) { mock.calls.push(['useDatabase', id, name]); return {sessionId:id,database:name,endpoint:'fixture',serverVersion:'fixture'} }
  export async function completionColumns() { return [] }
  export async function completionTableColumns() { return [] }
  export async function describeObject() { return [] }
  export async function execute(...args) {
    mock.calls.push(['execute', ...args]);
    if (mock.pending) await mock.pending.promise;
    return { statements:[{statement:args[1],offset:0,columns:[],rows:[],rowsAffected:0,error:null}],elapsedMs:1,cancelled:false }
  }
  export async function cancelQuery(id) { mock.calls.push(['cancelQuery', id]); mock.pending?.resolve(); mock.pending = null }
  export function errorMessage(error) { return String(error) }
  export function isAppError() { return false }
  export function listQueryHistory() { return mock.history }
  export function addQueryHistory(value) { return { ...value, id:'execution-history' } }
  export function updateQueryHistory() {}
  export function clearQueryHistory(id) { mock.calls.push(['clearQueryHistory', id]); mock.history = [] }
`)
const { mock } = await import(boundary)

/** 替换需要真实数据库的对话框，仅保留开关、目标与焦点，菜单与关键控件仍真实渲染。 */
function dialog(id) {
  return dataModule(`
    import { h } from ${vue};
    export default {
      props:['open','sessionId','databaseName','initialValue'], emits:['close','submit'],
      setup(props,{emit}) {
        return () => props.open === false ? null : h('dialog',{
          'data-dialog':${JSON.stringify(id)},'data-session':props.sessionId,'data-database':props.databaseName,'data-initial':props.initialValue,
          onVnodeMounted:vnode=>vnode.el.focus()
        },[
          h('button',{'data-dialog-close':${JSON.stringify(id)},onClick:()=>emit('close')},'Close'),
          h('button',{'data-dialog-submit':${JSON.stringify(id)},onClick:()=>emit('submit','Saved query A')},'Submit')
        ])
      }
    }
  `)
}
const load = sourceLoader(
  {
    vue: dataModule(`
    export * from ${vue};
    import { defineComponent } from ${vue};
    export const Transition = defineComponent({inheritAttrs:false,setup:(_props,{slots})=>()=>slots.default?.()});
    export const vModelText = {};
  `),
    '@/api/database': boundary,
    '@/api/database-history': boundary,
    '@/utils/window': dataModule(
      'export const IS_TAURI=false; export function openConnectionWindow() {}'
    ),
    '@/composables/useToast': dataModule(
      'export const toast={success(){},error(){},warning(){},info(){}}'
    ),
    '@/components/ui/AppIcon.vue': dataModule(
      `import {h} from ${vue}; export default {props:['name'],setup:props=>()=>h('i',{'data-icon':props.name})}`
    ),
    '@/components/workspace/database/DatabaseQueryPane.vue': dataModule(`
    import {h} from ${vue};
    export default {props:['modelValue','databaseName'],setup(props,{expose}){
      expose({runnableSql:()=>props.modelValue});
      return ()=>h('section',{'data-query-database':props.databaseName,'data-query-sql':props.modelValue});
    }}
  `),
    '@/components/workspace/database/DatabaseTableOverview.vue': dataModule(`
    import {h} from ${vue};
    export default {emits:['open'],setup:(_props,{emit})=>()=>h('button',{'data-open-table':true,onClick:()=>emit('open',{schema:'alpha',name:'users',kind:'table',identity:'',comment:'',rowEstimate:null})},'Open users')}
  `),
    '@/components/workspace/database/DatabaseTableView.vue': dataModule(`
    import {h} from ${vue};
    export default {props:['object'],setup:(props,{slots})=>()=>h('section',{'data-table':props.object.name},slots.toolbar?.())}
  `),
    '@/components/workspace/database/ErDiagramView.vue': dialog('er-diagram'),
    '@/components/workspace/database/DatabaseSchemaDiffDialog.vue':
      dialog('schema-diff'),
    '@/components/workspace/database/DatabaseDocDialog.vue':
      dialog('data-dictionary'),
    '@/components/workspace/database/DatabaseBackupDialog.vue':
      dialog('backup-database'),
    '@/components/workspace/database/DatabaseSessionMonitor.vue':
      dialog('session-monitor'),
    '@/components/workspace/database/DatabaseUserManager.vue':
      dialog('user-manager'),
    '@/components/workspace/database/DatabaseObjectNameDialog.vue':
      dialog('save-query'),
  },
  [
    'src/components/workspace/DatabaseView.vue',
    'src/components/workspace/database/DatabaseTabWorkspace.vue',
    'src/components/ui/AppButton.vue',
    'src/components/ui/IconButton.vue',
    'src/components/ui/AppSelect.vue',
    'src/components/ui/AppContextMenu.vue',
  ]
)
const { default: DatabaseView } = await load(
  'src/components/workspace/DatabaseView.vue'
)
const { provideDatabaseWorkspaceTabs } = await load(
  'src/composables/useDatabaseWorkspaceTabs.ts'
)
const { i18n } = await load('src/i18n/index.ts')
i18n.global.locale.value = 'zh-CN'

/** 遍历虚拟 DOM，而不是按源码字符串断言分组或 dispatch。 */
const all = element => [element, ...element.children.flatMap(all)]
/** 读取控件真实渲染文本。 */
const text = element =>
  (element.type === '#comment' ? '' : element.text) +
  element.children.map(text).join('')
let documentFixture
/** 为真实菜单/选择器提供最小 DOM 边界，包括定位、键盘焦点和 Teleport。 */
function node(type, value = '') {
  return markRaw({
    type,
    text: value,
    props: {},
    children: [],
    parent: null,
    style: {},
    isConnected: false,
    offsetWidth: 200,
    offsetHeight: 180,
    clientHeight: 180,
    offsetTop: 0,
    scrollTop: 0,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return {
        left: 12,
        right: 152,
        top: 16,
        bottom: 48,
        width: 140,
        height: 32,
      }
    },
    getRootNode() {
      return documentFixture
    },
    focus() {
      this.focusCount = (this.focusCount ?? 0) + 1
      if (documentFixture) documentFixture.activeElement = this
    },
    contains(target) {
      for (let current = target; current; current = current.parent)
        if (current === this) return true
      return false
    },
    closest(selector) {
      for (let current = this; current; current = current.parent)
        if (current.props.class?.includes(selector.slice(1))) return current
      return null
    },
    querySelectorAll(selector) {
      const nodes = all(this).slice(1)
      if (selector.includes('menuitem'))
        return nodes.filter(
          item =>
            item.props.role === 'menuitem' &&
            (!selector.includes(':disabled') || !item.props.disabled)
        )
      return []
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null
    },
  })
}
let body
const renderer = createRenderer({
  querySelector: selector => (selector === 'body' ? body : null),
  createElement: type => node(type),
  createText: value => node('#text', value),
  createComment: value => node('#comment', value),
  setText: (element, value) => {
    element.text = value
  },
  setElementText: (element, value) => {
    element.text = value
    element.children = []
  },
  patchProp(element, key, _old, value) {
    element.props[key] = value
    if (key === 'style' && value) Object.assign(element.style, value)
  },
  parentNode: element => element.parent,
  nextSibling: element =>
    element.parent?.children[element.parent.children.indexOf(element) + 1] ??
    null,
  insert(element, parent, anchor) {
    if (element.parent)
      element.parent.children.splice(
        element.parent.children.indexOf(element),
        1
      )
    element.parent = parent
    element.isConnected = true
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(
      index < 0 ? parent.children.length : index,
      0,
      element
    )
  },
  remove(element) {
    if (element.parent)
      element.parent.children.splice(
        element.parent.children.indexOf(element),
        1
      )
    element.isConnected = false
  },
})
/** 等待真实组件的挂载、菜单定位及会话元数据响应。 */
async function flush() {
  for (let i = 0; i < 24; i++) await nextTick()
}
/** 建立只替换 IPC/宿主的独立数据库视图。 */
async function fixture(t, kind = 'mysql') {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  }
  const storage = new Map()
  globalThis.window = Object.assign(new EventTarget(), {
    innerWidth: 320,
    innerHeight: 720,
  })
  documentFixture = Object.assign(new EventTarget(), {
    activeElement: null,
    getElementById: id =>
      [...all(root), ...all(body)].find(element => element.props.id === id) ??
      null,
  })
  globalThis.document = documentFixture
  body = node('body')
  body.isConnected = true
  const root = node('root')
  root.isConnected = true
  const tabs = [
    {
      id: 'query-a',
      label: 'Query A',
      sql: 'SELECT alpha',
      database: 'alpha',
      savedQueryId: null,
    },
    {
      id: 'query-b',
      label: 'Query B',
      sql: 'SELECT beta',
      database: 'beta',
      savedQueryId: null,
    },
  ]
  storage.set(
    'miraihub.database-query-workspace.v1:toolbar-test',
    JSON.stringify({ activeId: 'query-a', tabs })
  )
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  }
  mock.calls = []
  mock.pending = null
  mock.history = [
    {
      id: 'old-query',
      connectionId: 'toolbar-test',
      database: 'alpha',
      sql: 'SELECT history',
      executedAt: 1,
    },
  ]
  const state = reactive({
    active: true,
    connection: {
      id: 'toolbar-test',
      kind,
      name: 'Toolbar fixture',
      host: kind === 'sqlite' ? 'fixture.db' : 'fixture.invalid',
      port: 3306,
      username: 'fixture',
      settings: { database: 'alpha', password: '', ssl: false },
      tags: [],
      group: '',
      tagColor: 'green',
      createdAt: 1,
      updatedAt: 1,
    },
  })
  let registry
  const errors = []
  const app = renderer.createApp({
    setup() {
      registry = provideDatabaseWorkspaceTabs()
      return () =>
        h(DatabaseView, { connection: state.connection, active: state.active })
    },
  })
  app.config.errorHandler = error => errors.push(error)
  app.use(createPinia()).use(i18n).mount(root)
  t.after(() => {
    mock.pending?.resolve()
    app.unmount()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
    documentFixture = undefined
    assert.deepEqual(errors, [])
  })
  await flush()
  const api = registry.get('toolbar-test')
  api.select('query-a')
  await flush()
  const toolbar = id => {
    const scope = id
      ? all(root).find(element => element.props['data-database-content'] === id)
      : root
    return all(scope).find(
      element => element.props['aria-label'] === '数据库工具栏'
    )
  }
  const button = (id, title) =>
    all(toolbar(id)).find(
      element => element.type === 'button' && element.props.title === title
    )
  const menu = (label = '更多') =>
    all(body).find(
      element =>
        element.props.role === 'menu' &&
        element.props['aria-label'] === label &&
        element.style.display !== 'none'
    )
  const click = element => element.props.onClick?.({ currentTarget: element })
  return {
    root,
    api,
    toolbar,
    button,
    menu,
    click,
  }
}

const tools = [
  ['ER 图', 'er-diagram'],
  ['结构对比', 'schema-diff'],
  ['数据字典', 'data-dictionary'],
  ['备份与恢复', 'backup-database'],
  ['会话监控', 'session-monitor'],
  ['用户与权限', 'user-manager'],
]

const runTitle = '执行选中内容或全部 SQL（Ctrl+Enter）'

test('查询工具栏恢复单行，行数和活动数据库仍由各自的选择器控制', async t => {
  const f = await fixture(t)
  const toolbar = f.toolbar('query-a')
  assert.ok(toolbar.children.includes(f.button('query-a', runTitle)))
  assert.equal(f.button('query-a', '更多'), undefined)
  const trigger = label => {
    const labelId = all(toolbar).find(
      element => element.type === 'label' && text(element).trim() === label
    ).props.id
    return all(toolbar).find(
      element =>
        element.props.role === 'combobox' &&
        element.props['aria-labelledby'] === labelId
    )
  }
  f.click(trigger('查询返回行数上限'))
  await flush()
  f.click(
    all(body).find(
      element =>
        element.props.role === 'option' && text(element).includes('1000 行')
    )
  )
  await flush()
  await f.click(f.button('query-a', runTitle))
  await flush()
  assert.ok(
    mock.calls.some(
      call =>
        call[0] === 'execute' && call[2] === 'SELECT alpha' && call[3] === 1000
    )
  )
  f.click(trigger('活动数据库'))
  await flush()
  f.click(
    all(body).find(
      element => element.props.role === 'option' && text(element) === 'gamma'
    )
  )
  await flush()
  assert.equal(
    all(f.root).find(
      element => element.props['data-query-sql'] === 'SELECT alpha'
    ).props['data-query-database'],
    'gamma'
  )
  assert.equal(
    all(f.root).find(
      element => element.props['data-query-sql'] === 'SELECT beta'
    ).props['data-query-database'],
    'beta'
  )
})

test('查询工具栏的六个维护按钮直接打开对应对话框', async t => {
  const f = await fixture(t)
  for (const [label, id] of tools) {
    f.click(f.button('query-a', label))
    await flush()
    assert.equal(f.menu(), undefined)
    const target = all(f.root).find(
      element => element.props['data-dialog'] === id
    )
    assert.ok(target, id)
    assert.equal(target.props['data-session'], 'db-mysql-fixture.invalid')
    assert.equal(documentFixture.activeElement, target)
    f.click(
      all(target).find(element => element.props['data-dialog-close'] === id)
    )
    await flush()
  }
})

test('单行工具栏仍可停止正在执行的查询', async t => {
  const f = await fixture(t)
  f.api.select('query-b')
  await flush()
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  mock.pending = { promise, resolve }
  const running = f.click(f.button('query-b', runTitle))
  await flush()
  const stop = f.button('query-b', '取消当前查询')
  assert.ok(stop)
  assert.ok(f.toolbar('query-b').children.includes(stop))
  assert.equal(f.button('query-b', runTitle).props.disabled, true)
  assert.ok(
    all(f.toolbar('query-b'))
      .filter(element => element.props.role === 'combobox')
      .every(element => element.props.disabled)
  )
  await f.click(stop)
  await running
  await flush()
  assert.ok(
    mock.calls.some(
      call =>
        call[0] === 'cancelQuery' && call[1] === 'db-mysql-fixture.invalid'
    )
  )
})

test('SQLite 查询工具栏只显示支持的四项维护工具', async t => {
  const f = await fixture(t, 'sqlite')
  for (const [label] of tools.slice(0, 4)) assert.ok(f.button('query-a', label))
  for (const [label] of tools.slice(4))
    assert.equal(f.button('query-a', label), undefined)
  await f.click(f.button('query-a', '断开连接'))
  await flush()
  assert.ok(f.button('', '重新连接'))
  assert.equal(f.button('', '更多'), undefined)
})

test('历史菜单不能把迟到项写入另一查询，保存始终分派到触发标签', async t => {
  const f = await fixture(t)
  f.click(f.button('query-a', '查询历史'))
  await flush()
  const history = f.menu('查询历史')
  assert.ok(history)
  const stale = all(history).find(
    element =>
      element.props.role === 'menuitem' &&
      text(element).includes('SELECT history')
  )
  f.api.select('query-b')
  f.click(stale)
  await flush()
  assert.equal(
    all(f.root).find(element => element.props['data-query-database'] === 'beta')
      .props['data-query-sql'],
    'SELECT beta'
  )
  f.api.select('query-a')
  await flush()
  f.click(f.button('query-a', '保存到 Queries（Ctrl+S）'))
  await flush()
  const save = all(f.root).find(
    element => element.props['data-dialog'] === 'save-query'
  )
  assert.ok(save)
  assert.equal(save.props['data-initial'], 'Query A')
  f.api.select('query-b')
  await flush()
  f.click(
    all(save).find(
      element => element.props['data-dialog-submit'] === 'save-query'
    )
  )
  await flush()
  assert.ok(
    f.api
      .tabs()
      .find(tab => tab.id === 'query-a')
      .label.startsWith('Saved query A')
  )
  assert.ok(
    f.api
      .tabs()
      .find(tab => tab.id === 'query-b')
      .label.startsWith('Query B')
  )
})

test('表对象工具栏保留连接与 AI 按钮，查询维护工具仍在查询页', async t => {
  const f = await fixture(t)
  f.api.select('')
  await flush()
  f.click(all(f.root).find(element => element.props['data-open-table']))
  await flush()
  const object = f.api.tabs().find(tab => tab.label.startsWith('users @'))
  assert.ok(object)
  assert.ok(f.button(object.id, '断开连接'))
  assert.ok(f.button(object.id, '打开 AI Agent'))
  for (const [label] of tools)
    assert.equal(f.button(object.id, label), undefined)
  assert.equal(f.button(object.id, runTitle), undefined)
  assert.equal(f.button(object.id, '更多'), undefined)
})
