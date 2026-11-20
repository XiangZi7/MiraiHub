import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const storage = new Map()
const calls = []
const columns = [
  { name: 'key', dataType: 'VARCHAR' },
  { name: 'value', dataType: 'TEXT' },
  { name: 'price', dataType: 'DECIMAL' },
]
const schemaColumns = [
  { name: 'price', dataType: 'DECIMAL(10,2) unsigned', nullable: true },
  { name: 'key', dataType: 'VARCHAR(255)', nullable: false },
  { name: 'value', dataType: 'TEXT', nullable: true },
]
globalThis.__columnTypesFixture = { storage, calls, columns, schemaColumns }
globalThis.requestAnimationFrame ??= callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame ??= id => clearTimeout(id)
const vue = JSON.stringify(import.meta.resolve('vue'))
const storageModule = dataModule(`
  export * from ${JSON.stringify(import.meta.resolve('@vueuse/core'))}
  import { shallowRef, watch } from ${vue}
  export function useStorage(key, fallback) {
    const storage = globalThis.__columnTypesFixture.storage
    const raw = storage.get(key)
    const value = shallowRef(raw === undefined ? fallback : JSON.parse(raw))
    watch(value, next => storage.set(key, JSON.stringify(next)), { flush: 'sync' })
    return value
  }
`)
const overrides = {
  '@vueuse/core': storageModule,
  '@/api/database': dataModule(`
    export async function tableDetail() {
      const fixture = globalThis.__columnTypesFixture
      fixture.calls.push('detail')
      return { schema: 'demo', name: 'items', kind: 'table', columns: fixture.schemaColumns, primaryKey: ['key'], indexes: [], foreignKeys: [] }
    }
    export async function fetchRows() {
      const fixture = globalThis.__columnTypesFixture
      fixture.calls.push('rows')
      return { columns: fixture.columns, rows: [['a', 'text', '1.20']], offset: 0, limit: 100, hasMore: false }
    }
    export async function referencingKeys() { return [] }
    export const errorMessage = String
  `),
  '@/api/column-tags': dataModule(
    'export async function onColumnTagsResult() { return () => {} }'
  ),
  '@/composables/useToast': dataModule(
    'export const toast = { success() {}, error() {}, warning() {} }'
  ),
  '@/components/ui/AppContextMenu.vue': dataModule(`
    import { h } from ${vue}
    export default {
      props: ['open', 'items'], emits: ['select', 'close'],
      setup(props, { emit }) {
        return () => props.open ? h('menu', {}, props.items.map(item => h('button', {
          'data-action': item.id, 'aria-checked': item.checked,
          onClick() { emit('select', item.id); emit('close') },
        }, item.label))) : null
      },
    }
  `),
}
const load = sourceLoader(overrides, [
  'src/components/workspace/database/DatabaseTableView.vue',
  'src/components/workspace/database/DatabaseQueryResults.vue',
])
const { databaseColumnTypeLabels } = await load(
  'src/utils/database-column-types.ts'
)
const preferences = await load('src/composables/useDatabaseColumnTypes.ts')
const { i18n } = await load('src/i18n/index.ts')
const { default: Table } = await load(
  'src/components/workspace/database/DatabaseTableView.vue'
)
const { default: QueryResults } = await load(
  'src/components/workspace/database/DatabaseQueryResults.vue'
)
const preferenceKey = 'miraihub:database-column-type-parameters-visible'

test('优先使用同名结构列的真实类型参数，保留结果列顺序且不修改原始列信息', () => {
  const before = structuredClone({ columns, schemaColumns })
  assert.deepEqual(databaseColumnTypeLabels(columns, true, schemaColumns), [
    'VARCHAR(255)',
    'TEXT',
    'DECIMAL(10,2) unsigned',
  ])
  assert.deepEqual(databaseColumnTypeLabels(columns, false, schemaColumns), [
    'VARCHAR',
    'TEXT',
    'DECIMAL unsigned',
  ])
  assert.deepEqual({ columns, schemaColumns }, before)
  assert.deepEqual(databaseColumnTypeLabels(columns, true), [
    'VARCHAR',
    'TEXT',
    'DECIMAL',
  ])
  assert.deepEqual(
    databaseColumnTypeLabels(
      [{ name: 'alias', dataType: 'VARCHAR' }],
      true,
      schemaColumns
    ),
    ['VARCHAR']
  )
  assert.deepEqual(
    databaseColumnTypeLabels([{ name: 'key', dataType: 'VARCHAR(80)' }], true, [
      { name: 'key', dataType: ' ' },
    ]),
    ['VARCHAR(80)']
  )
})

test('隐藏类型参数时保留修饰符和带引号类型名，未知或不完整声明不补造长度', () => {
  const types = [
    'CHARACTER VARYING(64)[]',
    'timestamp(3) with time zone',
    'numeric(12,-2)',
    "enum('a)b','it''s (ok)','back\\\'slash')",
    '"type(with parentheses)"',
    'TEXT',
    'VARCHAR',
    'DECIMAL(10,',
    '',
  ]
  const input = types.map((dataType, index) => ({
    name: String(index),
    dataType,
  }))
  assert.deepEqual(databaseColumnTypeLabels(input, true), types)
  assert.deepEqual(databaseColumnTypeLabels(input, false), [
    'CHARACTER VARYING[]',
    'timestamp with time zone',
    'numeric',
    'enum',
    '"type(with parentheses)"',
    'TEXT',
    'VARCHAR',
    'DECIMAL(10,',
    '',
  ])
})

test('默认显示字段长度，切换偏好后重新加载仍保持隐藏，并具备中英文菜单文案', async () => {
  assert.equal(preferences.columnTypeParametersVisible.value, true)
  preferences.toggleColumnTypeParameters()
  assert.equal(storage.get(preferenceKey), 'false')
  const reloaded = await sourceLoader(overrides)(
    'src/composables/useDatabaseColumnTypes.ts'
  )
  assert.equal(reloaded.columnTypeParametersVisible.value, false)
  preferences.toggleColumnTypeParameters()
  assert.equal(storage.get(preferenceKey), 'true')
  i18n.global.locale.value = 'en-US'
  assert.equal(i18n.global.t('显示字段长度'), 'Show field lengths')
  assert.equal(i18n.global.t('隐藏字段长度'), 'Hide field lengths')
  i18n.global.locale.value = 'zh-CN'
  assert.equal(i18n.global.t('显示字段长度'), '显示字段长度')
})

const node = (type, text = '') =>
  markRaw({
    type,
    text,
    props: {},
    style: {},
    children: [],
    parent: null,
    clientHeight: 400,
    clientWidth: 800,
    scrollTop: 0,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  })
const renderer = createRenderer({
  createElement: node,
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (element, text) => {
    element.text = text
  },
  setElementText: (element, text) => {
    element.text = text
    element.children = []
  },
  patchProp: (element, key, _old, value) => {
    element.props[key] = value
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
    element.parent = null
  },
})
const all = element => [element, ...element.children.flatMap(all)]
const text = element => element.text + element.children.map(text).join('')
const flush = async () => {
  for (let index = 0; index < 12; index++) await nextTick()
}

function mount(component, props, t) {
  const root = node('root')
  const errors = []
  const app = renderer.createApp({ render: () => h(component, props) })
  app.config.errorHandler = error => errors.push(error)
  app.use(i18n).mount(root)
  t.after(() => {
    app.unmount()
    assert.deepEqual(errors, [])
  })
  return root
}

function header(root, column) {
  const found = all(root).find(
    element => element.type === 'th' && element.props['data-column'] === column
  )
  assert.ok(found, `missing header: ${column}`)
  return found
}

async function toggleFromHeader(root, column, expectedLabel, checked) {
  header(root, column).props.onContextmenu({
    clientX: 40,
    clientY: 60,
    preventDefault() {},
  })
  await flush()
  const toggle = all(root).find(
    element => element.props['data-action'] === 'toggle-type-parameters'
  )
  assert.ok(toggle)
  assert.equal(text(toggle), expectedLabel)
  assert.equal(toggle.props['aria-checked'], checked)
  toggle.props.onClick()
  await flush()
}

test('两个真实表头的右键开关共享偏好，TEXT 和未知长度不变，切换不额外查询数据', async t => {
  i18n.global.locale.value = 'zh-CN'
  const table = mount(
    Table,
    {
      sessionId: 'demo',
      databaseKind: 'mysql',
      object: {
        schema: 'demo',
        name: 'items',
        kind: 'table',
        identity: 'demo.items',
      },
    },
    t
  )
  const query = mount(
    QueryResults,
    {
      execution: {
        statements: [
          {
            columns: [
              { name: 'key', dataType: 'VARCHAR' },
              { name: 'value', dataType: 'TEXT' },
              { name: 'price', dataType: 'DECIMAL(10,2)' },
            ],
            rows: [['a', 'text', '1.20']],
            rowsAffected: 0,
            statement: 'SELECT *',
            error: null,
          },
        ],
        elapsedMs: 1,
      },
      loading: false,
      error: '',
      databaseKind: 'mysql',
    },
    t
  )
  await flush()
  assert.match(text(header(table, 'key')), /VARCHAR\(255\)/)
  assert.match(text(header(table, 'price')), /DECIMAL\(10,2\) unsigned/)
  assert.match(text(header(query, 'price')), /DECIMAL\(10,2\)/)
  assert.doesNotMatch(text(header(query, 'key')), /\(/)
  assert.equal(header(query, 'value').props.title, 'TEXT')
  const baseline = [...calls]
  await toggleFromHeader(table, 'key', '隐藏字段长度', true)
  assert.doesNotMatch(text(header(table, 'key')), /\(/)
  assert.doesNotMatch(text(header(query, 'price')), /\(/)
  assert.equal(header(query, 'price').props.title, 'DECIMAL')
  assert.equal(header(query, 'value').props.title, 'TEXT')
  assert.equal(storage.get(preferenceKey), 'false')
  await toggleFromHeader(query, 'price', '显示字段长度', false)
  assert.match(text(header(table, 'key')), /VARCHAR\(255\)/)
  assert.equal(header(query, 'price').props.title, 'DECIMAL(10,2)')
  assert.equal(storage.get(preferenceKey), 'true')
  assert.deepEqual(calls, baseline)
  assert.equal(columns[0].dataType, 'VARCHAR')
})
