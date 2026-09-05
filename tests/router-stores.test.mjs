import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createRenderer, defineComponent, h, KeepAlive, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
const saved = ['a', 'b', 'db'].map(id => ({ id, name: id, kind: id === 'db' ? 'mysql' : 'ssh', group: '', createdAt: 1, settings: {} }))
const settingsApiUrl = dataModule(`
let values = { restoreLastSession: true, uiScale: '100', saveSessionHistory: true }
export const listeners = new Set()
export const loadSettings = () => ({...values})
export const defaultSettings = loadSettings
export const saveSettings = next => { values = {...next}; for(const fn of listeners) fn() }
export const subscribeSettings = fn => { listeners.add(fn); return () => listeners.delete(fn) }
`)
const connectionsApiUrl = dataModule(`
let items = ${JSON.stringify(saved)}
export const listeners = new Set()
export const list = async () => items.map(item => ({...item}))
export const listGroups = async () => []
export const listTags = async () => []
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
export const replace = next => { items = next; for(const fn of listeners) fn() }
export const touch = async () => {}
`)
const load = sourceLoader({ '@/api/settings': settingsApiUrl, '@/api/connections': connectionsApiUrl })
const { resolveWindowEntry } = await load('src/router/window-entry.ts')
const { createAppRouter } = await load('src/router/index.ts')
const { useSettingsStore } = await load('src/stores/settings.ts')
const { useConnectionsStore } = await load('src/stores/connections.ts')
const { useWorkspaceStore } = await load('src/stores/workspace.ts')

function fixture(surface = 'workspace', path = '/servers') {
  storage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(pinia, { surface, path }, createMemoryHistory())
  return { pinia, router, workspace: useWorkspaceStore(pinia), dispose: () => { router.options.history.destroy(); disposePinia(pinia) } }
}

test('兼容 Rust 子窗口 query，原生 label 的窗口身份优先且不泄露编辑目标', () => {
  assert.deepEqual(resolveWindowEntry('?window=connection&type=database&connectionId=db-1', '', 'connection'), { surface: 'connection', path: '/connection/database?connectionId=db-1' })
  assert.deepEqual(resolveWindowEntry('?window=settings', '', 'main'), { surface: 'workspace', path: '/servers' })
  assert.deepEqual(resolveWindowEntry('', '#/settings/ai'), { surface: 'settings', path: '/settings/general' })
  assert.deepEqual(resolveWindowEntry('?window=settings', '#/servers/a', 'remote-editor-123'), { surface: 'remote-editor', path: '/remote-editor' })
})

test('连接深链接、具名导航、前进后退与活动标签保持一致', async () => {
  const { router, workspace, dispose } = fixture()
  try {
    await router.push('/servers/a')
    workspace.setStatus('a', 'connected', 'session-a')
    await router.push('/databases/db')
    await router.push('/recent')
    assert.deepEqual(workspace.tabs.map(tab => tab.id), ['a', 'db'])
    const back = new Promise(resolve => { const stop = router.afterEach(() => { stop(); resolve() }) })
    router.back()
    await back
    assert.equal(router.currentRoute.value.fullPath, '/databases/db')
    assert.equal(workspace.activeId, 'db')
    await router.push({ name: 'servers' })
    assert.equal(router.currentRoute.value.fullPath, '/servers/a')
    assert.equal(workspace.activeId, 'a')
    assert.equal(workspace.active.sessionId, 'session-a')
  } finally { dispose() }
})

test('无效连接、错误类型与未知地址不会打开错误标签或白屏', async () => {
  const { router, workspace, dispose } = fixture()
  try {
    for (const path of ['/servers/missing', '/servers/db', '/databases/a']) {
      await router.push(path)
      assert.deepEqual(workspace.tabs, [])
      assert.ok(['/servers', '/databases'].includes(router.currentRoute.value.fullPath))
    }
    await router.push('/unknown/path')
    assert.equal(router.currentRoute.value.name, 'databases')
    await router.push('/settings/ai')
    assert.equal(router.currentRoute.value.meta.surface, 'workspace')
  } finally { dispose() }
})

test('设置分类参与历史导航，非法分类和跨窗口路径返回当前窗口', async () => {
  const { router, dispose } = fixture('settings', '/settings/general')
  try {
    await router.push('/settings/ai')
    await router.push('/settings/appearance')
    assert.equal(router.currentRoute.value.params.section, 'appearance')
    await router.push('/settings/invalid')
    assert.equal(router.currentRoute.value.fullPath, '/settings/general')
    await router.push('/servers/a')
    assert.equal(router.currentRoute.value.fullPath, '/settings/general')
  } finally { dispose() }
})

test('远端编辑窗口不能通过路由切换打开设置或工作区', async () => {
  const { router, dispose } = fixture('remote-editor', '/remote-editor')
  try {
    for (const path of ['/servers/a', '/settings/ai', '/connection/ssh', '/missing']) {
      await router.push(path)
      assert.equal(router.currentRoute.value.name, 'remote-editor')
    }
  } finally { dispose() }
})

test('设置跨 store 实例同步，连接刷新保持数组引用，销毁时清理订阅', async () => {
  const first = createPinia()
  const second = createPinia()
  const api = await import(settingsApiUrl)
  const connectionsApi = await import(connectionsApiUrl)
  const baseline = api.listeners.size
  try {
    const a = useSettingsStore(first)
    const b = useSettingsStore(second)
    a.save({ ...a.values, uiScale: '125' })
    assert.equal(b.values.uiScale, '125')
    const store = useConnectionsStore(first)
    await store.initialize()
    const reference = store.items
    connectionsApi.replace([...saved, { ...saved[0], id: 'new' }])
    await store.initialize()
    assert.equal(store.items, reference)
    assert.equal(store.items.length, 4)
    assert.equal(api.listeners.size, baseline + 2)
  } finally { disposePinia(first); disposePinia(second); connectionsApi.replace(saved) }
  assert.equal(api.listeners.size, baseline)
  assert.equal(connectionsApi.listeners.size, 0)
})

test('工作区 Store 隔离、恢复去重和关闭后的持久化不包含会话信息', async () => {
  const { pinia, workspace, dispose } = fixture()
  storage.set('miraihub:workspace-tabs', JSON.stringify({ ids: ['a', 'a', 'deleted', 'db'], activeId: 'db' }))
  const other = createPinia()
  try {
    workspace.restore(saved)
    assert.deepEqual(workspace.tabs.map(tab => tab.id), ['a', 'db'])
    assert.deepEqual(useWorkspaceStore(other).tabs, [])
    workspace.setStatus('a', 'connected', 'private-session')
    workspace.closeMany(['db'])
    await nextTick()
    assert.deepEqual(JSON.parse(storage.get('miraihub:workspace-tabs')), { ids: ['a'], activeId: 'a' })
    assert.equal(useWorkspaceStore(pinia), workspace)
  } finally { dispose(); disposePinia(other) }
})

// 用 Vue 的真实 KeepAlive 验证路由页面缓存的生命周期；替代 DOM 的 renderer 只负责节点搬移。
test('按路由名缓存页面，切换连接参数保留草稿，关闭后台标签会卸载对应会话', async () => {
  const node = type => ({ type, parent: null, children: [] })
  const detach = child => { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1) }
  const renderer = createRenderer({
    createElement: node, createText: node, createComment: node,
    insert(child, parent, anchor) { detach(child); child.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, child) },
    remove(child) { detach(child); child.parent = null }, setText() {}, setElementText() {}, patchProp() {},
    parentNode: child => child.parent, nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  })
  const current = ref('servers')
  const ids = ref(['a'])
  let mounted = 0, unmounted = 0, draft
  const Session = defineComponent({ setup() { onMounted(() => mounted++); onUnmounted(() => unmounted++); return () => h('div') } })
  const Servers = defineComponent({ setup() { draft = ref('SELECT 1'); return () => h('div', ids.value.map(id => h(Session, { key: id }))) } })
  const Recent = defineComponent({ render: () => h('div') })
  const app = renderer.createApp({ render: () => h(KeepAlive, null, { default: () => h(current.value === 'servers' ? Servers : Recent, { key: current.value }) }) })
  app.mount(node('root'))
  await nextTick()
  draft.value = 'unsaved SQL'
  current.value = 'recent'
  await nextTick()
  assert.equal(unmounted, 0)
  ids.value = []
  await nextTick()
  assert.equal(unmounted, 1)
  current.value = 'servers'
  await nextTick()
  assert.equal(draft.value, 'unsaved SQL')
  assert.equal(mounted, 1)
  app.unmount()
})
