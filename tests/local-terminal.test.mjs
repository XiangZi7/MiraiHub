import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

// Exercise the real composable with an in-memory PTY and terminal surface.
globalThis.window = new EventTarget()
const nativeUrl = dataModule(`
  export const calls = { created: [], written: [], closed: [] }
  export const behavior = {}
  let nextId = 0
  export async function create(config) {
    calls.created.push(config)
    const id = 'session-' + ++nextId
    if (behavior.create) await behavior.create(id)
    return id
  }
  export async function write(id, data) {
    calls.written.push({ id, data })
    if (behavior.write) await behavior.write(id)
  }
  export async function close(id) { calls.closed.push(id) }
  export async function resize() {}
  export async function onOutput(handler) {
    behavior.output = handler
    return () => { delete behavior.output }
  }
  export async function onStatus(handler) {
    behavior.status = handler
    return () => { delete behavior.status }
  }
  export function decodeBase64(data) { return data }
  export function reset() {
    for (const values of Object.values(calls)) values.length = 0
    for (const key of Object.keys(behavior)) delete behavior[key]
  }
`)
const native = await import(nativeUrl)
const load = sourceLoader({
  vue: dataModule(`
    export * from ${JSON.stringify(import.meta.resolve('vue'))}
    export function onBeforeUnmount() {}
  `),
  '@vueuse/core': dataModule(`
    export const useDebounceFn = fn => fn
    export function useEventListener() {}
  `),
  '@xterm/addon-fit': dataModule('export class FitAddon { fit() {} }'),
  '@xterm/xterm': dataModule(`
    export class Terminal {
      cols = 80
      rows = 24
      output = []
      focuses = 0
      constructor(options) { this.options = options }
      loadAddon() {}
      open() {}
      onData() {}
      write(data) { this.output.push(data) }
      writeln(data) { this.output.push(data) }
      focus() { this.focuses++ }
      dispose() {}
    }
  `),
  '@/api/local-terminal': nativeUrl,
  '@/api/ssh': dataModule('export const errorMessage = error => error.message'),
  '@/constants/terminal': dataModule(
    'export const currentTerminalTheme = () => ({})'
  ),
  '@/utils/skin-runtime': dataModule(
    "export const SKIN_CHANGE_EVENT = 'skin-change'"
  ),
  '@/composables/useSettings': dataModule(`
    export const settingsSnapshot = () => ({})
    export const useSettings = () => ({ settings: {} })
    export const settingNumber = (_key, fallback) => fallback
  `),
})
const { useLocalTerminal } = await load('src/composables/useLocalTerminal.ts')
const config = { shell: 'cmd', workingDirectory: 'D:/project' }
function setup() {
  native.reset()
  const terminal = useLocalTerminal()
  terminal.mount({})
  return terminal
}

test('legacy and blank configurations start without sending commands', async () => {
  for (const startupCommand of [undefined, '', ' \r\n\t ']) {
    const terminal = setup()
    await terminal.connect({ ...config, startupCommand })
    assert.equal(terminal.status.value, 'connected')
    assert.deepEqual(native.calls.written, [])
    await terminal.disconnect()
  }
})

test('each new local shell session submits multiline startup commands once with normalized Enter keys', async () => {
  for (const shell of ['cmd', 'powershell', 'git-bash']) {
    const terminal = setup()
    const settings = {
      ...config,
      shell,
      startupCommand: 'echo 初始化\r\necho "two words"\necho done\r',
    }
    await terminal.connect(settings)
    const first = terminal.sessionId.value
    await terminal.connect(settings)
    const second = terminal.sessionId.value
    assert.notEqual(first, second)
    assert.deepEqual(
      native.calls.written,
      [first, second].map(id => ({
        id,
        data: 'echo 初始化\recho "two words"\recho done\r',
      }))
    )
    assert.deepEqual(
      native.calls.created,
      [1, 2].map(() => ({ ...config, shell, cols: 80, rows: 24 }))
    )
    assert.deepEqual(native.calls.closed, [first])
    await terminal.disconnect()
  }
})

test('a shell that exits during creation never receives startup commands', async () => {
  const terminal = setup()
  native.behavior.create = id =>
    native.behavior.status({
      sessionId: id,
      status: 'disconnected',
      exitCode: 1,
      reason: null,
    })
  await terminal.connect({ ...config, startupCommand: 'echo ready' })
  assert.equal(terminal.status.value, 'disconnected')
  assert.deepEqual(native.calls.written, [])
  await terminal.disconnect()
})

test('cancelling a pending creation closes the late session without executing commands', async () => {
  const terminal = setup()
  const pending = Promise.withResolvers()
  const started = Promise.withResolvers()
  native.behavior.create = id => {
    started.resolve(id)
    return pending.promise
  }
  const connection = terminal.connect({
    ...config,
    startupCommand: 'echo ready',
  })
  const id = await started.promise
  await terminal.disconnect()
  pending.resolve()
  await connection
  assert.deepEqual(native.calls.written, [])
  assert.deepEqual(native.calls.closed, [id])
  assert.equal(terminal.status.value, 'disconnected')
})

test('startup write errors release the native session and surface the failure', async () => {
  const terminal = setup()
  native.behavior.write = () => {
    throw new Error('PTY unavailable')
  }
  await assert.rejects(
    terminal.connect({ ...config, startupCommand: 'echo ready' }),
    /PTY unavailable/
  )
  assert.equal(terminal.status.value, 'disconnected')
  assert.equal(terminal.error.value, 'PTY unavailable')
  assert.equal(terminal.sessionId.value, '')
  assert.deepEqual(native.calls.closed, [native.calls.written[0].id])
  assert.equal(native.behavior.output, undefined)
  assert.equal(native.behavior.status, undefined)
})

test('a late startup write failure cannot overwrite a newer connected session', async () => {
  const terminal = setup()
  const pending = Promise.withResolvers()
  const started = Promise.withResolvers()
  native.behavior.write = id => {
    started.resolve(id)
    return pending.promise
  }
  const firstConnection = terminal.connect({
    ...config,
    startupCommand: 'echo ready',
  })
  const firstId = await started.promise
  delete native.behavior.write
  await terminal.connect(config)
  const secondId = terminal.sessionId.value
  pending.reject(new Error('Old session closed'))
  await firstConnection
  assert.equal(terminal.status.value, 'connected')
  assert.equal(terminal.sessionId.value, secondId)
  assert.equal(terminal.error.value, '')
  assert.deepEqual(native.calls.closed, [firstId])
  assert.equal(terminal.term.value.focuses, 1)
  await terminal.disconnect()
})
