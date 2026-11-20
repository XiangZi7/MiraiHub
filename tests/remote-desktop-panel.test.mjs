import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, markRaw, nextTick } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const vue = JSON.stringify(import.meta.resolve('vue'))
const nativeModule = dataModule(`
  export const native = { calls: [], stopped: [], trusted: [], errors: [], failure: null }
  export async function startRdp(request, onEvent, onFrame) {
    native.calls.push({ request, onEvent, onFrame })
    if (native.failure) throw native.failure
  }
  export async function stopRdp(id) { native.stopped.push(id) }
  export async function trustRdpCertificate(...args) { native.trusted.push(args) }
  export async function sendRdpInput() {}
`)
const { native } = await import(nativeModule)
const load = sourceLoader(
  {
    '@/api/rdp': nativeModule,
    '@/api/ssh': dataModule(
      'export const errorMessage = error => error.message'
    ),
    '@/stores/connections': dataModule(
      'export const useConnectionsStore = () => ({ find() {} })'
    ),
    '@/types/connection': dataModule(`
    export const isRdpConnection = connection => connection.kind === 'rdp'
    export const endpointOf = connection => connection.host + ':' + connection.port
  `),
    '@/utils/window': dataModule(`
    export const IS_TAURI = false
    export async function isWindowFullscreen() { return false }
    export async function setWindowFullscreen() {}
    export function openConnectionWindow() {}
  `),
    '@/composables/useToast': dataModule(`
    export const toast = { error(value) { native.errors.push(value) }, info() {} }
    import { native } from ${JSON.stringify(nativeModule)}
  `),
    '@/i18n/native': dataModule(
      'export const translateNativeMessage = value => value'
    ),
    'vue-i18n': dataModule(
      'export const useI18n = () => ({ t: value => value })'
    ),
    '@vueuse/core': dataModule(`
    import { shallowRef } from ${vue}
    export const useDebounceFn = fn => fn
    export const useElementSize = () => ({ width: shallowRef(800), height: shallowRef(600) })
    export function useEventListener() {}
  `),
    '@/components/ui/AppButton.vue': dataModule(`
    import { h } from ${vue}
    export default { setup(_props, { attrs, slots }) { return () => h('button', attrs, slots.default?.()) } }
  `),
    '@/components/ui/AppDialog.vue': dataModule(`
    import { h } from ${vue}
    export default { setup(_props, { slots }) { return () => h('div', { role: 'dialog' }, [slots.default?.(), slots.footer?.()]) } }
  `),
  },
  ['src/pages/servers/components/remote-desktop-panel.vue']
)
const { default: Panel } = await load(
  'src/pages/servers/components/remote-desktop-panel.vue'
)
const connection = {
  id: 'rdp-fixture',
  kind: 'rdp',
  name: 'Windows fixture',
  host: 'fixture.invalid',
  port: 3389,
  username: 'Administrator',
  settings: { rdpCredential: 'test-only-encrypted-placeholder' },
}

/** 等待真实组件的 watcher 与首帧显示更新，不使用固定延迟。 */
async function flush() {
  for (let count = 0; count < 5; count++) await nextTick()
}

/** 读取实际渲染树，检查进度条不会被中央加载提示替代。 */
function descendants(node) {
  return [node, ...node.children.flatMap(descendants)]
}

/** 获取可见 DOM 文本；不将 aria-label 当成重复的中央文字。 */
function text(node) {
  return node.text + node.children.map(text).join('')
}

/** 用真实 RDP 组件和可控原生边界验证连接、首帧、证书与取消状态。 */
async function fixture(t, options = {}) {
  native.calls.length = 0
  native.stopped.length = 0
  native.trusted.length = 0
  native.errors.length = 0
  native.failure = options.failure ?? null
  const previous = {}
  for (const key of [
    'window',
    'document',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'ImageData',
  ])
    previous[key] = globalThis[key]
  globalThis.window = new EventTarget()
  globalThis.document = Object.assign(new EventTarget(), {
    fullscreenEnabled: false,
  })
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  globalThis.ImageData = class {
    constructor(data, width, height) {
      Object.assign(this, { data, width, height })
    }
  }
  const node = type =>
    markRaw({
      type,
      parent: null,
      children: [],
      props: {},
      text: '',
      style: {},
      width: 0,
      height: 0,
      getContext: () => ({ clearRect() {}, putImageData() {} }),
      focus() {},
    })
  const body = node('body')
  /** 从原父节点移除节点，保持真实的更新/卸载行为。 */
  function detach(child) {
    if (child.parent)
      child.parent.children.splice(child.parent.children.indexOf(child), 1)
  }
  const renderer = createRenderer({
    querySelector: () => body,
    createElement: node,
    createText: value => Object.assign(node('text'), { text: value }),
    createComment: () => node('comment'),
    insert(child, parent, anchor) {
      detach(child)
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(
        index < 0 ? parent.children.length : index,
        0,
        child
      )
    },
    remove(child) {
      detach(child)
      child.parent = null
    },
    setText(child, value) {
      child.text = value
    },
    setElementText(child, value) {
      child.text = value
      child.children = []
    },
    patchProp(child, key, _old, value) {
      child.props[key] = value
      if (key === 'style') Object.assign(child.style, value)
    },
    parentNode: child => child.parent,
    nextSibling: child =>
      child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  })
  const root = node('root')
  const app = renderer.createApp(Panel, {
    connection,
    active: true,
    connectRequest: 1,
  })
  const api = app.mount(root)
  t.after(async () => {
    app.unmount()
    await flush()
    native.failure = null
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  })
  await flush()
  return {
    api,
    root,
    body,
    bars: () =>
      descendants(root).filter(node => node.props.role === 'progressbar'),
    viewport: () =>
      descendants(root).find(node =>
        node.props.class?.includes('terminal-output')
      ),
    canvas: () => descendants(root).find(node => node.type === 'canvas'),
  }
}

/** 构造真实 RGBA 首帧消息，让组件自行结束首帧等待。 */
function firstFrame() {
  const frame = new ArrayBuffer(16)
  const header = new DataView(frame)
  for (const [offset, value] of [
    [0, 800],
    [2, 600],
    [4, 0],
    [6, 0],
    [8, 1],
    [10, 1],
  ])
    header.setUint16(offset, value, true)
  new Uint8Array(frame, 12).set([0, 0, 0, 255])
  return frame
}

test('RDP 协商和等待首帧都沿用 SSH 顶部进度条，没有中央转圈文字', async t => {
  const view = await fixture(t)
  assert.equal(native.calls.length, 1)
  assert.equal(view.bars().length, 1)
  assert.equal(view.bars()[0].props.class, 'progress-indeterminate')
  assert.equal(view.bars()[0].parent, view.viewport())
  assert.equal(view.bars()[0].props['aria-label'], '连接中…')
  assert.equal(view.viewport().props['aria-busy'], true)
  assert.ok(!text(view.root).includes('连接中…'))
  native.calls[0].onEvent({ type: 'connected' })
  await flush()
  assert.equal(view.bars().length, 1)
  assert.equal(view.bars()[0].props['aria-label'], '正在加载远程桌面…')
  assert.ok(!text(view.root).includes('正在加载远程桌面…'))
  native.calls[0].onFrame(firstFrame())
  await flush()
  assert.equal(view.bars().length, 0)
  assert.equal(view.viewport().props['aria-busy'], false)
  assert.notEqual(view.canvas().style.display, 'none')
  assert.equal(view.canvas().width, 800)
  assert.equal(view.canvas().height, 600)
  assert.ok(text(view.root).includes('已连接'))
})

test('证书核对期间暂停顶部进度条，信任后恢复，连接失败后收起', async t => {
  const view = await fixture(t)
  native.calls[0].onEvent({
    type: 'certificate',
    fingerprint: 'test-fingerprint',
  })
  await flush()
  assert.equal(view.bars().length, 0)
  assert.equal(view.viewport().props['aria-busy'], false)
  const trust = descendants(view.body).find(
    node => node.type === 'button' && text(node) === '仅本次'
  )
  assert.ok(trust)
  trust.props.onClick()
  await flush()
  assert.equal(native.trusted.length, 1)
  assert.equal(view.bars().length, 1)
  native.calls[0].onEvent({ type: 'ended', error: 'fixture network failure' })
  await flush()
  assert.equal(view.bars().length, 0)
  assert.equal(view.viewport().props['aria-busy'], false)
  assert.equal(native.errors.length, 1)
})

test('取消 RDP 连接立即移除顶部进度条并关闭原生会话', async t => {
  const view = await fixture(t)
  await view.api.actionFor(connection.id, 'disconnect')
  await flush()
  assert.equal(view.bars().length, 0)
  assert.equal(view.viewport().props['aria-busy'], false)
  assert.equal(native.stopped.length, 1)
})

test('RDP 启动异常后收起加载条，不恢复中央加载提示', async t => {
  const view = await fixture(t, {
    failure: new Error('fixture startup failure'),
  })
  assert.equal(view.bars().length, 0)
  assert.equal(view.viewport().props['aria-busy'], false)
  assert.equal(native.errors.length, 1)
  assert.ok(!text(view.root).includes('连接中…'))
})
