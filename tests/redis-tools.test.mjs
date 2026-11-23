import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createRenderer,
  h,
  markRaw,
  nextTick,
  reactive,
  vShow,
  withDirectives,
} from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const boundary = dataModule(`
  export const calls = { scans: [], subscriptions: [], publishes: [], stops: [], toasts: [], stopErrors: new Map() }
  /** 记录可由测试手动结束的 IPC 请求，保持真实的先回调后 ID 竞态。 */
  function request(list, fields) {
    return new Promise((resolve, reject) => list.push({ ...fields, resolve, reject }))
  }
  /** 扫描 API 的进度通道与任务 ID Promise 分开驱动。 */
  export function bigKeyScan(sessionId, pattern, emit) { return request(calls.scans, { sessionId, pattern, emit }) }
  /** 订阅 API 的消息通道在任务 ID 返回前也可能发事件。 */
  export function pubsubSubscribe(sessionId, channels, patterns, emit) { return request(calls.subscriptions, { sessionId, channels, patterns, emit }) }
  /** 发布请求保留目标与原文快照。 */
  export function publish(sessionId, channel, message) { return request(calls.publishes, { sessionId, channel, message }) }
  /** 模拟停止后端任务，并允许验证清理失败不会造成未处理拒绝。 */
  export async function stopJob(job) {
    calls.stops.push(job)
    if (calls.stopErrors.has(job)) throw calls.stopErrors.get(job)
  }
  /** 与项目边界保持同样的错误消息归一入口。 */
  export function errorMessage(error) { return error instanceof Error ? error.message : String(error) }
  export const toast = {
    /** 记录公共错误通知。 */
    error(message) { calls.toasts.push({ type: 'error', message }) },
    /** 记录公共成功通知。 */
    success(message) { calls.toasts.push({ type: 'success', message }) },
  }
`)
const { calls } = await import(boundary)
const components = [
  'src/components/workspace/redis/RedisBigKeyPanel.vue',
  'src/components/workspace/redis/RedisPubSubPanel.vue',
  'src/components/ui/AppButton.vue',
  'src/components/ui/AppInput.vue',
  'src/components/ui/AppTextarea.vue',
  'src/components/ui/IconButton.vue',
]
const load = sourceLoader(
  {
    '@/api/redis': boundary,
    '@/composables/useToast': boundary,
    '@/components/ui/AppIcon.vue': dataModule(
      'export default { render() { return null } }'
    ),
  },
  components
)
const { i18n } = await load('src/i18n/index.ts')
const { default: BigKeys } = await load(components[0])
const { default: PubSub } = await load(components[1])

/** 虚拟 DOM 保留实际输入监听、焦点/根节点和滚动能力，不修改共享源码测试 helper。 */
function element(tag, text = '') {
  return markRaw({
    tag,
    type: tag,
    text,
    value: '',
    defaultValue: '',
    style: {},
    props: {},
    children: [],
    parent: null,
    listeners: new Map(),
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 200,
    /** 注册 Vue 原生 v-model 使用的 DOM 事件。 */
    addEventListener(name, callback) {
      const listeners = this.listeners.get(name) ?? []
      listeners.push(callback)
      this.listeners.set(name, listeners)
    },
    /** 删除对应 DOM 事件。 */
    removeEventListener(name, callback) {
      this.listeners.set(
        name,
        (this.listeners.get(name) ?? []).filter(item => item !== callback)
      )
    },
    /** 虚拟元素不属于真实 Document 或 ShadowRoot。 */
    getRootNode() {
      return null
    },
    /** 提供消息流自动滚动的宿主行为。 */
    scrollTo({ top }) {
      this.scrollTop = top
    },
  })
}
const renderer = createRenderer({
  createElement: tag => element(tag),
  createText: text => element('#text', text),
  createComment: text => element('#comment', text),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
    node.children = []
  },
  patchProp: (node, name, old, value) => {
    node.props[name] = value
    if (['value', 'type', 'disabled', 'checked'].includes(name))
      node[name] = value
  },
  parentNode: node => node.parent,
  nextSibling: node =>
    node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  /** 插入或移动节点，保持真实列表顺序。 */
  insert(node, parent, anchor) {
    if (node.parent)
      node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  },
  /** 卸载节点。 */
  remove(node) {
    if (node.parent)
      node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = null
  },
})

/** 等待 IPC Promise、finally 和 Vue 渲染队列全部提交。 */
async function flush() {
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
  await nextTick()
}

/** 递归查找真实渲染后的原生节点。 */
function nodes(root) {
  return [root, ...root.children.flatMap(nodes)]
}

/** 提取可见文本，忽略模板注释节点。 */
function text(root) {
  return [root.tag === '#comment' ? '' : root.text, ...root.children.map(text)]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 创建隔离面板，真实 v-show 模拟内部标签隐藏但不卸载。 */
function fixture(t, Component) {
  calls.scans.length = 0
  calls.subscriptions.length = 0
  calls.publishes.length = 0
  calls.stops.length = 0
  calls.toasts.length = 0
  calls.stopErrors.clear()
  const previous = {
    Document: globalThis.Document,
    ShadowRoot: globalThis.ShadowRoot,
  }
  globalThis.Document ??= class {}
  globalThis.ShadowRoot ??= class {}
  i18n.global.locale.value = 'zh-CN'
  const props = reactive({ sessionId: 'redis-a', database: '0', hidden: false })
  const opened = []
  const root = element('root')
  const app = renderer.createApp({
    render: () =>
      withDirectives(
        h('div', null, [
          h(Component, {
            sessionId: props.sessionId,
            database: props.database,
            onOpen: key => opened.push(key),
          }),
        ]),
        [[vShow, !props.hidden]]
      ),
  })
  app.use(i18n).mount(root)
  let mounted = true
  /** 允许测试在 pending IPC 时提前卸载，并避免重复清理。 */
  function unmount() {
    if (!mounted) return
    mounted = false
    app.unmount()
  }
  t.after(() => {
    unmount()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  })
  return { root, props, opened, unmount }
}

/** 生成实际事件处理器使用的最小 DOM 事件。 */
function event(target, extra = {}) {
  return { target, preventDefault() {}, stopPropagation() {}, ...extra }
}

/** 派发节点上的 Vue 事件，兼容同一键盘事件上的多组修饰器。 */
function dispatch(node, name, extra = {}) {
  const handlers = node.props[name]
  for (const handler of Array.isArray(handlers)
    ? handlers
    : handlers
      ? [handlers]
      : [])
    handler(event(node, extra))
}

/** 通过原生 v-model 的实际 input 监听输入文本。 */
async function fill(root, placeholder, value) {
  const input = nodes(root).find(
    node =>
      ['input', 'textarea'].includes(node.tag) &&
      node.props.placeholder === placeholder
  )
  assert.ok(input, `找不到输入框 ${placeholder}`)
  assert.notEqual(input.props.disabled, true)
  input.value = value
  for (const listener of input.listeners.get('input') ?? [])
    listener(event(input))
  await nextTick()
  return input
}

/** 找到具备可见文案或 aria-label 的原生按钮。 */
function button(root, label) {
  const found = nodes(root).find(
    node =>
      node.tag === 'button' &&
      (text(node) === label || node.props['aria-label'] === label)
  )
  assert.ok(found, `找不到按钮 ${label}`)
  return found
}

/** 模拟按钮点击及原生 submit 默认行为，不绕过 disabled。 */
function click(root, label) {
  const target = button(root, label)
  if (target.props.disabled === true) return false
  dispatch(target, 'onClick')
  if (target.props.type === 'submit') {
    let form = target.parent
    while (form && form.tag !== 'form') form = form.parent
    assert.ok(form)
    dispatch(form, 'onSubmit')
  }
  return true
}

/** 构造包含真实原始键标识的扫描进度。 */
function progress({
  name = 'key-a',
  done = false,
  error = null,
  cancelled = false,
} = {}) {
  return {
    scanned: done ? 2 : 1,
    total: 2,
    done,
    cancelled,
    error,
    keys: [
      {
        key: { id: `raw-${name}`, name },
        keyType: 'string',
        bytes: 100,
        length: 10,
      },
    ],
  }
}

/** 构造完整文本消息，保留实际订阅 API 的消息结构。 */
function message(payload = 'hello', channel = 'news') {
  return {
    channel,
    pattern: null,
    payload: {
      text: payload,
      raw: '',
      binary: false,
      size: payload.length,
      truncated: false,
    },
    receivedAt: 1000,
  }
}

/** 查找发布订阅实际消息列表中的原生消息按钮。 */
function messageButtons(root) {
  const log = nodes(root).find(node => node.props.role === 'log')
  assert.ok(log)
  return nodes(log).filter(node => node.tag === 'button')
}

test('big key pending start is locked, cancel recycles the late id and old finally cannot unlock a newer scan', async t => {
  const { root } = fixture(t, BigKeys)
  click(root, '开始扫描')
  const form = nodes(root).find(node => node.tag === 'form')
  dispatch(form, 'onSubmit')
  assert.equal(calls.scans.length, 1)
  await flush()
  assert.equal(button(root, '取消').props.type, 'button')
  click(root, '取消')
  await flush()
  click(root, '开始扫描')
  await flush()
  assert.equal(calls.scans.length, 2)
  calls.scans[0].resolve(11)
  calls.scans[0].emit(
    progress({ name: 'stale', error: 'stale error', done: true })
  )
  await flush()
  assert.deepEqual(calls.stops, [11])
  assert.equal(calls.toasts.length, 0)
  assert.doesNotMatch(text(root), /stale/)
  assert.ok(button(root, '取消'))
  calls.scans[1].resolve(12)
  calls.scans[1].emit(progress({ name: 'current' }))
  await flush()
  assert.match(text(root), /current/)
})

test('big key database changes clear old results and pending tasks even when sessionId is unchanged', async t => {
  const { root, props, opened } = fixture(t, BigKeys)
  click(root, '开始扫描')
  calls.scans[0].emit(progress({ name: 'db-zero' }))
  await flush()
  assert.match(text(root), /db-zero/)
  props.database = '1'
  await flush()
  assert.doesNotMatch(text(root), /db-zero/)
  calls.scans[0].emit(progress({ name: 'late-db-zero' }))
  calls.scans[0].resolve(21)
  await flush()
  assert.deepEqual(calls.stops, [21])
  assert.doesNotMatch(text(root), /late-db-zero/)
  click(root, '开始扫描')
  calls.scans[1].emit(progress({ name: 'db-one', done: true }))
  calls.scans[1].resolve(22)
  await flush()
  assert.ok(button(root, '开始扫描'))
  assert.match(text(root), /扫描完成/)
  click(root, 'db-one')
  assert.deepEqual(opened, [{ id: 'raw-db-one', name: 'db-one' }])
  props.sessionId = 'redis-b'
  await flush()
  assert.doesNotMatch(text(root), /db-one/)
})

test('big key explicit stop errors are caught while unmounted late ids and failures remain silent', async t => {
  const { root, unmount } = fixture(t, BigKeys)
  click(root, '开始扫描')
  calls.scans[0].resolve(31)
  await flush()
  calls.stopErrors.set(31, new Error('stop failed'))
  click(root, '取消')
  await flush()
  assert.deepEqual(calls.toasts, [{ type: 'error', message: 'stop failed' }])
  click(root, '开始扫描')
  unmount()
  calls.stopErrors.set(32, new Error('disposed stop failed'))
  calls.scans[1].resolve(32)
  calls.scans[1].emit(progress({ done: true, error: 'disposed progress' }))
  await flush()
  assert.deepEqual(calls.stops, [31, 32])
  assert.deepEqual(calls.toasts, [{ type: 'error', message: 'stop failed' }])
})

test('big key start failures restore the button and rejected stale requests do not clear a newer start', async t => {
  const { root } = fixture(t, BigKeys)
  click(root, '开始扫描')
  calls.scans[0].reject(new Error('scan failed'))
  await flush()
  assert.deepEqual(calls.toasts, [{ type: 'error', message: 'scan failed' }])
  assert.ok(button(root, '开始扫描'))
  click(root, '开始扫描')
  await flush()
  click(root, '取消')
  await flush()
  click(root, '开始扫描')
  calls.scans[1].reject(new Error('old failure'))
  await flush()
  assert.ok(button(root, '取消'))
  assert.equal(calls.toasts.length, 1)
  calls.scans[2].resolve(42)
  await flush()
})

test('pending subscription can be cancelled and late id, message, end and finally cannot revive it', async t => {
  const { root } = fixture(t, PubSub)
  await fill(root, '频道，多个用空格或逗号分隔', 'news')
  click(root, '订阅')
  await flush()
  assert.equal(button(root, '订阅').props.disabled, true)
  click(root, '取消')
  await flush()
  click(root, '订阅')
  await flush()
  assert.equal(calls.subscriptions.length, 2)
  calls.subscriptions[0].resolve(51)
  calls.subscriptions[0].emit({
    kind: 'messages',
    items: [message('old message')],
  })
  calls.subscriptions[0].emit({ kind: 'closed', error: 'old end error' })
  await flush()
  assert.deepEqual(calls.stops, [51])
  assert.equal(button(root, '订阅').props.disabled, true)
  assert.equal(messageButtons(root).length, 0)
  assert.equal(calls.toasts.length, 0)
  calls.subscriptions[1].resolve(52)
  await flush()
  calls.subscriptions[1].emit({
    kind: 'messages',
    items: [message('current message')],
  })
  await flush()
  assert.equal(messageButtons(root).length, 1)
  click(root, '退订')
  calls.subscriptions[1].emit({
    kind: 'messages',
    items: [message('after unsubscribe')],
  })
  calls.subscriptions[1].emit({ kind: 'closed', error: 'late close' })
  await flush()
  assert.deepEqual(calls.stops, [51, 52])
  assert.equal(messageButtons(root).length, 1)
  assert.equal(calls.toasts.length, 0)
})

test('unsubscribe all cancels active and pending subscriptions before late callbacks can apply', async t => {
  const { root } = fixture(t, PubSub)
  await fill(root, '频道，多个用空格或逗号分隔', 'first')
  click(root, '订阅')
  calls.subscriptions[0].resolve(61)
  await flush()
  await fill(root, '频道，多个用空格或逗号分隔', 'second')
  click(root, '订阅')
  await flush()
  click(root, '全部退订')
  calls.subscriptions[1].resolve(62)
  calls.subscriptions[0].emit({
    kind: 'messages',
    items: [message('old first')],
  })
  calls.subscriptions[1].emit({
    kind: 'messages',
    items: [message('old second')],
  })
  await flush()
  assert.deepEqual(calls.stops, [61, 62])
  assert.equal(messageButtons(root).length, 0)
  assert.doesNotMatch(text(root), /当前订阅/)
})

test('session and database changes isolate subscription callbacks and late publish feedback', async t => {
  const { root, props } = fixture(t, PubSub)
  await fill(root, '频道，多个用空格或逗号分隔', 'news')
  click(root, '订阅')
  calls.subscriptions[0].resolve(71)
  await flush()
  calls.subscriptions[0].emit({
    kind: 'messages',
    items: [message('old context')],
  })
  await fill(root, '频道', 'publish-old')
  await fill(root, '消息内容（Ctrl+Enter 发布）', 'old payload')
  click(root, '发布')
  assert.equal(calls.publishes.length, 1)
  props.sessionId = 'redis-b'
  props.database = '1'
  await flush()
  assert.equal(messageButtons(root).length, 0)
  assert.deepEqual(calls.stops, [71])
  await fill(root, '频道', 'publish-new')
  await fill(root, '消息内容（Ctrl+Enter 发布）', 'new payload')
  click(root, '发布')
  calls.publishes[0].resolve(10)
  calls.subscriptions[0].emit({ kind: 'closed', error: 'old closed' })
  await flush()
  assert.equal(button(root, '发布').props.disabled, true)
  assert.equal(calls.toasts.length, 0)
  assert.equal(calls.publishes[1].sessionId, 'redis-b')
  calls.publishes[1].resolve(2)
  await flush()
  assert.deepEqual(calls.toasts, [
    { type: 'success', message: '已发布，2 个订阅者收到' },
  ])
  await fill(root, '频道，多个用空格或逗号分隔', 'db-one')
  click(root, '订阅')
  props.database = '2'
  await flush()
  calls.subscriptions[1].resolve(72)
  calls.subscriptions[1].emit({
    kind: 'messages',
    items: [message('wrong db lifecycle')],
  })
  await flush()
  assert.deepEqual(calls.stops, [71, 72])
  assert.equal(messageButtons(root).length, 0)
})

test('unmount recycles pending subscription ids and hides late publish success or errors', async t => {
  const { root, unmount } = fixture(t, PubSub)
  await fill(root, '频道，多个用空格或逗号分隔', 'news')
  click(root, '订阅')
  await fill(root, '频道', 'publish')
  click(root, '发布')
  unmount()
  calls.stopErrors.set(81, new Error('stop after unmount'))
  calls.subscriptions[0].resolve(81)
  calls.subscriptions[0].emit({
    kind: 'messages',
    items: [message('unmounted')],
  })
  calls.publishes[0].reject(new Error('unmounted publish'))
  await flush()
  assert.deepEqual(calls.stops, [81])
  assert.equal(calls.toasts.length, 0)
})

test('v-show retains subscriptions and bounded messages, while pause, filter, clear and keyboard publish remain usable', async t => {
  const { root, props } = fixture(t, PubSub)
  await fill(root, '频道，多个用空格或逗号分隔', 'news news, alerts')
  click(root, '订阅')
  assert.deepEqual(calls.subscriptions[0].channels, ['news', 'alerts'])
  calls.subscriptions[0].resolve(91)
  await flush()
  props.hidden = true
  await flush()
  assert.equal(root.children[0].style.display, 'none')
  calls.subscriptions[0].emit({
    kind: 'messages',
    items: Array.from({ length: 2001 }, (_, index) =>
      message(`payload-${index}`)
    ),
  })
  await flush()
  assert.equal(messageButtons(root).length, 2000)
  assert.deepEqual(calls.stops, [])
  props.hidden = false
  await flush()
  assert.match(text(root), /显示 2000 \/ 收到 2001/)
  await fill(root, '过滤频道或内容', 'payload-2000')
  assert.equal(messageButtons(root).length, 1)
  click(root, '暂停接收')
  calls.subscriptions[0].emit({ kind: 'messages', items: [message('paused')] })
  await flush()
  assert.equal(messageButtons(root).length, 1)
  assert.match(text(root), /收到 2002/)
  click(root, '清空消息')
  await flush()
  assert.equal(messageButtons(root).length, 0)
  assert.match(text(root), /收到 0/)
  click(root, '继续接收')
  await fill(root, '过滤频道或内容', '')
  calls.subscriptions[0].emit({
    kind: 'messages',
    items: [message('after-clear')],
  })
  await flush()
  assert.equal(messageButtons(root).length, 1)
  await fill(root, '频道', 'news')
  const textarea = await fill(
    root,
    '消息内容（Ctrl+Enter 发布）',
    'keyboard payload'
  )
  dispatch(textarea, 'onKeydown', {
    key: 'Enter',
    ctrlKey: true,
    metaKey: false,
  })
  dispatch(textarea, 'onKeydown', {
    key: 'Enter',
    ctrlKey: false,
    metaKey: true,
  })
  assert.equal(calls.publishes.length, 1)
  assert.equal(calls.publishes[0].message, 'keyboard payload')
  calls.publishes[0].resolve(1)
  await flush()
})

/** 隐藏扫描面板不应停任务，提前结束后的 IPC 拒绝也不能重复通知。 */
test('v-show keeps a big key scan alive and an early scan error is notified only once', async t => {
  const { root, props } = fixture(t, BigKeys)
  click(root, '开始扫描')
  props.hidden = true
  await flush()
  calls.scans[0].emit(progress({ name: 'hidden-result' }))
  await flush()
  assert.match(text(root), /hidden-result/)
  assert.deepEqual(calls.stops, [])
  calls.scans[0].emit(progress({ done: true, error: 'scan reported error' }))
  calls.scans[0].reject(new Error('repeated IPC error'))
  await flush()
  assert.deepEqual(calls.toasts, [
    { type: 'error', message: 'scan reported error' },
  ])
  props.hidden = false
  await flush()
  assert.ok(button(root, '开始扫描'))
})

/** pending 扫描取消后仍在同上下文时，后端停止失败要反馈但不得重新激活。 */
test('cancelled pending scan reports a late stop failure without restoring scanning state', async t => {
  const { root } = fixture(t, BigKeys)
  click(root, '开始扫描')
  await flush()
  click(root, '取消')
  calls.stopErrors.set(111, new Error('pending stop failed'))
  calls.scans[0].resolve(111)
  await flush()
  assert.deepEqual(calls.stops, [111])
  assert.deepEqual(calls.toasts, [
    { type: 'error', message: 'pending stop failed' },
  ])
  assert.ok(button(root, '开始扫描'))
})

/** 后端在 ID 前结束不能复活订阅，pending 显式取消的清理失败必须捕获反馈。 */
test('closed-before-id subscriptions never revive and explicit pending unsubscribe failures are caught', async t => {
  const { root } = fixture(t, PubSub)
  await fill(root, '频道，多个用空格或逗号分隔', 'news')
  click(root, '订阅')
  calls.subscriptions[0].emit({
    kind: 'closed',
    error: 'subscription closed early',
  })
  calls.stopErrors.set(121, new Error('cleanup of closed subscription'))
  calls.subscriptions[0].resolve(121)
  calls.subscriptions[0].emit({
    kind: 'messages',
    items: [message('after early close')],
  })
  await flush()
  assert.deepEqual(calls.toasts, [
    { type: 'error', message: 'subscription closed early' },
  ])
  assert.equal(messageButtons(root).length, 0)
  assert.doesNotMatch(text(root), /当前订阅/)
  assert.equal(button(root, '订阅').props.disabled, false)
  click(root, '订阅')
  await flush()
  click(root, '取消')
  calls.stopErrors.set(122, new Error('pending unsubscribe failed'))
  calls.subscriptions[1].resolve(122)
  await flush()
  assert.deepEqual(calls.stops, [121, 122])
  assert.deepEqual(calls.toasts, [
    { type: 'error', message: 'subscription closed early' },
    { type: 'error', message: 'pending unsubscribe failed' },
  ])
})

test('current subscription, stop and publish errors use public toast without leaving busy state locked', async t => {
  const { root } = fixture(t, PubSub)
  await fill(root, '频道，多个用空格或逗号分隔', 'news')
  click(root, '订阅')
  calls.subscriptions[0].reject(new Error('subscribe failed'))
  await flush()
  assert.equal(button(root, '订阅').props.disabled, false)
  click(root, '订阅')
  calls.subscriptions[1].resolve(101)
  await flush()
  calls.stopErrors.set(101, new Error('unsubscribe failed'))
  click(root, '退订')
  await flush()
  await fill(root, '频道', 'news')
  click(root, '发布')
  calls.publishes[0].reject(new Error('publish failed'))
  await flush()
  assert.equal(button(root, '发布').props.disabled, false)
  assert.deepEqual(calls.toasts, [
    { type: 'error', message: 'subscribe failed' },
    { type: 'error', message: 'unsubscribe failed' },
    { type: 'error', message: 'publish failed' },
  ])
})
