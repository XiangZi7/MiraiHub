import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, disposePinia } from 'pinia'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

const vue = JSON.stringify(import.meta.resolve('vue'))
const boundary = dataModule(`
  export const mock = { calls: [], handlers: {}, notices: [] }
  export const call = async (name, args) => {
    mock.calls.push([name, args]); return mock.handlers[name]?.(args)
  }
`)
const load = sourceLoader(
  {
    vue: dataModule(`
      export * from ${vue}
      export const Transition = { inheritAttrs: false, setup: (_, { slots }) => () => slots.default?.() }
    `),
    '@tauri-apps/api/core': dataModule(`
      import { call } from ${JSON.stringify(boundary)}
      export const invoke = call
    `),
    '@tauri-apps/plugin-dialog': dataModule(`
      import { call } from ${JSON.stringify(boundary)}
      export const open = options => call('open', options)
      export const save = options => call('save', options)
    `),
    '@/api/ssh': dataModule(
      'export const onTransfer = async () => () => {}; export const cancelTransfer = async () => {}; export const errorMessage = error => error.message ?? String(error)'
    ),
    '@/stores/settings': dataModule(
      'export const useSettingsStore = () => ({ values: { maxFileTransfers: 3, notifyTransferComplete: true } })'
    ),
    '@/utils/window': dataModule('export const IS_TAURI = true'),
    '@/composables/useSettings': dataModule(
      'export const settingNumber = (_key, fallback) => fallback; export const settingsSnapshot = () => ({})'
    ),
    './ssh': dataModule(
      'export const errorMessage = error => error.message ?? String(error); export const isAppError = () => false'
    ),
    '@/composables/useToast': dataModule(`
      import { mock } from ${JSON.stringify(boundary)}
      export const toast = Object.fromEntries(['success','warning','error'].map(kind =>
        [kind, value => mock.notices.push([kind, value])]))
    `),
    '@/components/ui/AppIcon.vue': dataModule(`
      import { h } from ${vue}
      export default { props: ['name'], setup: props => () => h('i', { 'data-icon': props.name }) }
    `),
    '@/components/ui/AppDialog.vue': dataModule(`
      import { h } from ${vue}
      export default { props: ['title','description'], emits: ['close'], setup: (props, { slots, emit }) => () =>
        h('section', { role: 'dialog' }, [h('h2', props.title), h('p', props.description),
          h('button', { 'aria-label': '关闭弹窗', onClick: () => emit('close') }, '关闭'),
          slots.default?.(), h('footer', slots.footer?.())]) }
    `),
    '@/components/ui/AppConfirmDialog.vue': dataModule(`
      import { h } from ${vue}
      export default { props: ['open','title','description','confirmLabel'], emits: ['confirm','close'],
        setup: (props, { emit }) => () => props.open ? h('section', { role: 'alertdialog' }, [
          h('h2', props.title), h('p', props.description),
          h('button', { onClick: () => emit('close') }, '返回'),
          h('button', { onClick: () => emit('confirm') }, props.confirmLabel)]) : null }
    `),
  },
  [
    'src/components/workspace/database/DatabaseTransferDialog.vue',
    'src/components/workspace/database/DatabaseTransferOptions.vue',
    'src/components/ui/AppButton.vue',
    'src/components/ui/AppCheckbox.vue',
  ]
)
const { mock } = await import(boundary)
const { i18n } = await load('src/i18n/index.ts')
const { default: TransferDialog } = await load(
  'src/components/workspace/database/DatabaseTransferDialog.vue'
)
const api = await load('src/api/database.ts')
i18n.global.locale.value = 'zh-CN'

const node = (type, text = '') =>
  markRaw({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    listeners: {},
    addEventListener(name, handler) {
      this.listeners[name] = handler
    },
    removeEventListener(name) {
      delete this.listeners[name]
    },
  })
let body
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
    if (key === 'value') el._value = value
  },
  parentNode: el => el.parent,
  nextSibling: el =>
    el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  querySelector: () => body,
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
  for (let index = 0; index < 75; index++) await nextTick()
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const exportResult = {
  path: 'C:/export.sql',
  objects: 3,
  rows: 120,
  bytes: 2048,
  elapsedMs: 42,
}
const importResult = {
  path: 'C:/import.sql',
  statements: 4,
  rowsAffected: 120,
  skippedStatements: 3,
  elapsedMs: 20,
}
const calls = name => mock.calls.filter(([command]) => command === name)

async function fixture(t, mode = 'export') {
  mock.calls = []
  mock.notices = []
  mock.handlers = {
    save: async () => 'C:/export.sql',
    open: async () => 'C:/import.sql',
    db_export_sql: async () => exportResult,
    db_import_sql: async () => importResult,
    db_import_catalog: async () => [
      {
        schema: 'target',
        name: 'users',
        columns: [
          {
            name: 'id',
            dataType: 'INT',
            nullable: false,
            defaultValue: null,
            autoIncrement: true,
          },
        ],
      },
    ],
    db_preview_import_sql: async () => ({
      sources: [
        {
          id: 'old\\u0000users',
          schema: 'old',
          name: 'users',
          columns: ['id'],
          rows: [],
          statementCount: 4,
        },
      ],
      skippedStatements: 3,
    }),
    db_cancel_query: async () => true,
    db_fork_session: async () => ({ sessionId: 'transfer-session' }),
  }
  body = node('body')
  const root = node('root')
  const props = reactive({
    open: true,
    mode,
    sessionId: 'transfer-session',
    databaseName: 'target',
    connection: {
      kind: 'mysql',
      name: 'Fixture',
      settings: { database: 'target' },
    },
  })
  const events = [],
    errors = []
  const app = renderer.createApp({
    render: () =>
      h(TransferDialog, {
        ...props,
        onClose: () => events.push('close'),
        onFinished: mode => events.push(mode),
      }),
  })
  app.config.errorHandler = error => errors.push(error)
  const pinia = createPinia()
  app.use(pinia).use(i18n).mount(root)
  t.after(() => {
    app.unmount()
    disposePinia(pinia)
    assert.deepEqual(errors, [])
  })
  await flush()
  const elements = () => [...all(root), ...all(body)]
  const button = label =>
    elements().find(el => el.type === 'button' && textOf(el).trim() === label)
  return {
    props,
    events,
    elements,
    button,
    text: () => textOf(root) + textOf(body),
    async click(label) {
      const el = button(label)
      assert.ok(el, `button ${label}`)
      el.props.onClick()
      await flush()
    },
    radios: () =>
      elements().filter(el => el.type === 'input' && el.props.type === 'radio'),
    checkboxes: () =>
      elements()
        .filter(el => el.type === 'input' && el.props.type === 'checkbox')
        .slice(mode === 'export' ? 2 : 0),
    async chooseContent(value) {
      const input = elements().find(
        el => el.props.type === 'radio' && el.props.value === value
      )
      assert.ok(input)
      input.listeners.change({ target: input })
      await flush()
    },
    async check(index, checked = true) {
      const input = elements().filter(el => el.props.type === 'checkbox')[
        index + (mode === 'export' ? 2 : 0)
      ]
      assert.ok(input)
      input.checked = checked
      input.listeners.change({ target: input })
      await flush()
    },
  }
}

test('transfer options default to structure and data in the current database and reset when reopened', async t => {
  const view = await fixture(t)
  assert.equal(view.radios().find(input => input.checked).props.value, 'all')
  assert.deepEqual(
    view.checkboxes().map(input => input.checked),
    [false, false]
  )
  assert.equal(view.button('开始导出').props.disabled, true)
  await view.check(0)
  await view.check(1)
  await view.chooseContent('data')
  assert.equal(view.checkboxes().length, 0)
  await view.chooseContent('all')
  assert.deepEqual(
    view.checkboxes().map(input => input.checked),
    [false, false]
  )
  await view.click('浏览…')
  await view.chooseContent('structure')
  view.props.open = false
  await flush()
  view.props.open = true
  await flush()
  assert.equal(view.radios().find(input => input.checked).props.value, 'all')
  assert.match(view.text(), /尚未选择文件/)
})

test('data-only export stays responsive and prevents duplicate file selection or execution', async t => {
  const view = await fixture(t)
  const file = deferred(),
    transfer = deferred()
  mock.handlers.save = () => file.promise
  mock.handlers.db_export_sql = () => transfer.promise
  await view.chooseContent('data')
  const browse = view.button('浏览…').props.onClick
  browse()
  browse()
  await flush()
  assert.equal(calls('save').length, 1)
  assert.equal(view.button('浏览…').props.disabled, true)
  assert.equal(view.button('开始导出').props.disabled, true)
  await view.click('关闭')
  assert.deepEqual(view.events, [])
  file.resolve('C:/data.sql')
  await flush()
  const start = view.button('开始导出').props.onClick
  start()
  start()
  await flush()
  assert.equal(calls('db_export_sql').length, 1)
  assert.deepEqual(calls('db_export_sql')[0][1], {
    sessionId: 'transfer-session',
    taskId: calls('db_begin_export_file')[0][1].taskId,
    path: 'C:/data.sql',
    includeData: true,
    includeStructure: false,
    includeDatabase: false,
    dropExisting: false,
  })
  assert.match(view.text(), /正在导出，请稍候/)
  assert.equal(view.button('导出中…').props.disabled, true)
  assert.ok(view.elements().find(el => el.type === 'fieldset').props.disabled)
  transfer.resolve(exportResult)
  await flush()
  assert.match(view.text(), /3 个对象、120 行数据（2.0 KB）/)
  assert.deepEqual(view.events, ['export'])
  assert.equal(view.button('开始导出'), undefined)
  await view.click('完成')
  assert.deepEqual(view.events, ['export', 'close'])
})

test('structure-only export forwards the selected schema and replacement options to IPC', async t => {
  const view = await fixture(t)
  await view.chooseContent('structure')
  await view.check(0)
  await view.check(1)
  await view.click('浏览…')
  await view.click('开始导出')
  assert.deepEqual(calls('db_export_sql')[0][1], {
    sessionId: 'transfer-session',
    taskId: calls('db_begin_export_file')[0][1].taskId,
    path: 'C:/export.sql',
    includeData: false,
    includeStructure: true,
    includeDatabase: true,
    dropExisting: true,
  })
  assert.deepEqual(view.events, ['export'])
})

test('import waits for confirmation, applies data-only options and shows skipped SQL counts', async t => {
  const view = await fixture(t, 'import')
  await view.chooseContent('data')
  await view.click('浏览…')
  await view.click('开始导入')
  assert.equal(calls('db_import_sql').length, 0)
  assert.match(view.text(), /目标数据库：target/)
  await view.click('返回')
  assert.equal(calls('db_import_sql').length, 0)
  await view.click('开始导入')
  await view.click('确认导入')
  assert.deepEqual(calls('db_import_sql')[0][1], {
    sessionId: 'transfer-session',
    path: 'C:/import.sql',
    options: {
      content: 'data',
      includeDatabase: false,
      mappings: [
        {
          sourceId: 'old\\u0000users',
          targetSchema: 'target',
          targetTable: 'users',
          columns: { id: 'id' },
        },
      ],
    },
  })
  assert.match(view.text(), /已执行 4 条 SQL，影响 120 行/)
  assert.match(view.text(), /已按选项跳过 3 条 SQL/)
  assert.deepEqual(view.events, ['import'])
})

test('file and export failures remain visible and can be retried without losing the selected options', async t => {
  const view = await fixture(t)
  mock.handlers.save = async () => {
    throw new Error('file picker unavailable')
  }
  await view.click('浏览…')
  assert.match(view.text(), /file picker unavailable/)
  assert.equal(view.button('浏览…').props.disabled, false)
  mock.handlers.save = async () => 'C:/retry.sql'
  await view.click('浏览…')
  await view.chooseContent('structure')
  mock.handlers.db_export_sql = async () => {
    throw new Error('disk full')
  }
  await view.click('开始导出')
  assert.match(view.text(), /disk full/)
  assert.equal(view.button('开始导出').props.disabled, false)
  assert.equal(
    view.radios().find(input => input.checked).props.value,
    'structure'
  )
  assert.deepEqual(view.events, [])
  mock.handlers.db_export_sql = async () => exportResult
  await view.click('开始导出')
  assert.equal(calls('db_export_sql').length, 2)
  assert.doesNotMatch(view.text(), /disk full/)
  assert.deepEqual(view.events, ['export'])
})

test('an import can be cancelled once while running and recovers when the operation stops', async t => {
  const view = await fixture(t, 'import')
  const transfer = deferred()
  mock.handlers.db_import_sql = () => transfer.promise
  await view.click('浏览…')
  await view.click('开始导入')
  await view.click('确认导入')
  assert.deepEqual(calls('db_import_sql')[0][1].options, {
    content: 'all',
    includeDatabase: false,
  })
  await view.click('关闭')
  assert.deepEqual(view.events, [])
  const cancel = view.button('取消导入').props.onClick
  cancel()
  cancel()
  await flush()
  assert.equal(calls('db_cancel_query').length, 1)
  assert.deepEqual(calls('db_cancel_query')[0][1], {
    sessionId: 'transfer-session',
  })
  assert.equal(view.button('取消中…').props.disabled, true)
  transfer.reject(new Error('导入已取消'))
  await flush()
  assert.match(view.text(), /导入已取消/)
  assert.equal(view.button('开始导入').props.disabled, false)
  assert.deepEqual(view.events, [])
})

test('the native API boundary suppresses schema and drop flags in data-only mode for all callers', async () => {
  mock.calls = []
  mock.handlers = {}
  await api.exportSql('session', 'data.sql', {
    content: 'data',
    includeDatabase: true,
    dropExisting: true,
  })
  await api.importSql('session', 'data.sql', {
    content: 'data',
    includeDatabase: true,
  })
  assert.deepEqual(mock.calls, [
    [
      'db_export_sql',
      {
        sessionId: 'session',
        path: 'data.sql',
        includeData: true,
        includeStructure: false,
        includeDatabase: false,
        dropExisting: false,
      },
    ],
    [
      'db_import_sql',
      {
        sessionId: 'session',
        path: 'data.sql',
        options: { content: 'data', includeDatabase: false },
      },
    ],
  ])
})
