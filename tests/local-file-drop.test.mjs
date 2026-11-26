import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, nextTick, ref } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

test('系统文件拖入只复制到命中的本地目录，切换目录和卸载时不写回旧列表', async t => {
  const handlers = new Set()
  const copies = []
  const lists = []
  const messages = []
  const component = 'src/components/workspace/local-file-pane.vue'
  const listeners = {
    onDragDropEvent(fn) {
      handlers.add(fn)
      return Promise.resolve(() => handlers.delete(fn))
    },
  }
  globalThis.fileDropTest = {
    listeners,
    toast: {
      success: msg => messages.push(msg),
      error: msg => messages.push(msg),
    },
    list(path) {
      lists.push(path)
      return Promise.resolve({ path, parent: null, entries: [] })
    },
    copy(paths, directory) {
      return new Promise(resolve => copies.push({ paths, directory, resolve }))
    },
  }
  t.after(() => {
    delete globalThis.fileDropTest
  })
  const load = sourceLoader(
    {
      '@/utils/window': dataModule('export const IS_TAURI = true'),
      '@tauri-apps/api/webview': dataModule(
        'export const getCurrentWebview = () => globalThis.fileDropTest.listeners'
      ),
      'vue-i18n': dataModule(
        'export const useI18n = () => ({t: (key, params) => ({key, params})})'
      ),
      '@/api/workspace-files': dataModule(
        'export const {list:listLocalDirectory,copy:copyLocalEntries} = globalThis.fileDropTest; export const openLocalFile = () => {}'
      ),
      '@/api/ssh': dataModule('export const errorMessage = String'),
      '@/i18n/native': dataModule(
        'export const translateNativeMessage = String'
      ),
      '@/composables/useFileTransfers': dataModule(
        'export const useFileTransfers = () => ({})'
      ),
      '@/composables/useSettings': dataModule(
        'export const useSettings = () => ({settings: {showHiddenFiles: true}})'
      ),
      '@/composables/useToast': dataModule(
        'export const {toast} = globalThis.fileDropTest'
      ),
    },
    [component]
  )
  const { default: LocalFilePane } = await load(component)
  const doc = { defaultView: { devicePixelRatio: 1.5 } }
  const panels = []
  function node(tag) {
    const el = {
      tag,
      ownerDocument: doc,
      props: {},
      contains(hit) {
        for (let current = hit; current; current = current.parent)
          if (current === el) return true
        return false
      },
    }
    if (tag === 'section') panels.push(el)
    return el
  }
  const body = node('body')
  const renderer = createRenderer({
    createElement: node,
    createText: node,
    createComment: node,
    insert(child, parent) {
      child.parent = parent
    },
    remove() {},
    setText() {},
    setElementText() {},
    nextSibling: () => null,
    parentNode: el => el.parent,
    patchProp(el, key, prev, next) {
      el.props[key] = next
    },
    querySelector: () => body,
  })
  const initialPath = ref('C:/project')
  const app = renderer.createApp({
    render: () =>
      h('main', [
        h(LocalFilePane, {
          sessionId: 'local',
          initialPath: initialPath.value,
        }),
        h(LocalFilePane, {
          sessionId: 'ssh',
          initialPath: 'D:/dual',
          remotePath: '/srv',
        }),
      ]),
  })
  app.mount(body)
  t.after(() => {
    if (handlers.size) app.unmount()
  })
  const flush = async () => {
    await new Promise(resolve => setImmediate(resolve))
    await nextTick()
  }
  await flush()
  assert.equal(handlers.size, 2)
  // 两个面板共用一条边，浮层与窗口外均不是文件拖放目标。
  doc.elementFromPoint = (x, y) =>
    y === 0 ? body : x < 100 ? panels[0] : { parent: panels[1] }
  const paths = ['D:/source/readme.txt', 'D:/source/photos']
  function drop(x, y) {
    const payload = {
      type: 'drop',
      paths,
      position: { toLogical: ratio => ({ x: x / ratio, y: y / ratio }) },
    }
    for (const handle of handlers) handle({ payload })
  }
  drop(150, 0)
  assert.equal(copies.length, 0)
  drop(150, 15)
  assert.deepEqual(
    copies.map(c => [c.paths, c.directory]),
    [[paths, 'D:/dual']]
  )
  copies[0].resolve({
    copied: ['D:/dual/readme.txt'],
    failed: [{ path: paths[1], message: 'Access denied' }],
  })
  await flush()
  assert.deepEqual(lists, ['C:/project', 'D:/dual', 'D:/dual'])
  assert.match(messages[0].description, /photos.*Access denied/)
  doc.defaultView.devicePixelRatio = 2
  drop(150, 15)
  assert.equal(copies[1].directory, 'C:/project')
  initialPath.value = 'C:/other'
  await flush()
  copies[1].resolve({
    copied: ['C:/project/readme.txt', 'C:/project/photos'],
    failed: [],
  })
  await flush()
  assert.deepEqual(lists, ['C:/project', 'D:/dual', 'D:/dual', 'C:/other'])
  assert.equal(panels[0].props['data-file-directory'], 'C:/other')
  drop(150, 15)
  app.unmount()
  copies[2].resolve({ copied: ['C:/other/readme.txt'], failed: [] })
  await flush()
  assert.equal(handlers.size, 0)
  assert.equal(messages.length, 2)
})
