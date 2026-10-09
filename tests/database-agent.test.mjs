import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

// Render the real database view so eager watchers run in the same setup order
// as the desktop. Only IPC and child presentation components are replaced.
const load = sourceLoader(
  {
    '@/components/ui/AppSidePane.vue': dataModule(`
      import {h,withDirectives,vShow} from ${JSON.stringify(import.meta.resolve('vue'))}
      export default {
        props:['open','width'],
        setup(props,{slots}) {
          return ()=>withDirectives(h('div',{'data-side-pane':true},slots.default?.()),[[vShow,props.open]])
        }
      }
    `),
    '@/components/agent/AiAgentPanel.vue': dataModule(`
      import {h} from ${JSON.stringify(import.meta.resolve('vue'))}
      export default {
        props:['target'], emits:['close'],
        setup(props,{emit}) {
          return ()=>h('aside',{'data-ai-panel':true,'data-session':props.target.sessionId},[
            h('button',{onClick:()=>emit('close')},'Close agent fixture')
          ])
        }
      }
    `),
    '@/api/database': dataModule(`
    export async function connect() {return {sessionId:'fixture-db',database:'demo',endpoint:'demo.invalid:5432',serverVersion:'16'}}
    export async function disconnect() {}
    export async function listObjects() {return []}
    export async function listDatabases() {return ['demo']}
    export async function completionColumns() {return []}
    export function errorMessage(error) {return String(error)}
    export function isAppError() {return false}
  `),
  },
  [
    'src/components/workspace/DatabaseView.vue',
    'src/components/ui/IconButton.vue',
  ]
)
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
const textContent = el =>
  [el.text, el.props.title, ...el.children.map(textContent)].join(' ')
const find = (el, predicate) =>
  predicate(el)
    ? el
    : el.children.map(child => find(child, predicate)).find(Boolean)

test('database view initializes its AI context watcher with and without a saved connection', async () => {
  const originalWindow = globalThis.window
  const originalStorage = globalThis.localStorage
  globalThis.window = new EventTarget()
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  }
  const connection = {
    id: 'db-agent-fixture',
    kind: 'postgresql',
    name: 'Demo database',
    host: 'demo.invalid',
    port: 5432,
    username: 'demo',
    settings: { database: 'demo', password: '', ssl: false },
    tags: [],
    tagColor: 'green',
    group: '',
    createdAt: 1,
    updatedAt: 1,
  }
  try {
    for (const target of [
      undefined,
      connection,
      { ...connection, kind: 'mysql' },
    ]) {
      const app = renderer.createApp({
        render: () => h(DatabaseView, { connection: target }),
      })
      const errors = []
      app.config.errorHandler = error => errors.push(error)
      app.use(createPinia()).use(i18n)
      const root = node('root')
      app.mount(root)
      try {
        await nextTick()
        assert.deepEqual(
          errors,
          [],
          'Database setup must not fail before the AI panel can render'
        )
        if (target) {
          const panel = () => find(root, el => el.props['data-ai-panel'])
          const shell = () => find(root, el => el.props['data-side-pane'])
          const originalPanel = panel()
          assert.equal(shell().style.display, 'none')
          find(root, el => el.props.title === '打开 AI Agent').props.onClick()
          await nextTick()
          assert.notEqual(shell().style.display, 'none')
          assert.equal(panel().props['data-session'], 'fixture-db')
          find(root, el => el.text === 'Close agent fixture').props.onClick()
          await nextTick()
          assert.equal(shell().style.display, 'none')
          assert.equal(
            panel(),
            originalPanel,
            'Folding must retain the agent instance'
          )
        } else assert.match(textContent(root), /还没有打开数据库/)
      } finally {
        app.unmount()
      }
    }
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    if (originalStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = originalStorage
  }
})
