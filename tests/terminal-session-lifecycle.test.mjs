import assert from 'node:assert/strict'
import { test } from 'node:test'

// Vue's development-only readonly wrapper hides template refs' shallow flag.
// Load the production runtime before any Vue imports so this regression stays visible.
process.env.NODE_ENV = 'production'
const { createRenderer, nextTick } = await import('vue')
const { createPinia, disposePinia, setActivePinia } = await import('pinia')
const { dataModule, sourceLoader } = await import('./helpers/source-module.mjs')

const vueUrl = JSON.stringify(import.meta.resolve('vue'))
// Render the real page and terminal panels; replace only terminal/native boundaries.
const sessionsUrl = dataModule(`
  import { shallowRef, onBeforeUnmount } from ${vueUrl}
  export const sessions = []
  function useTerminal(kind) {
    const status = shallowRef('disconnected'), sessionId = shallowRef('')
    const session = { kind, mounts: 0, connects: [], closed: [], status, sessionId }
    sessions.push(session)
    async function disconnect() {
      if (sessionId.value) session.closed.push(sessionId.value)
      sessionId.value = ''
      status.value = 'disconnected'
    }
    async function connect(config, options) {
      await disconnect()
      session.connects.push(JSON.parse(JSON.stringify({ config, options })))
      sessionId.value = kind + '-' + sessions.indexOf(session) + '-' + session.connects.length
      status.value = 'connected'
    }
    onBeforeUnmount(disconnect)
    return {
      term: shallowRef(), status, sessionId, error: shallowRef(''), inputLine: shallowRef(''),
      mount() { session.mounts++ }, connect, disconnect, resize() {}, sendInput() {},
      setInputInterceptor() {}, setSubmitHandler() {},
    }
  }
  export const useSshTerminal = () => useTerminal('ssh')
  export const useLocalTerminal = () => useTerminal('local')
`)
const { sessions } = await import(sessionsUrl)
const load = sourceLoader(
  {
    '@/composables/useSshTerminal': sessionsUrl,
    '@/composables/useLocalTerminal': sessionsUrl,
    '@/composables/useSshShellCompletion': dataModule(`
      import { shallowRef } from ${vueUrl}
      export const useSshShellCompletion = () => ({
        open: shallowRef(false), suggestions: shallowRef([]), close() {},
      })
    `),
    '@vueuse/core': dataModule(`
      import { shallowRef } from ${vueUrl}
      export function useResizeObserver() {}
      export const useWindowSize = () => ({ width: shallowRef(1400) })
      export const useElementSize = () => ({ width: shallowRef(900) })
      export const useStorage = (_key, value) => shallowRef(value)
    `),
    '@/composables/useSettings': dataModule(`
      export const useSettings = () => ({ settings: { autoReconnect: false } })
      export const settingsSnapshot = () => ({ verifyHostKey: true })
      export const settingNumber = (_key, fallback) => fallback
    `),
    '@/stores/settings': dataModule(`
      export const useSettingsStore = () => ({ values: { restoreLastSession: false } })
    `),
    '@/composables/useWorkspaceNavigation': dataModule(`
      import { shallowRef } from ${vueUrl}
      export const useWorkspaceNavigation = () => ({ activeNav: shallowRef('servers') })
    `),
    '@/composables/useWorkspaceControllers': dataModule(`
      export function registerWorkspaceController() {}
    `),
    '@/utils/window': dataModule('export function openConnectionWindow() {}'),
    '@/composables/useToast': dataModule('export const toast = { error() {} }'),
    '@/i18n': dataModule('export const i18n = { global: { t: key => key } }'),
    'vue-i18n': dataModule('export const useI18n = () => ({ t: key => key })'),
    '@xterm/xterm/css/xterm.css': dataModule('export {}'),
  },
  [
    'src/pages/workspace/ServersPage.vue',
    'src/components/workspace/SshTerminalWorkspace.vue',
    'src/components/workspace/TerminalPanel.vue',
    'src/components/workspace/LocalTerminalPanel.vue',
  ]
)
const { default: ServersPage } = await load(
  'src/pages/workspace/ServersPage.vue'
)
const { useWorkspaceStore } = await load('src/stores/workspace.ts')
const { useWorkspaceLayoutStore } = await load('src/stores/workspace-layout.ts')

const flush = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
}

function connection(id, kind = 'ssh') {
  return {
    id,
    kind,
    name: id,
    host: `${id}.example`,
    port: 22,
    username: 'test',
    settings:
      kind === 'ssh'
        ? {
            auth: { type: 'password', password: 'fixture' },
            timeoutSecs: 10,
            keepaliveSecs: 30,
            terminalType: 'xterm-256color',
            startupCommand: '',
          }
        : { shell: 'cmd', workingDirectory: 'D:/project', startupCommand: '' },
  }
}

async function fixture(t, connections) {
  sessions.length = 0
  const pinia = createPinia()
  setActivePinia(pinia)
  const workspace = useWorkspaceStore()
  useWorkspaceLayoutStore().machineOpen = false
  for (const connection of connections) workspace.open(connection)

  const node = type => ({ type, parent: null, children: [], style: {} })
  const detach = child => {
    if (child.parent)
      child.parent.children.splice(child.parent.children.indexOf(child), 1)
  }
  const renderer = createRenderer({
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
    patchProp() {},
    parentNode: child => child.parent,
    nextSibling: child =>
      child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  })
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.cancelAnimationFrame = () => {}
  const app = renderer.createApp(ServersPage)
  app.use(pinia)
  t.after(() => {
    app.unmount()
    disposePinia(pinia)
    if (previousCancel) globalThis.cancelAnimationFrame = previousCancel
    else delete globalThis.cancelAnimationFrame
  })
  app.mount(node('root'))
  await flush()
  return workspace
}

function assertConnectedOnce(session, id) {
  assert.equal(session.mounts, 1)
  assert.equal(session.connects.length, 1)
  assert.deepEqual(session.closed, [])
  assert.equal(session.sessionId.value, id)
  assert.equal(session.status.value, 'connected')
}

test('关闭后台/活动 SSH 标签、打开新标签、排序和批量关闭均保留其他会话', async t => {
  const workspace = await fixture(t, [
    connection('a'),
    connection('b'),
    connection('c'),
    connection('local', 'local'),
  ])
  const [a, b, c, local] = sessions
  const ids = sessions.map(session => session.sessionId.value)
  assert.ok(ids.every(Boolean))

  workspace.close('a')
  await flush()
  assert.deepEqual(a.closed, [ids[0]])
  for (const [i, session] of [a, b, c, local].entries())
    if (i) assertConnectedOnce(session, ids[i])

  workspace.activate('c')
  await flush()
  workspace.close('c')
  await flush()
  assert.deepEqual(c.closed, [ids[2]])
  assertConnectedOnce(b, ids[1])
  assertConnectedOnce(local, ids[3])

  workspace.open(connection('d'))
  await flush()
  const d = sessions.at(-1)
  assert.equal(d.connects.length, 1)
  assertConnectedOnce(b, ids[1])
  const dId = d.sessionId.value
  workspace.reorder(2, 0)
  await flush()
  assertConnectedOnce(b, ids[1])
  assertConnectedOnce(d, dId)

  workspace.closeMany(['b', 'd'])
  await flush()
  assert.deepEqual(b.closed, [ids[1]])
  assert.deepEqual(d.closed, [dId])
  assertConnectedOnce(local, ids[3])
})

test('同值 SSH 配置不重连，真实配置、终端类型和启动命令变化仍触发连接', async t => {
  const original = connection('a')
  const workspace = await fixture(t, [original])
  const [session] = sessions
  const id = session.sessionId.value
  workspace.open(structuredClone(original))
  await flush()
  assertConnectedOnce(session, id)

  const current = workspace.tabs[0].connection
  current.host = 'changed.example'
  await flush()
  assert.equal(session.connects.length, 2)
  assert.equal(session.connects.at(-1).config.host, 'changed.example')
  current.settings.terminalType = 'vt100'
  await flush()
  assert.equal(session.connects.length, 3)
  assert.equal(session.connects.at(-1).options.terminalType, 'vt100')
  current.settings.startupCommand = 'pwd'
  await flush()
  assert.equal(session.connects.length, 4)
  assert.equal(session.connects.at(-1).options.startupCommand, 'pwd')
  assert.equal(session.mounts, 1)
})

test('本地终端同值配置不重启，修改工作目录仍启动新会话', async t => {
  const original = connection('local', 'local')
  const workspace = await fixture(t, [original])
  const session = sessions.find(session => session.kind === 'local')
  const id = session.sessionId.value
  workspace.open(structuredClone(original))
  await flush()
  assertConnectedOnce(session, id)

  workspace.tabs[0].connection.settings.workingDirectory = 'D:/other'
  await flush()
  assert.equal(session.connects.length, 2)
  assert.equal(session.connects.at(-1).config.workingDirectory, 'D:/other')
  assert.deepEqual(session.closed, [id])
  assert.equal(session.mounts, 1)
})
