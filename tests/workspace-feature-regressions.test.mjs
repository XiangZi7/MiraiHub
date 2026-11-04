import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick, reactive, shallowRef } from 'vue'
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
      `import {h} from ${vue}; export default {props:['tabs','active','contextItems'],emits:['update:active','add','close','closeMany','reorder'],setup:(props,{emit})=>()=>h('nav',{'data-main-tabs':true,items:props.tabs,active:props.active,onSelect:id=>emit('update:active',id),onAdd:()=>emit('add'),onClose:id=>emit('close',id),onReorder:(a,b)=>emit('reorder',a,b)})}`
    ),
  },
  [
    'src/components/workspace/SidebarProjects.vue',
    'src/components/connection/ConnectionTagEditor.vue',
    'src/components/workspace/WorkspaceTabBar.vue',
  ]
)
const { i18n } = await load('src/i18n/index.ts')
i18n.global.locale.value = 'zh-CN'
const { default: SidebarProjects } = await load(
  'src/components/workspace/SidebarProjects.vue'
)
const { default: ConnectionTagEditor } = await load(
  'src/components/connection/ConnectionTagEditor.vue'
)
const { default: WorkspaceTabBar } = await load(
  'src/components/workspace/WorkspaceTabBar.vue'
)
const { provideDatabaseWorkspaceTabs, databaseWorkspaceTabId } = await load(
  'src/composables/useDatabaseWorkspaceTabs.ts'
)
const { useRemoteFileSelection } = await load(
  'src/components/workspace/useRemoteFileSelection.ts'
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
            tabs: ['one', 'two'].map(id => ({
              id,
              connection: connection(id, id),
              status: 'connected',
              sessionId: id,
            })),
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
  assert.equal(active, 'two')
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
