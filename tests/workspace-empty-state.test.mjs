import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, nextTick, reactive } from 'vue'
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
  export const Database = { props: ['connection', 'workspaceHostId'], render() {
    return h('section', this.connection
      ? { 'data-session': this.connection.id, 'data-workspace-host': this.workspaceHostId }
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
const {
  provideDatabaseWorkspaceTabs,
  workspaceViewTabs,
  databaseWorkspaceTabId,
} = await load('src/composables/useDatabaseWorkspaceTabs.ts')
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
  let layout, navigation, databaseTabs
  const app = renderer.createApp({
    setup() {
      navigation = useWorkspaceNavigation()
      databaseTabs = provideDatabaseWorkspaceTabs()
      layout = useWorkspaceTabSplit({
        tabs: () => workspaceViewTabs(workspace.tabs, databaseTabs),
        activeId: () => {
          const content = databaseTabs.get(workspace.activeId)?.activeId()
          return content
            ? databaseWorkspaceTabId(workspace.activeId, content)
            : workspace.activeId
        },
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
  return { workspace, layout, navigation, databaseTabs, root, find }
}

test('数据库跨屏显示时新增表不搬走目录树，只有拖动连接标签才改变所在分屏', async t => {
  const f = await fixture(t, [connection('db', 'mysql')])
  const record = reactive({
    tabs: [
      { id: 'a', label: 'Left table' },
      { id: 'b', label: 'Right table' },
    ],
    activeId: 'a',
  })
  f.databaseTabs.set('db', {
    tabs: () => record.tabs,
    activeId: () => record.activeId,
    select: id => {
      record.activeId = id
    },
    add() {},
    close() {},
    reorder() {},
    contextItems: () => [],
    action: async () => {},
  })
  await flush()
  const content = id => databaseWorkspaceTabId('db', id)
  const leftGroup = f.layout.groupForTab('db').id
  const target = type => ({
    type,
    props: {},
    style: {},
    children: [],
    parent: null,
  })
  const left = target('left'),
    right = target('right')
  f.layout.setTarget(leftGroup, left)
  assert.ok(f.layout.moveTab(content('b'), leftGroup, 'right'))
  const rightGroup = f.layout.groupForTab(content('b')).id
  f.layout.setTarget(rightGroup, right)
  f.layout.activate(content('a'))
  await flush()
  const shell = () =>
    descendants(left).find(node => node.props['data-session'] === 'db')
  const original = shell()
  assert.ok(original)
  assert.equal(original.props['data-workspace-host'], content('a'))

  // 新表追加在已分屏的旧表之后，复现按可见标签顺序选择宿主的错误。
  record.tabs.push({ id: 'c', label: 'New table' })
  record.activeId = 'c'
  await flush()
  assert.equal(f.layout.groupForTab(content('c')).id, leftGroup)
  assert.equal(shell(), original)
  assert.equal(original.props['data-workspace-host'], content('c'))
  assert.equal(
    descendants(right).some(node => node.props['data-session'] === 'db'),
    false
  )

  // 切到右侧已有表也不搬侧栏；改变标签顺序不会改变连接归属。
  record.activeId = 'b'
  await flush()
  record.tabs.reverse()
  await flush()
  assert.equal(shell(), original)
  assert.equal(original.props['data-workspace-host'], content('c'))

  // 用户显式拖动连接标签后，目录树才跟随连接进入另一屏。
  assert.ok(f.layout.moveTab('db', rightGroup, 'center'))
  record.activeId = ''
  await flush()
  assert.equal(
    descendants(right).find(node => node.props['data-session'] === 'db'),
    original
  )
  assert.equal(original.props['data-workspace-host'], 'db')
})

test('切换服务器与数据库分类始终保留已打开标签、会话和分屏', async t => {
  const f = await fixture(t, [connection('ssh-a'), connection('ssh-b')])
  f.layout.moveTab('ssh-a', f.layout.tree.value.id, 'right')
  await flush()
  const tree = f.layout.tree.value
  const split = f.find('data-split-layout')[0]
  const originalMounts = [...mounts]
  assert.ok(shown(split))
  route.meta.nav = 'databases'
  await flush()
  assert.equal(shown(split), true)
  assert.equal(f.layout.isVisible('ssh-a'), true)
  const empty = f.find('data-empty-kind')
  assert.equal(empty.length, 0)
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

test('数据库与 SSH 标签同时常驻，全部关闭才显示整页空状态', async t => {
  const f = await fixture(t, [connection('ssh')])
  route.meta.nav = 'databases'
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, true)
  f.workspace.open(connection('cache', 'redis'))
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, true)
  assert.equal(f.find('data-empty-kind').length, 0)
  assert.ok(shown(f.find('data-split-layout')[0]))
  f.workspace.close('cache')
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, true)
  assert.ok(shown(f.find('data-split-layout')[0]))
  f.workspace.close('ssh')
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, false)
  assert.ok(shown(f.find('data-empty-kind')[0]))
  assert.equal(shown(f.find('data-split-layout')[0]), false)
})

test('本地终端和各数据库类型均在服务器与数据库分类保持常驻', async t => {
  const f = await fixture(t, [])
  for (const kind of ['local', 'mysql', 'postgresql', 'redis']) {
    f.workspace.open(connection(kind, kind))
    route.meta.nav = 'databases'
    await flush()
    assert.equal(f.navigation.hasOpenSectionTabs.value, true)
    route.meta.nav = 'servers'
    await flush()
    assert.equal(f.navigation.hasOpenSectionTabs.value, true)
    f.workspace.close(kind)
  }
  route.meta.nav = 'ssh-keys'
  await flush()
  assert.equal(f.navigation.hasOpenSectionTabs.value, false)
  assert.ok(f.find('data-empty-kind').every(node => !shown(node)))
})
