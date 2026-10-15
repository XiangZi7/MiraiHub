import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, nextTick } from 'vue'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const vueUrl = JSON.stringify(import.meta.resolve('vue'))
const navigationUrl = dataModule(`
  import { reactive } from ${vueUrl}
  export const route = reactive({ meta: { nav: 'servers' } })
  export const useRoute = () => route
  export const useRouter = () => ({ push() {}, replace() {} })
`)
const markersUrl = dataModule(`
  import { h, onMounted, onBeforeUnmount } from ${vueUrl}
  export const mounts = [], unmounts = []
  export const Split = { setup() {
    onMounted(() => mounts.push('split'))
    onBeforeUnmount(() => unmounts.push('split'))
    return () => h('section', { 'data-split-layout': '' })
  } }
  export const Ssh = { props: ['connectionId'], setup(props) {
    onMounted(() => mounts.push(props.connectionId))
    onBeforeUnmount(() => unmounts.push(props.connectionId))
    return () => h('section', { 'data-session': props.connectionId })
  } }
  export const Terminal = { render: () => h('section', { 'data-empty-kind': 'servers' }) }
  export const Database = { props: ['connection'], render() {
    return h('section', this.connection
      ? { 'data-session': this.connection.id }
      : { 'data-empty-kind': 'databases' })
  } }
`)
const load = sourceLoader(
  {
    'vue-router': navigationUrl,
    '@vueuse/core': dataModule(
      'export function useEventListener() {}; export const useWindowSize = () => ({ width: { value: 1400 } })'
    ),
    '@/stores/settings': dataModule(
      'export const useSettingsStore = () => ({ values: { restoreLastSession: false } })'
    ),
    '@/stores/connections': dataModule(
      'export const useConnectionsStore = () => ({})'
    ),
    '@/router': dataModule(
      'export const connectionLocation = connection => ({ params: { connectionId: connection.id } })'
    ),
    '@/composables/useSettings': dataModule(
      'export const settingsSnapshot = () => ({}); export const settingNumber = (_key, fallback) => fallback'
    ),
    '@/composables/useWorkspaceControllers': dataModule(
      'export function registerWorkspaceController() {}'
    ),
    './WorkspaceSplitNode.vue': dataModule(
      `export { Split as default } from ${JSON.stringify(markersUrl)}`
    ),
    '@/components/workspace/SshTerminalWorkspace.vue': dataModule(
      `export { Ssh as default } from ${JSON.stringify(markersUrl)}`
    ),
    '@/components/workspace/TerminalPanel.vue': dataModule(
      `export { Terminal as default } from ${JSON.stringify(markersUrl)}`
    ),
    '@/components/workspace/LocalTerminalPanel.vue': dataModule(
      `export { Ssh as default } from ${JSON.stringify(markersUrl)}`
    ),
    '@/components/workspace/DatabaseView.vue': dataModule(
      `export { Database as default } from ${JSON.stringify(markersUrl)}`
    ),
    '@/components/workspace/RedisView.vue': dataModule(
      `export { Database as default } from ${JSON.stringify(markersUrl)}`
    ),
  },
  [
    'src/components/workspace/WorkspaceConnectionViews.vue',
    'src/pages/workspace/ServersPage.vue',
    'src/pages/workspace/DatabasesPage.vue',
  ]
)
const { route } = await import(navigationUrl)
const { mounts, unmounts } = await import(markersUrl)
const { useWorkspaceStore } = await load('src/stores/workspace.ts')
const { useWorkspaceNavigation } = await load(
  'src/composables/useWorkspaceNavigation.ts'
)
const { useWorkspaceTabSplit, provideWorkspaceTabSplit } = await load(
  'src/composables/useWorkspaceTabSplit.ts'
)
const { default: Views } = await load(
  'src/components/workspace/WorkspaceConnectionViews.vue'
)
// Preload the cache hosts so only Vue's async-component scheduling remains in the fixture.
await load('src/pages/workspace/ServersPage.vue')
await load('src/pages/workspace/DatabasesPage.vue')

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}
const connection = (id, kind = 'ssh') => ({
  id,
  kind,
  name: id,
  host: 'preview.invalid',
  port: 22,
  username: 'preview',
  settings: { auth: { type: 'password', password: '' } },
})
function descendants(node) {
  return [node, ...node.children.flatMap(descendants)]
}
function shown(node) {
  return (
    node.style.display !== 'none' &&
    !node.props.class?.split(' ').includes('hidden') &&
    (!node.parent || shown(node.parent))
  )
}
async function fixture(t, connections) {
  route.meta.nav = 'servers'
  mounts.length = 0
  unmounts.length = 0
  const pinia = createPinia()
  setActivePinia(pinia)
  const workspace = useWorkspaceStore()
  for (const value of connections) workspace.open(value)
  const node = type => ({
    type,
    children: [],
    parent: null,
    props: {},
    style: {},
  })
  const detach = child => {
    if (child.parent)
      child.parent.children.splice(child.parent.children.indexOf(child), 1)
  }
  const renderer = createRenderer({
    querySelector: () => node('body'),
    createElement: node,
    createText: node,
    createComment: node,
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
    setText() {},
    setElementText() {},
    patchProp(element, key, _previous, value) {
      element.props[key] = value
    },
    parentNode: child => child.parent,
    nextSibling: child =>
      child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  })
  let layout, navigation
  const app = renderer.createApp({
    setup() {
      navigation = useWorkspaceNavigation()
      layout = useWorkspaceTabSplit({
        tabs: () => workspace.tabs,
        activeId: () => workspace.activeId,
        enabled: () => navigation.hasOpenSectionTabs.value,
      })
      provideWorkspaceTabSplit(layout)
      return () => h(Views, { closeWarning: () => '' })
    },
  })
  app.use(pinia)
  const root = node('root')
  app.mount(root)
  t.after(() => {
    app.unmount()
    disposePinia(pinia)
  })
  await flush()
  const find = attribute =>
    descendants(root).filter(node => attribute in node.props)
  return { workspace, layout, navigation, root, find }
}

test('只有 SSH 会话时切换数据库，整页显示空状态，返回服务器不重建会话和分屏', async t => {
  const f = await fixture(t, [connection('ssh-a'), connection('ssh-b')])
  f.layout.moveTab('ssh-a', f.layout.tree.value.id, 'right')
  await flush()
  const tree = f.layout.tree.value
  const split = f.find('data-split-layout')[0]
  const originalMounts = [...mounts]
  assert.ok(shown(split))
  route.meta.nav = 'databases'
  await flush()
  assert.equal(shown(split), false)
  assert.equal(f.layout.isVisible('ssh-a'), false)
  const empty = f.find('data-empty-kind')
  assert.equal(empty.length, 1)
  assert.equal(empty[0].props['data-empty-kind'], 'databases')
  assert.ok(shown(empty[0]))
  assert.deepEqual(
    f.workspace.tabs.map(tab => tab.id),
    ['ssh-a', 'ssh-b']
  )
  route.meta.nav = 'servers'
  await flush()
  assert.ok(shown(split))
  assert.equal(f.find('data-empty-kind').length, 0)
  assert.equal(f.layout.tree.value, tree)
  assert.deepEqual(mounts, originalMounts)
  assert.deepEqual(unmounts, [])
})

test('第一个数据库打开后恢复工作区，关闭最后一个数据库后回到整页空状态', async t => {
  const f = await fixture(t, [connection('ssh')])
  route.meta.nav = 'databases'
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, false)
  f.workspace.open(connection('cache', 'redis'))
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, true)
  assert.equal(f.find('data-empty-kind').length, 0)
  assert.ok(shown(f.find('data-split-layout')[0]))
  f.workspace.close('cache')
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, false)
  assert.ok(shown(f.find('data-empty-kind')[0]))
  assert.equal(shown(f.find('data-split-layout')[0]), false)
})

test('本地终端归入服务器，MySQL、PostgreSQL 和 Redis 都归入数据库', async t => {
  const f = await fixture(t, [])
  for (const kind of ['local', 'mysql', 'postgresql', 'redis']) {
    f.workspace.open(connection(kind, kind))
    route.meta.nav = 'databases'
    await flush()
    assert.equal(f.navigation.hasOpenSectionTabs.value, kind !== 'local')
    route.meta.nav = 'servers'
    await flush()
    assert.equal(f.navigation.hasOpenSectionTabs.value, kind === 'local')
    f.workspace.close(kind)
  }
  route.meta.nav = 'ssh-keys'
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, false)
  assert.ok(f.find('data-empty-kind').every(node => !shown(node)))
})
