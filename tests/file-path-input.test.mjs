import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'
const vue = JSON.stringify(import.meta.resolve('vue'))
const debounceModule = dataModule(`
  export const queued = []
  export const useDebounceFn = fn => {
    let latest
    return (...args) => {
      const run = () => latest === run ? fn(...args) : undefined
      latest = run
      queued.push(run)
    }
  }
  export function useEventListener() {}
`)
const { queued } = await import(debounceModule)
const load = sourceLoader(
  {
    vue: dataModule(`
    export * from ${vue}
    import { BaseTransition } from ${vue}
    export const Transition = BaseTransition
    export const vModelText = {
      beforeMount(el, binding) { el.value = binding.value },
      beforeUpdate(el, binding) { el.value = binding.value },
    }
  `),
    '@vueuse/core': debounceModule,
    'vue-i18n': dataModule(
      'export const useI18n = () => ({ t: value => value })'
    ),
  },
  ['src/components/workspace/RemotePathInput.vue']
)
const { default: PathInput } = await load(
  'src/components/workspace/RemotePathInput.vue'
)
const directory = (path, name = path.split(/[\\/]/).at(-1)) => ({
  path,
  name,
  kind: 'directory',
  size: 0,
})
const descendants = node => [node, ...node.children.flatMap(descendants)]
const text = node => node.text + node.children.map(text).join('')
/** 等待真实 Vue watcher，不用固定时间模拟组件更新。 */
async function flush() {
  for (let count = 0; count < 4; count += 1) await nextTick()
}

/** 渲染真实地址栏，只 mock 原生目录查询和浏览器文本输入指令；事件与候选计算仍走组件源码。 */
async function fixture(t, options = {}) {
  queued.length = 0
  const oldDocument = globalThis.document
  globalThis.document = new EventTarget()
  const navigated = []
  const requests = []
  const props = reactive({
    path: '/root',
    connected: true,
    loading: false,
    contextKey: 'session-1',
    entries: [
      directory('/root/alpha'),
      directory('/root/beta'),
      directory('/root/.hidden'),
    ],
    listDirectory: path => {
      const request = Promise.withResolvers()
      requests.push({ path, ...request })
      return request.promise
    },
    ...options,
  })
  const node = type =>
    markRaw({
      type,
      parent: null,
      children: [],
      props: {},
      text: '',
      value: '',
      contains(target) {
        return descendants(this).includes(target)
      },
      querySelector(selector) {
        const index = Number(selector.match(/data-path-index="(\d+)"/)?.[1])
        return descendants(this).find(
          child => child.props['data-path-index'] === index
        )
      },
      scrollIntoView() {},
      focus() {},
      select() {},
    })
  /** 保持节点移动和卸载顺序，避免虚拟 DOM 快照残留旧候选。 */
  function detach(child) {
    if (child.parent)
      child.parent.children.splice(child.parent.children.indexOf(child), 1)
  }
  const renderer = createRenderer({
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
    },
    parentNode: child => child.parent,
    nextSibling: child =>
      child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  })
  const root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(PathInput, { ...props, onNavigate: path => navigated.push(path) }),
  })
  app.mount(root)
  const input = () => descendants(root).find(child => child.type === 'input')
  let mounted = true
  /** 用真实卸载验证迟到响应，重复清理不会二次卸载组件。 */
  function stop() {
    if (mounted) app.unmount()
    mounted = false
  }
  t.after(() => {
    stop()
    queued.length = 0
    if (oldDocument === undefined) delete globalThis.document
    else globalThis.document = oldDocument
  })
  await flush()
  return {
    props,
    requests,
    navigated,
    input,
    stop,
    options: () =>
      descendants(root).filter(child => child.props.role === 'option'),
    focus: async () => {
      input().props.onFocus()
      await flush()
    },
    type: async (value, isComposing = false) => {
      input().props['onUpdate:modelValue'](value)
      input().props.onInput({ isComposing })
      await flush()
    },
    key: async (key, extra = {}) => {
      const event = {
        key,
        prevented: false,
        preventDefault() {
          this.prevented = true
        },
        stopPropagation() {},
        ...extra,
      }
      input().props.onKeydown(event)
      await flush()
      return event
    },
    send: async () => {
      queued.splice(0).forEach(run => run())
      await flush()
    },
  }
}

test('聚焦当前地址立即展示子目录，直接回车不误进第一条建议，上下键从首项开始', async t => {
  const view = await fixture(t)
  await view.focus()
  assert.equal(view.requests.length, 0)
  assert.equal(view.options().length, 2)
  assert.equal(
    view.options().some(option => option.props['aria-selected']),
    false
  )
  await view.key('Enter')
  assert.deepEqual(view.navigated, ['/root'])
  await view.focus()
  await view.key('ArrowDown')
  assert.equal(view.options()[0].props['aria-selected'], true)
  await view.key('Enter')
  assert.equal(view.navigated.at(-1), '/root/alpha/')
})

test('Tab 只补齐并可连续补多级路径，Enter 才导航，空格路径保持原样', async t => {
  const view = await fixture(t, {
    entries: [directory('/root/My Folder', 'My Folder')],
  })
  await view.focus()
  await view.key('Tab')
  assert.equal(view.input().value, '/root/My Folder/')
  assert.deepEqual(view.navigated, [])
  await view.send()
  assert.equal(view.requests[0].path, '/root/My Folder/')
  view.requests[0].resolve({
    path: '/root/My Folder',
    entries: [directory('/root/My Folder/nested')],
  })
  await flush()
  await view.key('Tab')
  assert.equal(view.input().value, '/root/My Folder/nested/')
  assert.deepEqual(view.navigated, [])
  await view.key('Enter')
  assert.deepEqual(view.navigated, ['/root/My Folder/nested/'])
})

test('其他路径查询实际父目录，同父目录输入只本地筛选，短缓存返回时没有串目录或重复请求', async t => {
  const view = await fixture(t)
  await view.type('/var/l')
  assert.equal(view.options().length, 0, '不应使用/root中的目录项')
  await view.send()
  assert.equal(view.requests[0].path, '/var/')
  await view.type('/var/lo')
  await view.send()
  assert.equal(view.requests.length, 1)
  view.requests[0].resolve({
    path: '/var',
    entries: [directory('/var/log'), directory('/var/lib')],
  })
  await flush()
  assert.match(text(view.options()[0]), /log/)
  assert.equal(view.options().length, 1)
  await view.type('/etc/ho')
  await view.send()
  assert.equal(view.requests.length, 2)
  await view.type('/var/lo')
  assert.equal(view.options().length, 1, '返回刚查过的父目录直接显示缓存')
  await view.send()
  assert.equal(view.requests.length, 2)
})

test('连接切换、关闭和卸载使迟到目录响应失效，Shift+Tab 与输入法回车保持原生行为', async t => {
  const view = await fixture(t)
  await view.type('/var/l')
  await view.send()
  view.props.contextKey = 'session-2'
  await flush()
  await view.send()
  assert.equal(view.requests.length, 2)
  view.requests[0].resolve({
    path: '/var',
    entries: [directory('/var/legacy')],
  })
  await flush()
  assert.equal(view.options().length, 0)
  view.requests[1].resolve({ path: '/var', entries: [directory('/var/log')] })
  await flush()
  assert.equal(view.options().length, 1)
  assert.equal((await view.key('Tab', { shiftKey: true })).prevented, false)
  assert.equal(
    (await view.key('Enter', { isComposing: true })).prevented,
    false
  )
  assert.deepEqual(view.navigated, [])
  await view.key('Escape')
  assert.equal(view.input().value, '/root')
  assert.equal(view.input().props['aria-expanded'], false)
  await view.send()
  assert.equal(view.requests.length, 2)
})

test('本地地址跨盘符补全使用目标盘目录，显式点前缀可以补隐藏目录', async t => {
  const view = await fixture(t, {
    local: true,
    path: 'C:\\work',
    entries: [directory('C:\\work\\.cache', '.cache')],
  })
  await view.type('.')
  assert.equal(view.options().length, 1)
  await view.type('D:\\other\\fo')
  await view.send()
  assert.equal(view.requests[0].path, 'D:\\other\\')
  view.requests[0].resolve({
    path: 'D:\\other',
    entries: [directory('D:\\other\\folder', 'folder')],
  })
  await flush()
  await view.key('Tab')
  assert.equal(view.input().value, 'D:\\other\\folder\\')
  assert.deepEqual(view.navigated, [])
  await view.key('Enter')
  assert.equal(view.navigated[0], 'D:\\other\\folder\\')
})

test('未编辑的规范目录保留尾空格，自动建议失败后继续输入可重试', async t => {
  const view = await fixture(t, { path: '/root/ edge dir ', entries: [] })
  await view.focus()
  await view.key('Enter')
  assert.equal(view.navigated[0], '/root/ edge dir ')
  await view.type('/var/l')
  await view.send()
  view.requests[0].reject(new Error('temporary failure'))
  await flush()
  await view.type('/var/lo')
  await view.send()
  assert.equal(view.requests.length, 2)
  view.requests[1].resolve({ path: '/var', entries: [directory('/var/log')] })
  await flush()
  assert.equal(view.options().length, 1)
})

test('卸载后迟到响应不重开菜单，也不重新发出排队的目录查询', async t => {
  const view = await fixture(t)
  await view.type('/var/l')
  await view.send()
  view.stop()
  view.requests[0].resolve({ path: '/var', entries: [directory('/var/log')] })
  await flush()
  await view.send()
  assert.equal(view.options().length, 0)
  assert.equal(view.requests.length, 1)
})
