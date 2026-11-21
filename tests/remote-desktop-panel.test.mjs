import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const vue = JSON.stringify(import.meta.resolve('vue'))
const nativeModule = dataModule(`
  export const native = {
    calls: [], stopped: [], trusted: [], inputs: [], errors: [], operations: [],
    failure: null, start: null, stop: null, input: null,
  }
  export async function startRdp(request, onEvent, onFrame) {
    const call = { request, onEvent, onFrame }
    native.calls.push(call)
    native.operations.push(['start', request.sessionId])
    if (native.failure) throw native.failure
    await native.start?.(call)
  }
  export async function stopRdp(id) {
    native.stopped.push(id)
    native.operations.push(['stop', id])
    await native.stop?.(id)
    native.operations.push(['stopped', id])
  }
  export async function trustRdpCertificate(...args) { native.trusted.push(args) }
  export async function sendRdpInput(id, events) {
    native.inputs.push({ id, events: events.map(event => ({ ...event })) })
    await native.input?.(id, events)
  }
`)
const windowModule = dataModule(`
  export const IS_TAURI = false
  export const windowState = { fullscreen: false, calls: [], read: null, change: null }
  export async function isWindowFullscreen() {
    return windowState.read ? await windowState.read() : windowState.fullscreen
  }
  export async function setWindowFullscreen(enabled) {
    windowState.calls.push(enabled)
    await windowState.change?.(enabled)
    windowState.fullscreen = enabled
  }
  export function openConnectionWindow() {}
`)
const vueuseModule = dataModule(`
  import { onScopeDispose, shallowRef } from ${vue}
  export const elementSize = { width: shallowRef(800), height: shallowRef(600) }
  export const useDebounceFn = fn => fn
  export const useElementSize = () => elementSize
  // 可控计时器保留真实 Vue 作用域清理，让测试精确推进工具栏的隐藏延迟。
  export function useTimeoutFn(fn, delay, options = {}) {
    let timer
    // 取消尚未执行的隐藏回调，避免重入和卸载后触发。
    const stop = () => { clearTimeout(timer); timer = undefined }
    // 每次从新的鼠标离开时刻开始计时，不保留旧回调。
    const start = () => {
      stop()
      timer = setTimeout(() => { timer = undefined; fn() }, delay)
    }
    if (options.immediate !== false) start()
    onScopeDispose(stop)
    return { start, stop }
  }
  export function useEventListener(target, event, listener, options) {
    target.addEventListener(event, listener, options)
    onScopeDispose(() => target.removeEventListener(event, listener, options))
  }
`)
const { native } = await import(nativeModule)
const { windowState } = await import(windowModule)
const { elementSize } = await import(vueuseModule)
const buttonModule = dataModule(`
  import { h } from ${vue}
  export default { setup(_props, { attrs, slots }) { return () => h('button', attrs, slots.default?.()) } }
`)
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
    '@/utils/window': windowModule,
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
    '@vueuse/core': vueuseModule,
    '@/components/ui/AppButton.vue': buttonModule,
    '@/components/ui/IconButton.vue': buttonModule,
    '@/components/ui/AppDialog.vue': dataModule(`
      import { h } from ${vue}
      export default { setup(_props, { slots }) { return () => h('div', { role: 'dialog' }, [slots.default?.(), slots.footer?.()]) } }
    `),
    '@/components/ui/AppContextMenu.vue': dataModule(`
      import { h } from ${vue}
      export default {
        props: ['open', 'items', 'label', 'trigger', 'x', 'y'],
        emits: ['select', 'close'],
        setup(props, { emit }) {
          return () => props.open ? h('div', { role: 'menu', 'aria-label': props.label },
            props.items.map(item => h('button', {
              'data-option': item.id,
              onClick: () => { emit('select', item.id); emit('close') },
            }, item.label))) : null
        },
      }
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

/** 等待真实组件的 watcher、IPC 回执和首帧更新，不使用固定延迟。 */
async function flush() {
  for (let count = 0; count < 12; count++) await nextTick()
}

/** 为启动、停止和输入边界提供可精确控制的回执，测试真实异步竞态。 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** 读取实际渲染树，兼容普通窗口和 Teleport 全屏区域。 */
function descendants(node) {
  return [node, ...node.children.flatMap(descendants)]
}

/** 获取可见 DOM 文本，不将 aria-label 当成中央文字。 */
function text(node) {
  return node.text + node.children.map(text).join('')
}

/** 构造 DOM 按键边界，事件处理仍使用真实组件模板绑定的方法。 */
function key(code, extra = {}) {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  }
}

/** 构造可捕获的鼠标指针，避免依赖 Node 中不存在的 PointerEvent。 */
function pointer(extra = {}) {
  return {
    pointerId: 9,
    button: 0,
    clientX: 30,
    clientY: 40,
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  }
}

/** 用真实 Vue RDP 组件和可控原生/浏览器边界验证输入与会话生命周期。 */
async function fixture(t, options = {}) {
  for (const field of [
    'calls',
    'stopped',
    'trusted',
    'inputs',
    'errors',
    'operations',
  ])
    native[field].length = 0
  native.failure = options.failure ?? null
  native.start = options.start ?? null
  native.stop = null
  native.input = null
  windowState.fullscreen = options.initialFullscreen ?? false
  windowState.calls.length = 0
  windowState.read = null
  windowState.change = null
  elementSize.width.value = 800
  elementSize.height.value = 600
  const previous = {}
  for (const field of [
    'window',
    'document',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'ImageData',
  ])
    previous[field] = globalThis[field]
  globalThis.window = new EventTarget()
  globalThis.document = Object.assign(new EventTarget(), {
    fullscreenEnabled: true,
    fullscreenElement: options.initialFullscreen ? {} : null,
    hidden: false,
    activeElement: null,
  })
  let frameSequence = 0
  const frames = new Map()
  globalThis.requestAnimationFrame = callback => {
    frames.set(++frameSequence, callback)
    return frameSequence
  }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
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
      captured: new Set(),
      contains(target) {
        return descendants(this).includes(target)
      },
      getContext: () => ({ clearRect() {}, putImageData() {} }),
      getBoundingClientRect() {
        return {
          left: 0,
          top: 0,
          bottom: 24,
          width: this.width || 800,
          height: this.height || 600,
        }
      },
      focus() {
        globalThis.document.activeElement = this
      },
      setPointerCapture(id) {
        this.captured.add(id)
      },
      hasPointerCapture(id) {
        return this.captured.has(id)
      },
      releasePointerCapture(id) {
        this.captured.delete(id)
        this.props.onLostpointercapture?.(pointer({ pointerId: id }))
      },
    })
  const body = node('body')
  /** 从原父节点移除节点，保持真实的更新和卸载行为。 */
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
    patchProp(child, field, _old, value) {
      child.props[field] = value
      if (field === 'style') Object.assign(child.style, value)
    },
    parentNode: child => child.parent,
    nextSibling: child =>
      child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  })
  const root = node('root')
  const panelProps = reactive({
    connection: options.connection ?? connection,
    active: true,
    connectRequest: options.connectRequest ?? 1,
  })
  let api
  const app = renderer.createApp({
    setup() {
      return () =>
        h(Panel, {
          ...panelProps,
          ref: value => {
            api = value
          },
        })
    },
  })
  app.mount(root)
  const nodes = () => [...descendants(root), ...descendants(body)]
  const view = {
    get api() {
      return api
    },
    root,
    body,
    nodes,
    frames,
    update: values => Object.assign(panelProps, values),
    bars: () => nodes().filter(node => node.props.role === 'progressbar'),
    viewport: () =>
      nodes().find(node => node.props.class?.includes('terminal-output')),
    canvas: () => nodes().find(node => node.type === 'canvas'),
    // 读取真实顶栏和触发区的模板绑定，检查隐藏状态与悬停、焦点事件。
    header: () => nodes().find(node => node.type === 'header'),
    toolbarTrigger: () =>
      nodes().find(node => node.props.class === 'rdp-toolbar-trigger'),
    button: title =>
      nodes().find(
        node =>
          node.type === 'button' &&
          (node.props.title === title ||
            node.props.title?.startsWith(title + ' ·'))
      ),
    option: id => nodes().find(node => node.props['data-option'] === id),
    fullscreen: () =>
      nodes().some(node => node.props.class?.includes('rdp-fullscreen')),
    async runFrame() {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(0)
      await flush()
    },
  }
  t.after(async () => {
    app.unmount()
    await flush()
    native.failure = null
    for (const [field, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[field]
      else globalThis[field] = value
    }
  })
  options.beforeFlush?.(view)
  await flush()
  return view
}

/** 构造真实 RGBA 首帧消息，让组件自行结束首帧等待并确认远端尺寸。 */
function firstFrame(width = 800, height = 600) {
  const frame = new ArrayBuffer(16)
  const header = new DataView(frame)
  for (const [offset, value] of [
    [0, width],
    [2, height],
    [4, 0],
    [6, 0],
    [8, 1],
    [10, 1],
  ])
    header.setUint16(offset, value, true)
  new Uint8Array(frame, 12).set([0, 0, 0, 255])
  return frame
}

/** 将当前原生会话推进到可输入阶段，不直接修改组件内部状态。 */
async function ready(width = 800, height = 600) {
  const call = native.calls.at(-1)
  call.onEvent({ type: 'connected' })
  call.onFrame(firstFrame(width, height))
  await flush()
}

/** 通过真实顶栏和菜单事件选择显示选项。 */
async function choose(view, title, id) {
  const button = view.button(title)
  assert.ok(button)
  button.props.onClick({ currentTarget: button })
  await flush()
  const option = view.option(id)
  assert.ok(option)
  option.props.onClick()
  await flush()
}

/** 按真实工具栏事件切换全屏，保留原生异步边界的控制权。 */
async function toggleFullscreen(view) {
  const button = view.button('全屏 / 退出')
  assert.ok(button)
  button.props.onClick()
  await flush()
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

for (const reason of ['窗口失焦', '文档隐藏', '丢失指针捕获']) {
  test(`RDP ${reason}立即有序释放全部键鼠，不等待 RAF`, async t => {
    const view = await fixture(t)
    await ready()
    const surface = view.canvas()
    surface.props.onKeydown(key('ControlRight'))
    surface.props.onPointerdown(pointer())
    assert.equal(native.inputs.length, 0)
    assert.equal(view.frames.size, 1)
    assert.equal(surface.hasPointerCapture(9), true)
    if (reason === '窗口失焦') window.dispatchEvent(new Event('blur'))
    else if (reason === '文档隐藏') {
      document.hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    } else {
      surface.captured.delete(9)
      surface.props.onLostpointercapture(pointer())
    }
    await flush()
    assert.equal(view.frames.size, 0)
    assert.equal(surface.hasPointerCapture(9), false)
    assert.deepEqual(native.inputs, [
      {
        id: native.calls[0].request.sessionId,
        events: [
          { type: 'key', code: 0xe01d, pressed: true },
          { type: 'button', button: 0, pressed: true, x: 30, y: 40 },
          { type: 'releaseAll' },
        ],
      },
    ])
  })
}

test('RDP 隐藏窗口的释放继续排空超过 64 条的输入批次', async t => {
  const view = await fixture(t)
  await ready()
  for (let count = 0; count < 70; count++)
    view.canvas().props.onKeydown(key('KeyA'))
  document.hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.deepEqual(
    native.inputs.map(batch => batch.events.length),
    [64, 7]
  )
  assert.equal(native.inputs[1].events.at(-1).type, 'releaseAll')
  assert.equal(view.frames.size, 0)
})

test('RDP 已有输入正在发送时，隐藏通知在回执后直接有序释放而不等待 RAF', async t => {
  const view = await fixture(t)
  await ready()
  const input = deferred()
  native.input = () => (native.inputs.length === 1 ? input.promise : undefined)
  view.canvas().props.onKeydown(key('ControlLeft'))
  await view.runFrame()
  view.canvas().props.onKeydown(key('KeyA'))
  document.hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.equal(native.inputs.length, 1)
  assert.equal(view.frames.size, 0)
  input.resolve()
  await flush()
  assert.deepEqual(native.inputs[1].events, [
    { type: 'key', code: 0x1e, pressed: true },
    { type: 'releaseAll' },
  ])
})

test('RDP 工具栏发送 Ctrl+Alt+Delete 专用原生消息并清除本地指针捕获', async t => {
  const view = await fixture(t)
  await ready()
  view.canvas().props.onKeydown(key('ControlRight'))
  view.canvas().props.onPointerdown(pointer())
  const button = view.button('发送 Ctrl+Alt+Delete')
  assert.ok(button)
  button.props.onClick()
  await flush()
  assert.equal(view.canvas().hasPointerCapture(9), false)
  assert.deepEqual(
    native.inputs[0].events.map(event => event.type),
    ['key', 'button', 'ctrlAltDelete']
  )
  assert.equal(document.activeElement, view.canvas())
  assert.equal(view.frames.size, 0)
})

test('RDP 在 connect 的 nextTick 前取消不会晚启动原生会话', async t => {
  const view = await fixture(t, {
    beforeFlush: view => {
      void view.api.actionFor(connection.id, 'disconnect')
    },
  })
  assert.equal(native.calls.length, 0)
  assert.equal(native.stopped.length, 0)
  assert.equal(view.bars().length, 0)
})

test('RDP 重连必须等待旧停止完成，旧事件和旧帧不能更新新会话', async t => {
  const view = await fixture(t)
  await ready()
  const old = native.calls[0]
  const stop = deferred()
  native.stop = () => stop.promise
  const reconnect = view.api.actionFor(connection.id, 'reconnect')
  await flush()
  assert.equal(native.calls.length, 1)
  assert.equal(view.bars().length, 0)
  stop.resolve()
  await reconnect
  await flush()
  assert.equal(native.calls.length, 2)
  assert.notEqual(native.calls[1].request.sessionId, old.request.sessionId)
  old.onEvent({ type: 'ended', error: 'stale error' })
  old.onFrame(firstFrame(1024, 768))
  await flush()
  assert.equal(view.bars().length, 1)
  assert.equal(view.canvas().width, 800)
  assert.equal(native.errors.length, 0)
})

test('RDP 等待旧停止期间取消重连，不得在停止回执后自动连接', async t => {
  const view = await fixture(t)
  const stop = deferred()
  native.stop = () => stop.promise
  const reconnect = view.api.actionFor(connection.id, 'reconnect')
  await flush()
  const cancel = view.api.actionFor(connection.id, 'disconnect')
  stop.resolve()
  await Promise.all([reconnect, cancel])
  await flush()
  assert.equal(native.calls.length, 1)
  assert.equal(view.bars().length, 0)
})

test('RDP 启动回执未到时重连会再次停止旧会话，新会话在最终停止后才开始', async t => {
  const start = deferred()
  const view = await fixture(t, {
    start: () => (native.calls.length === 1 ? start.promise : undefined),
  })
  const oldId = native.calls[0].request.sessionId
  const reconnect = view.api.actionFor(connection.id, 'reconnect')
  await flush()
  assert.equal(native.calls.length, 1)
  assert.deepEqual(native.stopped, [oldId])
  start.resolve()
  await reconnect
  await flush()
  assert.equal(native.calls.length, 2)
  const nextId = native.calls[1].request.sessionId
  const stopped = native.operations
    .map((operation, index) =>
      operation[0] === 'stopped' && operation[1] === oldId ? index : -1
    )
    .filter(index => index >= 0)
  assert.equal(stopped.length, 2)
  assert.ok(
    native.operations.findIndex(
      operation => operation[0] === 'start' && operation[1] === nextId
    ) > stopped.at(-1)
  )
})

test('RDP 旧输入回执不阻塞新会话，旧输入失败也不能断开或清理新输入', async t => {
  const view = await fixture(t)
  await ready()
  const oldInput = deferred()
  const nextInput = deferred()
  native.input = () =>
    native.inputs.length === 1
      ? oldInput.promise
      : native.inputs.length === 2
        ? nextInput.promise
        : undefined
  view.canvas().props.onKeydown(key('KeyA'))
  await view.runFrame()
  await view.api.actionFor(connection.id, 'reconnect')
  await ready()
  const nextId = native.calls[1].request.sessionId
  view.canvas().props.onKeydown(key('KeyB'))
  await view.runFrame()
  assert.equal(native.inputs[1].id, nextId)
  view.canvas().props.onKeydown(key('KeyC'))
  oldInput.reject(new Error('stale input failure'))
  await flush()
  assert.equal(native.errors.length, 0)
  assert.equal(native.inputs.length, 2)
  assert.equal(view.frames.size, 0)
  assert.equal(view.bars().length, 0)
  nextInput.resolve()
  await flush()
  assert.deepEqual(native.inputs[2], {
    id: nextId,
    events: [{ type: 'key', code: 0x2e, pressed: true }],
  })
  assert.ok(!native.stopped.includes(nextId))
})

test('RDP 全屏默认 fit，退出保留普通缩放，再进入保留用户全屏缩放，断开恢复窗口', async t => {
  const view = await fixture(t, {
    connection: {
      ...connection,
      settings: { ...connection.settings, scale: 'actual' },
    },
  })
  await ready()
  assert.equal(view.canvas().style.width, '800px')
  await toggleFullscreen(view)
  assert.equal(view.fullscreen(), true)
  assert.ok(view.canvas().props.class.includes('rdp-fit'))
  await choose(view, '画面缩放', '150')
  assert.equal(view.canvas().style.width, '1200px')
  await toggleFullscreen(view)
  assert.equal(view.fullscreen(), false)
  assert.equal(view.canvas().style.width, '800px')
  await toggleFullscreen(view)
  assert.equal(view.canvas().style.width, '1200px')
  await view.api.actionFor(connection.id, 'disconnect')
  await flush()
  assert.equal(view.fullscreen(), false)
  assert.equal(windowState.fullscreen, false)
  assert.deepEqual(windowState.calls, [true, false, true, false])
})

test('RDP 断开退出会话全屏时保持此前已有的窗口全屏状态', async t => {
  const view = await fixture(t, { initialFullscreen: true })
  await ready()
  await toggleFullscreen(view)
  await view.api.actionFor(connection.id, 'disconnect')
  await flush()
  assert.equal(view.fullscreen(), false)
  assert.equal(windowState.fullscreen, true)
  assert.deepEqual(windowState.calls, [true, true])
})

test('RDP 读取全屏状态期间取消，不会晚进入全屏', async t => {
  const view = await fixture(t)
  await ready()
  const read = deferred()
  windowState.read = () => read.promise
  await toggleFullscreen(view)
  await view.api.actionFor(connection.id, 'disconnect')
  read.resolve(false)
  await flush()
  assert.equal(view.fullscreen(), false)
  assert.deepEqual(windowState.calls, [])
})

test('RDP 原生全屏进入期间取消，进入回执后立即恢复原窗口状态', async t => {
  const view = await fixture(t)
  await ready()
  const change = deferred()
  windowState.change = enabled => (enabled ? change.promise : undefined)
  await toggleFullscreen(view)
  assert.deepEqual(windowState.calls, [true])
  await view.api.actionFor(connection.id, 'disconnect')
  change.resolve()
  await flush()
  assert.equal(view.fullscreen(), false)
  assert.equal(windowState.fullscreen, false)
  assert.deepEqual(windowState.calls, [true, false])
})

test('RDP 自动 resize 复用待应用分辨率菜单，新远端帧确认后移除重连回退', async t => {
  const view = await fixture(t)
  await ready()
  elementSize.width.value = 1100
  elementSize.height.value = 700
  await flush()
  await view.runFrame()
  assert.deepEqual(native.inputs.at(-1).events, [
    { type: 'resize', width: 1100, height: 700 },
  ])
  await choose(view, '远端分辨率', 'reconnect')
  assert.equal(native.calls.length, 2)
  assert.deepEqual(native.calls[1].request.desktop, {
    width: 1100,
    height: 700,
  })
  await ready(1100, 700)
  const button = view.button('远端分辨率')
  button.props.onClick({ currentTarget: button })
  await flush()
  assert.equal(view.option('reconnect'), undefined)
})

/** 用模拟时钟测试真实全屏顶栏，不等待一秒真实时间，也不直接改组件状态。 */
async function fullscreenToolbarFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const view = await fixture(t)
  await ready()
  await toggleFullscreen(view)
  return view
}

/** 推进隐藏计时并等待 Vue 应用新的可见状态。 */
async function advanceToolbarTime(t, duration) {
  t.mock.timers.tick(duration)
  await flush()
}

test('RDP 进入全屏先展示顶栏，未操作时一秒后隐藏，普通窗口不自动隐藏', async t => {
  const view = await fullscreenToolbarFixture(t)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  await advanceToolbarTime(t, 999)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  await advanceToolbarTime(t, 1)
  assert.equal(view.header().props['data-toolbar-visible'], false)
  await toggleFullscreen(view)
  view.header().props.onPointerleave()
  await advanceToolbarTime(t, 5000)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  assert.equal(view.toolbarTrigger(), undefined)
  assert.equal(view.button('固定全屏工具栏'), undefined)
})

test('RDP 轻微移开顶栏不立即消失，再次进入撤销旧计时，重新离开获得完整缓冲', async t => {
  const view = await fullscreenToolbarFixture(t)
  view.header().props.onPointerenter()
  await advanceToolbarTime(t, 5000)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view.header().props.onPointerleave()
  await advanceToolbarTime(t, 800)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view.header().props.onPointerenter()
  await advanceToolbarTime(t, 3000)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view.header().props.onPointerleave()
  await advanceToolbarTime(t, 999)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  await advanceToolbarTime(t, 1)
  assert.equal(view.header().props['data-toolbar-visible'], false)
})

test('RDP 顶边感应区可找回顶栏，跨入按钮时旧区域离开不覆盖当前悬停', async t => {
  const view = await fullscreenToolbarFixture(t)
  await advanceToolbarTime(t, 1000)
  assert.equal(view.header().props['data-toolbar-visible'], false)
  view.toolbarTrigger().props.onPointerenter()
  await flush()
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view.header().props.onPointerenter()
  view.toolbarTrigger().props.onPointerleave()
  await advanceToolbarTime(t, 3000)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view.header().props.onPointerleave()
  await advanceToolbarTime(t, 1000)
  assert.equal(view.header().props['data-toolbar-visible'], false)
})

test('RDP 下拉菜单期间顶栏保持可见，选择关闭后才开始一秒收起缓冲', async t => {
  const view = await fullscreenToolbarFixture(t)
  view.header().props.onPointerenter()
  const button = view.button('画面缩放')
  button.props.onClick({ currentTarget: button })
  await flush()
  view.header().props.onPointerleave()
  await advanceToolbarTime(t, 5000)
  assert.equal(view.header().props['data-menu-open'], true)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view.option('100').props.onClick()
  await flush()
  assert.equal(view.header().props['data-menu-open'], false)
  await advanceToolbarTime(t, 999)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  await advanceToolbarTime(t, 1)
  assert.equal(view.header().props['data-toolbar-visible'], false)
})

test('RDP 固定按钮保持顶栏并保留标签偏好，取消固定后恢复自动收起且不重连', async t => {
  const view = await fullscreenToolbarFixture(t)
  assert.equal(view.button('固定全屏工具栏').props['aria-pressed'], false)
  view.button('固定全屏工具栏').props.onClick()
  await flush()
  assert.equal(view.button('取消固定全屏工具栏').props['aria-pressed'], true)
  await advanceToolbarTime(t, 5000)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  await toggleFullscreen(view)
  await toggleFullscreen(view)
  await advanceToolbarTime(t, 5000)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view.button('取消固定全屏工具栏').props.onClick()
  await flush()
  assert.equal(document.activeElement, view.canvas())
  await advanceToolbarTime(t, 1000)
  assert.equal(view.header().props['data-toolbar-visible'], false)
  assert.equal(native.calls.length, 1)
})

test('RDP 键盘焦点在工具栏和按钮之间移动时不收起，离开到画布后才隐藏', async t => {
  const view = await fullscreenToolbarFixture(t)
  await advanceToolbarTime(t, 1000)
  view.header().props.onFocusin()
  await advanceToolbarTime(t, 5000)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view
    .header()
    .props.onFocusout({ relatedTarget: view.button('发送 Ctrl+Alt+Delete') })
  await advanceToolbarTime(t, 5000)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  view.header().props.onFocusout({ relatedTarget: view.canvas() })
  await advanceToolbarTime(t, 1000)
  assert.equal(view.header().props['data-toolbar-visible'], false)
})

test('RDP 退出再进入全屏撤销旧隐藏任务，新一轮始终保留完整一秒', async t => {
  const view = await fullscreenToolbarFixture(t)
  await advanceToolbarTime(t, 600)
  await toggleFullscreen(view)
  await toggleFullscreen(view)
  await advanceToolbarTime(t, 450)
  assert.equal(view.header().props['data-toolbar-visible'], true)
  await advanceToolbarTime(t, 550)
  assert.equal(view.header().props['data-toolbar-visible'], false)
})
