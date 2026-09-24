import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createRenderer,
  h,
  markRaw,
  nextTick,
  reactive,
  effectScope,
  ref,
} from 'vue'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

const calls = []
const detail = {
  schema: 'app',
  name: 'logs',
  kind: 'table',
  columns: [
    {
      name: 'id',
      dataType: 'bigint unsigned',
      nullable: false,
      primaryKey: true,
      autoIncrement: true,
      defaultValue: null,
      comment: null,
    },
  ],
  indexes: [],
  foreignKeys: [],
  primaryKey: ['id'],
  options: {
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_bin',
    rowFormat: 'Dynamic',
    comment: '',
    autoIncrement: '9007199254740993',
  },
}
globalThis.__databaseEditorTest = { detail, calls }
const vueUrl = import.meta.resolve('vue')
const load = sourceLoader(
  {
    '@/api/database': dataModule(
      `export async function tableDetail(){ return structuredClone(globalThis.__databaseEditorTest.detail) }; export async function execute(...args){ globalThis.__databaseEditorTest.calls.push(args); return { statements: [] } }; export function errorMessage(e){return String(e)}; export async function completionColumns(...args){ return globalThis.__databaseEditorTest.complete(...args) }`
    ),
    '@/composables/useToast': dataModule(
      'export const toast = { success(){}, warning(){}, error(){}, info(){} }'
    ),
    '@/utils/clipboard': dataModule('export async function copyText(){}'),
    '@/components/ui/AppInput.vue': dataModule(
      `import { h } from '${vueUrl}'; export default { props:['modelValue'], emits:['update:modelValue'], setup(props,{attrs,emit}){return ()=>h('input',{...attrs,value:props.modelValue,onChange:value=>emit('update:modelValue',value)})} }`
    ),
    '@/components/ui/AppContextMenu.vue': dataModule(
      `import { h } from '${vueUrl}'; export default { props:['items','open'], emits:['select','close'], setup(props,{emit}){return ()=>props.open ? h('menu',{},props.items.map(item=>h('button',{disabled:item.disabled,onClick:()=>emit('select',item.id)},item.label))) : null} }`
    ),
  },
  [
    'src/components/workspace/database/DatabaseTableDesigner.vue',
    'src/components/workspace/database/SqlEditor.vue',
    'src/components/ui/AppButton.vue',
  ]
)
const { i18n } = await load('src/i18n/index.ts')
i18n.global.locale.value = 'zh-CN'
const { default: Designer } = await load(
  'src/components/workspace/database/DatabaseTableDesigner.vue'
)
const { default: Editor } = await load(
  'src/components/workspace/database/SqlEditor.vue'
)
const { sqlCompletionPrefix, filterSqlSuggestions } = await load(
  'src/utils/sql-completion.ts'
)
const { useDatabaseCompletions } = await load(
  'src/composables/useDatabaseCompletions.ts'
)
const node = (type, text = '') =>
  markRaw({
    type,
    text,
    style: {},
    props: {},
    children: [],
    parent: null,
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    setSelectionRange(start, end) {
      this.selectionStart = start
      this.selectionEnd = end
    },
    setRangeText(value, start, end) {
      this.value = this.value.slice(0, start) + value + this.value.slice(end)
      this.selectionStart = this.selectionEnd = start + value.length
    },
  })
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
    if (key === 'value') el.value = value
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
const textOf = el => [el.text, ...el.children.map(textOf)].join('')
const settle = async () => {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

test('打开设计表不标脏；无效编辑也提示，改回原值或保存后清除', async () => {
  const root = node('root'),
    dirty = []
  const app = renderer.createApp({
    render: () =>
      h(Designer, {
        sessionId: 'test',
        databaseKind: 'mysql',
        schema: 'app',
        objects: [],
        editTable: { schema: 'app', name: 'logs' },
        onDirty: value => dirty.push(value),
      }),
  })
  app.use(i18n).mount(root)
  await settle()
  assert.deepEqual(dirty, [false])
  const name = all(root).find(el => el.props['aria-label'] === '表名')
  name.props.onChange('')
  await settle()
  assert.equal(dirty.at(-1), true)
  const save = () =>
    all(root).find(el => el.type === 'button' && textOf(el) === '保存修改')
  assert.equal(save().props.disabled, true)
  name.props.onChange('logs')
  await settle()
  assert.equal(dirty.at(-1), false)
  name.props.onChange('logs_new')
  await settle()
  assert.equal(save().props.disabled, false)
  await save().props.onClick()
  await settle()
  assert.equal(dirty.at(-1), false)
  assert.match(calls.at(-1)[1], /RENAME TABLE/)
  app.unmount()
})

test('字段补全一个字符即可匹配，过滤大小写、去重且避开字符串和注释', () => {
  assert.equal(sqlCompletionPrefix('SELECT p', 8), 'p')
  assert.equal(sqlCompletionPrefix('SELECT a.p', 10), 'p')
  assert.equal(sqlCompletionPrefix("SELECT 'p", 9), null)
  assert.equal(sqlCompletionPrefix('SELECT -- p', 11), null)
  assert.equal(sqlCompletionPrefix('/* path */ SELECT p', 19), 'p')
  assert.deepEqual(
    filterSqlSuggestions(['path', 'Path', 'port', 'SELECT'], 'p'),
    ['path', 'port']
  )
})

test('右键菜单失焦后仍只运行打开菜单时的选区；空选区不运行全部', async () => {
  const root = node('root'),
    runs = []
  const sql = 'SELECT path FROM logs; DELETE FROM logs;'
  const app = renderer.createApp({
    render: () =>
      h(Editor, {
        modelValue: sql,
        onRun: value => runs.push(value),
        suggestions: ['path', 'port'],
      }),
  })
  app.use(i18n).mount(root)
  await settle()
  const input = all(root).find(el => el.type === 'textarea')
  input.selectionStart = 0
  input.selectionEnd = 22
  input.props.onPointerdown({ button: 2 })
  input.selectionStart = input.selectionEnd = sql.length
  input.props.onContextmenu({
    clientX: 20,
    clientY: 20,
    preventDefault() {},
    stopPropagation() {},
  })
  input.selectionStart = input.selectionEnd = sql.length
  await settle()
  const selected = all(root).find(
    el => el.type === 'button' && textOf(el) === '运行选中的 SQL'
  )
  assert.equal(selected.props.disabled, false)
  await selected.props.onClick()
  assert.deepEqual(runs, ['SELECT path FROM logs;'])
  input.props.onContextmenu({
    clientX: 20,
    clientY: 20,
    preventDefault() {},
    stopPropagation() {},
  })
  await settle()
  assert.equal(
    all(root).find(
      el => el.type === 'button' && textOf(el) === '运行选中的 SQL'
    ).props.disabled,
    true
  )
  app.unmount()
})

test('切库时清除旧字段，迟到的补全元数据不会覆盖新库', async () => {
  const pending = new Map()
  globalThis.__databaseEditorTest.complete = (_id, schema) =>
    new Promise(resolve => pending.set(schema, resolve))
  const scope = effectScope(),
    session = ref('one'),
    schema = ref('old'),
    catalog = ref([])
  const columns = scope.run(() =>
    useDatabaseCompletions(session, schema, catalog)
  )
  schema.value = 'new'
  await nextTick()
  pending.get('new')(['path'])
  await settle()
  pending.get('old')(['stale'])
  await settle()
  assert.deepEqual(columns.value, ['path'])
  session.value = ''
  await settle()
  assert.deepEqual(columns.value, [])
  scope.stop()
})
