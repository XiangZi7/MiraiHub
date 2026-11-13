import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

globalThis.requestAnimationFrame = () => 0
globalThis.cancelAnimationFrame = () => {}

const nativeModule = dataModule(`
  export const native = { connected: [], closed: [], output: new Map(), status: new Map(), handlers: {} }
  export async function connect(config) {
    const id = 'ssh-' + (native.connected.length + 1)
    native.connected.push(id)
    await native.handlers.connect?.(id)
    return id
  }
  export async function disconnect(id) {
    native.closed.push(id)
    await native.handlers.close?.(id)
  }
  export async function onStatus(id, callback) {
    native.status.set(id, callback)
    return () => native.status.delete(id)
  }
  export async function openShell(id, options, callback) { native.output.set(id, callback) }
  export async function writeToShell() {}
  export async function resizeShell() {}
  export const errorMessage = error => error.message
`)
const xtermModule = dataModule(`
  import { shallowRef } from ${JSON.stringify(import.meta.resolve('vue'))}
  export function useXterm() {
    const term = shallowRef()
    return {
      term, fitAddon: shallowRef(), stopSettingsWatch() {},
      writeOutput(data) { term.value.write(data) }, resetOutput() {},
      open() {
        term.value = {
          cols: 80, rows: 24, screen: '', pending: [], focuses: 0,
          onResize() {}, onData() {}, reset() { this.screen = '' },
          write(data) { this.pending.push(typeof data === 'string' ? data : new TextDecoder().decode(data)) },
          writeln(data) { this.write(data + '\\r\\n') },
          flush() {
            for (const data of this.pending.splice(0)) {
              if (data === '\\x1bc') this.screen = ''
              else this.screen += data
            }
          },
          focus() { this.focuses++ }, dispose() {},
        }
        return term.value
      },
    }
  }
`)
const load = sourceLoader({
  vue: dataModule(`
    export * from ${JSON.stringify(import.meta.resolve('vue'))}
    export function onBeforeUnmount() {}
  `),
  '@vueuse/core': dataModule('export const useDebounceFn = fn => fn'),
  '@/api/ssh': nativeModule,
  '@/composables/useXterm': xtermModule,
  '@/i18n': dataModule('export const i18n = { global: { t: value => value } }'),
  '@/i18n/native': dataModule(
    'export const translateNativeMessage = value => value'
  ),
  '@/utils/terminal-recording': dataModule(
    'export function recordOutput() {}\nexport function recordResize() {}'
  ),
})
const { native } = await import(nativeModule)
const { useSshTerminal } = await load('src/composables/useSshTerminal.ts')
const config = {
  host: 'fixture.invalid',
  port: 22,
  username: 'test',
  auth: { type: 'agent' },
}

/** 为每个连接场景建立独立终端，原生边界可控制旧会话关闭的时机。 */
function fixture(t) {
  native.connected.length = 0
  native.closed.length = 0
  native.output.clear()
  native.status.clear()
  native.handlers = {}
  const api = useSshTerminal()
  api.mount({})
  t.after(async () => {
    native.handlers = {}
    await api.disconnect()
  })
  return api
}

test('重连立即清空旧屏，排队及迟到的旧输出不再混入新会话', async t => {
  const api = fixture(t)
  await api.connect(config)
  const oldId = api.sessionId.value
  const oldOutput = native.output.get(oldId)
  const oldStatus = native.status.get(oldId)
  const terminal = api.term.value
  oldOutput(new TextEncoder().encode('old prompt'))
  terminal.flush()
  assert.equal(terminal.screen, 'old prompt')
  oldOutput(new TextEncoder().encode('queued old output'))

  const closing = Promise.withResolvers()
  native.handlers.close = () => closing.promise
  const reconnecting = api.connect(config)
  assert.equal(api.status.value, 'connecting')
  assert.equal(api.sessionId.value, '')
  assert.equal(terminal.screen, '')
  oldOutput(new TextEncoder().encode('late old output'))
  oldStatus({
    status: 'disconnected',
    reason: 'old connection closed',
    exitCode: null,
  })
  terminal.flush()
  assert.equal(terminal.screen, '')
  assert.equal(api.status.value, 'connecting')

  closing.resolve()
  await reconnecting
  native.output.get(api.sessionId.value)(new TextEncoder().encode('new prompt'))
  terminal.flush()
  assert.equal(terminal.screen, 'new prompt')
  assert.equal(api.status.value, 'connected')
  assert.deepEqual(native.closed, [oldId])
})

test('等待旧连接关闭时取消重连，不会在关闭完成后重新发起连接', async t => {
  const api = fixture(t)
  await api.connect(config)
  const closing = Promise.withResolvers()
  native.handlers.close = () => closing.promise
  const reconnecting = api.connect(config)
  await api.disconnect()
  closing.resolve()
  await reconnecting
  assert.equal(api.status.value, 'disconnected')
  assert.equal(api.sessionId.value, '')
  assert.equal(native.connected.length, 1)
})

test('重叠的连接请求只保留最新会话，旧请求迟到时只回收自己的连接', async t => {
  const api = fixture(t)
  const first = Promise.withResolvers()
  native.handlers.connect = id => (id === 'ssh-1' ? first.promise : undefined)
  const earlier = api.connect(config)
  await api.connect(config)
  const latestId = api.sessionId.value
  native.output.get(latestId)(new TextEncoder().encode('latest prompt'))
  api.term.value.flush()
  first.resolve()
  await earlier
  assert.equal(api.sessionId.value, latestId)
  assert.equal(api.status.value, 'connected')
  assert.equal(api.term.value.screen, 'latest prompt')
  assert.deepEqual(native.closed, ['ssh-1'])
})
