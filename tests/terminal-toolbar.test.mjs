import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const vue = JSON.stringify(import.meta.resolve('vue'))
const boundary = dataModule(`
  export const mock = { starts:[], stops:[], copied:[] };
  export function startRecording(terminal) { mock.starts.push(terminal) }
  export function stopRecording(terminal) { mock.stops.push(terminal); return {version:2,width:80,height:24,events:[]} }
  export function parseCast() { return {version:2,width:80,height:24,events:[]} }
  export async function copyText(text) { mock.copied.push(text) }
  export class SearchAddon { clearDecorations(){} findNext(){} findPrevious(){} dispose(){} onDidChangeResults(){return {dispose(){}}} }
`)
const { mock } = await import(boundary)
const menu = dataModule(`
  import {h} from ${vue};
  export default {props:['open','items'],emits:['select','close'],setup:(props,{emit})=>()=>props.open?h('div',{role:'menu',items:props.items},props.items.map(item=>h('button',{'data-action':item.id,disabled:item.disabled,checked:item.checked,onClick:()=>{if(!item.disabled){emit('select',item.id);emit('close')}}},item.label))):null};
`)
const replay = dataModule(
  `import {h} from ${vue}; export default {props:['cast'],setup:props=>()=>h('div',{'data-replay':true,cast:props.cast})};`
)
const load = sourceLoader(
  {
    vue: dataModule(`export * from ${vue}; export const vModelText = {};`),
    'vue-i18n': dataModule('export const useI18n=()=>({t:key=>key})'),
    '@vueuse/core': dataModule('export function useEventListener(){}'),
    '@xterm/addon-search': boundary,
    '@/utils/terminal-recording': boundary,
    '@/utils/clipboard': boundary,
    '@/utils/shortcut': dataModule('export const matchesShortcut=()=>false'),
    '@/constants/terminal': dataModule(
      'export const terminalSearchDecorations=()=>({})'
    ),
    '@/composables/useSettings': dataModule(
      'export const useSettings=()=>({settings:{shortcutPalette:"Ctrl+K",shortcutSearch:"Ctrl+Shift+F"}})'
    ),
    '@/composables/useToast': dataModule(
      'export const toast={success(){},error(){}}'
    ),
    '@/components/ui/AppContextMenu.vue': menu,
    '@/components/workspace/terminal-replay-dialog.vue': replay,
  },
  [
    'src/components/workspace/TerminalActions.vue',
    'src/components/ui/IconButton.vue',
  ]
)
const { default: Actions } = await load(
  'src/components/workspace/TerminalActions.vue'
)

/** 虚拟宿主保留文本、事件和焦点，验证菜单路由，不启动 xterm 或真实连接。 */
function node(type, text = '') {
  return markRaw({
    type,
    text,
    props: {},
    style: {},
    children: [],
    parent: null,
    clicks: 0,
    addEventListener() {},
    removeEventListener() {},
    getRootNode() {
      return null
    },
    getBoundingClientRect() {
      return { left: 10, bottom: 30 }
    },
    closest() {
      return null
    },
    focus() {
      globalThis.document.activeElement = this
    },
    select() {},
    click() {
      this.clicks++
    },
  })
}
let body
const renderer = createRenderer({
  querySelector: () => body,
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
    const i = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(i < 0 ? parent.children.length : i, 0, el)
  },
  remove(el) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
  },
})
/** 遍历实际组件模板的虚拟元素。 */
function all(el) {
  return [el, ...el.children.flatMap(all)]
}
/** 等待菜单、搜索和回放的 Vue 更新。 */
async function flush() {
  for (let i = 0; i < 8; i++) await nextTick()
}
/** 提供最小终端边界，统计业务方法以保证布局修改没有执行命令。 */
function terminal(selection = 'selected text') {
  return markRaw({
    pasted: [],
    focuses: 0,
    selected: selection,
    keyHandler: null,
    hasSelection() {
      return !!this.selected
    },
    getSelection() {
      return this.selected
    },
    loadAddon() {},
    onSelectionChange() {
      return { dispose() {} }
    },
    attachCustomKeyEventHandler(handler) {
      this.keyHandler = handler
    },
    clearSelection() {
      this.selected = ''
    },
    selectAll() {},
    clear() {},
    focus() {
      this.focuses++
    },
    paste(value) {
      this.pasted.push(value)
    },
  })
}
/** 隔离宿主全局变量并挂载真实工具栏，结束后恢复并清理。 */
function fixture(t, term = terminal(), local = false) {
  const oldDocument = globalThis.document,
    oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  globalThis.document = { activeElement: null }
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { readText: async () => 'pasted text' } },
    configurable: true,
  })
  body = node('body')
  mock.starts = []
  mock.stops = []
  mock.copied = []
  const props = reactive({
    terminal: term,
    status: 'connected',
    available: true,
    local,
  })
  const root = node('root')
  const app = renderer.createApp({ render: () => h(Actions, props) })
  app.mount(root)
  t.after(() => {
    app.unmount()
    if (oldDocument === undefined) delete globalThis.document
    else globalThis.document = oldDocument
    if (oldNavigator)
      Object.defineProperty(globalThis, 'navigator', oldNavigator)
    else delete globalThis.navigator
  })
  return { root, props, term }
}
/** 使用真实更多按钮打开轻量菜单宿主。 */
async function openMore(root) {
  const button = all(root).find(
    el => el.type === 'button' && el.props['aria-label'] === '更多'
  )
  assert.ok(button)
  assert.equal(Boolean(button.props.disabled), false)
  button.props.onClick({ currentTarget: button })
  await flush()
  return all(root).find(el => el.props.role === 'menu')
}
/** 从菜单点击未禁用的原生按钮，保持公共菜单的 select → close 顺序。 */
async function select(root, id) {
  const button = all(root).find(el => el.props['data-action'] === id)
  assert.ok(button)
  assert.ok(!button.props.disabled)
  button.props.onClick()
  await flush()
}

test('SSH recording and replay import are available only from More', async t => {
  const { root, term } = fixture(t)
  const toolbarButton = label =>
    all(root).find(
      el => el.type === 'button' && el.props['aria-label'] === label
    )
  assert.equal(toolbarButton('开始录制'), undefined)
  assert.equal(toolbarButton('导入录制回放'), undefined)
  const menu = await openMore(root)
  assert.ok(menu.props.items.some(item => item.id === 'search'))
  assert.ok(menu.props.items.some(item => item.id === 'import-recording'))
  await select(root, 'recording')
  assert.deepEqual(mock.starts, [term])
  assert.deepEqual(term.pasted, [])
  assert.equal(toolbarButton('停止录制'), undefined)
  assert.match(toolbarButton('更多').props.class, /text-danger/)
  const recordingMenu = await openMore(root)
  assert.equal(
    recordingMenu.props.items.find(item => item.id === 'recording').label,
    '停止录制'
  )
  await select(root, 'recording')
  assert.deepEqual(mock.stops, [term])
  assert.doesNotMatch(toolbarButton('更多').props.class, /text-danger/)
  assert.ok(all(body).some(el => el.props['data-replay']))
  assert.deepEqual(term.pasted, [])
})

test('More opens search and leaves keyboard focus in the input', async t => {
  const { root, term } = fixture(t)
  await openMore(root)
  await select(root, 'search')
  assert.ok(all(root).some(el => el.props.role === 'search'))
  assert.equal(
    globalThis.document.activeElement.props['aria-label'],
    '搜索终端内容'
  )
  assert.deepEqual(term.pasted, [])
})

test('replay import remains reachable in a disconnected SSH toolbar without a terminal', async t => {
  const { root, props } = fixture(t, undefined)
  props.terminal = undefined
  props.status = 'disconnected'
  await flush()
  const menu = await openMore(root)
  assert.equal(
    menu.props.items.find(item => item.id === 'search').disabled,
    true
  )
  assert.equal(
    menu.props.items.find(item => item.id === 'recording').disabled,
    true
  )
  const input = all(root).find(
    el => el.type === 'input' && el.props.type === 'file'
  )
  await select(root, 'import-recording')
  assert.equal(input.clicks, 1)
  assert.deepEqual(mock.starts, [])
})

test('local toolbar omits SSH-only recording and preserves copy/paste and Ctrl+C routing', async t => {
  const term = terminal('')
  const { root } = fixture(t, term, true)
  const menu = await openMore(root)
  assert.ok(
    !menu.props.items.some(
      item => item.id === 'recording' || item.id === 'import-recording'
    )
  )
  const event = {
    type: 'keydown',
    key: 'c',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {
      throw new Error('Ctrl+C must stay native without selection')
    },
  }
  assert.equal(term.keyHandler(event), true)
  await select(root, 'paste')
  assert.deepEqual(term.pasted, ['pasted text'])
})

test('SSH address and search layout use shrinkable container-based width constraints', () => {
  const panel = readFileSync(
    'src/components/workspace/TerminalPanel.vue',
    'utf8'
  )
  const actions = readFileSync(
    'src/components/workspace/TerminalActions.vue',
    'utf8'
  )
  const address = panel.match(/class="terminal-endpoint[^"]+"/)?.[0]
  assert.ok(address)
  assert.match(address, /min-w-0/)
  assert.doesNotMatch(address, /shrink-0/)
  assert.match(actions, /100cqw-16px/)
  assert.match(actions, /flex-wrap/)
  assert.match(actions, /terminal-command-action/)
})
