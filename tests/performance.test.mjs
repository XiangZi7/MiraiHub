import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, KeepAlive, nextTick, ref } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const { textMetrics } = await load('src/utils/text-metrics.ts')
const { sparklineGeometry } = await load('src/utils/sparkline.ts')

test('UTF-8 statistics match encoded bytes, including surrogate pairs, CRLF and 1 MB drafts', () => {
  for (const text of [
    '',
    'a\r\nb\n',
    '中文😀e\u0301',
    '\ud800x\udc00',
    'a'.repeat(1024 * 1024),
    '中😀\n'.repeat(150000),
  ]) {
    assert.deepEqual(textMetrics(text), {
      lines: text.split('\n').length,
      bytes: new TextEncoder().encode(text).length,
    })
  }
})

test('trend geometry stays finite for empty, flat, negative and invalid samples', () => {
  assert.deepEqual(sparklineGeometry([]), { line: '', area: '' })
  assert.match(sparklineGeometry([0]).line, /M0.00,50.00 L300.00,50.00/)
  assert.equal(sparklineGeometry([5, 5]).line, sparklineGeometry([0, 0]).line)
  for (const values of [
    [-5, 0, 5],
    [NaN, Infinity, -Infinity],
    Array.from({ length: 44 }, (_, i) => i),
  ]) {
    const result = sparklineGeometry(values)
    assert.doesNotMatch(result.line, /NaN|Infinity/)
    assert.match(result.area, /L300,100 L0,100 Z$/)
  }
})

const visibilityUrl = dataModule(
  `import { ref } from '${import.meta.resolve('vue')}'; export const visibility = ref('visible'); export const useDocumentVisibility = () => visibility`
)
const sshUrl = dataModule(
  `export const calls = []; export const systemStats = id => new Promise((resolve, reject) => calls.push({ id, resolve, reject })); export const errorMessage = error => String(error)`
)
const pollLoad = sourceLoader({
  '@vueuse/core': visibilityUrl,
  '@/api/ssh': sshUrl,
})
const { visibility } = await import(visibilityUrl)
const { calls } = await import(sshUrl)
const { useSystemStats } = await pollLoad('src/composables/useSystemStats.ts')
const flush = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
}
const snapshot = {
  cpu: { usage: 25 },
  memory: { usedKb: 1, totalKb: 2 },
  disk: { usedKb: 1, totalKb: 4 },
  network: { rxBytesPerSec: 1, txBytesPerSec: 2 },
}
function fixture() {
  calls.length = 0
  visibility.value = 'visible'
  const node = type => ({ type, parent: null, children: [] })
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
      const i = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(i < 0 ? parent.children.length : i, 0, child)
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
  const session = ref('a'),
    shown = ref(true)
  let result
  const Stats = {
    setup() {
      result = useSystemStats(session)
      return () => h('div')
    },
  }
  const Other = { render: () => h('div') }
  const app = renderer.createApp({
    render: () =>
      h(KeepAlive, null, { default: () => h(shown.value ? Stats : Other) }),
  })
  app.mount(node('root'))
  return { result, session, shown, app }
}

test('cached and hidden pages stop polling; resuming preserves history; unmount cancels timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  t.after(() => f.app.unmount())
  assert.equal(calls.length, 1)
  calls[0].resolve(snapshot)
  await flush()
  assert.equal(f.result.history.value.cpu.length, 1)
  visibility.value = 'hidden'
  await flush()
  t.mock.timers.tick(20000)
  await flush()
  assert.equal(calls.length, 1)
  visibility.value = 'visible'
  await flush()
  assert.equal(calls.length, 2)
  calls[1].resolve(snapshot)
  await flush()
  assert.equal(f.result.history.value.cpu.length, 2)
  f.shown.value = false
  await flush()
  t.mock.timers.tick(20000)
  await flush()
  assert.equal(calls.length, 2)
  f.shown.value = true
  await flush()
  assert.equal(calls.length, 3)
  f.app.unmount()
  calls[2].resolve(snapshot)
  await flush()
  t.mock.timers.tick(20000)
  await flush()
  assert.equal(calls.length, 3)
})

test('stale failures cannot overwrite a new session, and visibility churn never duplicates in-flight requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  t.after(() => f.app.unmount())
  visibility.value = 'hidden'
  await flush()
  visibility.value = 'visible'
  await flush()
  assert.equal(calls.length, 1)
  f.session.value = 'b'
  await flush()
  assert.equal(calls.length, 2)
  calls[1].resolve(snapshot)
  calls[0].reject(new Error('old server failed'))
  await flush()
  assert.equal(f.result.error.value, '')
  assert.equal(f.result.stats.value.cpu.usage, 25)
  assert.equal(f.result.history.value.cpu.length, 1)
})

test('child-window readiness waits for paint and has a single bounded fallback for hidden WebViews', async t => {
  const coreUrl = dataModule(
    `export const calls = []; export const invoke = async (...args) => { calls.push(args) }`
  )
  const windowUrl = dataModule(`export const getCurrentWindow = () => ({})`)
  const native = await import(coreUrl)
  const previousWindow = globalThis.window
  globalThis.window = { __TAURI_INTERNALS__: {} }
  const frames = new Map()
  let sequence = 0
  const oldRequest = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = cb => {
    frames.set(++sequence, cb)
    return sequence
  }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  t.after(() => {
    globalThis.window = previousWindow
    globalThis.requestAnimationFrame = oldRequest
    globalThis.cancelAnimationFrame = oldCancel
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const readyLoad = sourceLoader({
    '@tauri-apps/api/core': coreUrl,
    '@tauri-apps/api/window': windowUrl,
  })
  const { windowReady } = await readyLoad('src/utils/window.ts')
  const promise = windowReady('mica')
  assert.equal(native.calls.length, 0)
  const first = [...frames.values()][0]
  frames.clear()
  first()
  assert.equal(native.calls.length, 0)
  const second = [...frames.values()][0]
  frames.clear()
  second()
  await promise
  assert.deepEqual(native.calls, [['window_ready', { material: 'mica' }]])
  t.mock.timers.tick(100)
  await flush()
  assert.equal(native.calls.length, 1)
  const hidden = windowReady('acrylic')
  t.mock.timers.tick(100)
  await hidden
  assert.equal(frames.size, 0)
  assert.deepEqual(native.calls[1], ['window_ready', { material: 'acrylic' }])
})
