import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const boundary = dataModule(`
  export const listeners = new Map()
  export const frames = []
  export function useEventListener(type, handler) { listeners.set(type, handler) }
  export function useRafFn(callback) {
    let active = false
    frames.push(delta => { if (active) callback({ delta }) })
    return { pause() { active = false }, resume() { active = true } }
  }
`)
const { listeners, frames } = await import(boundary)
const load = sourceLoader({ '@vueuse/core': boundary })
const { useTabReorder } = await load('src/composables/useTabReorder.ts')
const api = await load('src/api/terminal-commands.ts')

function fixture(t) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  }
  const memory = new Map()
  globalThis.window = new EventTarget()
  globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  }
  listeners.clear()
  frames.length = 0
  const scope = effectScope()
  const rows = api.list().map((command, index) => {
    const row = {
      dataset: { reorderableTabId: command.id },
      getBoundingClientRect: () => ({
        top: 6 + index * 32 - scrollTop,
        height: 32,
        left: 6,
        width: 348,
      }),
      closest: selector =>
        selector === '[data-reorderable-tab-id]' ? row : null,
    }
    return row
  })
  let scrollTop = 0
  const container = {
    get scrollTop() {
      return scrollTop
    },
    set scrollTop(value) {
      scrollTop = Math.max(0, Math.min(192, value))
    },
    contains: element => rows.includes(element),
    getBoundingClientRect: () => ({
      left: 0,
      right: 360,
      top: 0,
      bottom: 140,
      width: 360,
      height: 140,
    }),
    querySelectorAll: () => rows,
  }
  globalThis.document = {
    elementFromPoint: (x, y) => {
      if (x < 6 || x > 354 || y < 0 || y > 140) return null
      return (
        rows.find(row => {
          const rect = row.getBoundingClientRect()
          return y >= rect.top && y < rect.top + rect.height
        }) ?? null
      )
    },
  }
  const commits = []
  const reorder = scope.run(() =>
    useTabReorder({
      tabs: api.list,
      container: () => container,
      axis: 'vertical',
      handle: '[data-command-drag-handle]',
      onReorder: (from, to) => {
        commits.push([from, to])
        const commands = api.list()
        api.reorder(
          commands[from].id,
          commands[to].id,
          from < to ? 'after' : 'before'
        )
      },
    })
  )
  const pointer = (x, y, pointerId = 1, handle = true) => ({
    clientX: x,
    clientY: y,
    pointerId,
    button: 0,
    isPrimary: true,
    target: {
      closest: selector =>
        handle && selector === '[data-command-drag-handle]' ? {} : null,
    },
    currentTarget: { setPointerCapture() {} },
    preventDefault() {},
  })
  const step = () => frames.forEach(frame => frame(16))
  const original = api.list()
  t.after(() => {
    scope.stop()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  })
  return { reorder, pointer, original, commits, container, step }
}

test('vertical drags preview by row height, save on release, and suppress insertion clicks', t => {
  const { reorder, pointer, original, commits } = fixture(t)
  reorder.start(pointer(20, 22), original[0].id)
  listeners.get('pointermove')(pointer(20, 72))
  assert.equal(reorder.targetId.value, original[2].id)
  assert.equal(reorder.targetPosition.value, 'before')
  assert.deepEqual(api.list(), original, 'preview must not write storage')
  listeners.get('pointermove')(pointer(340, 96))
  assert.equal(reorder.targetPosition.value, 'after')
  listeners.get('pointerup')(pointer(340, 96))
  assert.deepEqual(commits, [[0, 2]])
  assert.deepEqual(api.list().slice(0, 3), [
    original[1],
    original[2],
    original[0],
  ])
  assert.equal(reorder.dragging.value, false)
  assert.equal(reorder.consumeSuppressedClick(original[0].id), true)
  assert.equal(reorder.consumeSuppressedClick(original[0].id), false)
})

test('clicks and unrelated controls or pointers do not reorder commands', t => {
  const { reorder, pointer, original, commits } = fixture(t)
  reorder.start(pointer(20, 22, 1, false), original[0].id)
  listeners.get('pointermove')(pointer(20, 96))
  assert.equal(reorder.dragging.value, false)
  reorder.start(pointer(20, 22), original[0].id)
  listeners.get('pointermove')(pointer(20, 96, 2))
  listeners.get('pointerup')(pointer(20, 96, 2))
  assert.equal(reorder.dragging.value, false)
  listeners.get('pointermove')(pointer(21, 24))
  listeners.get('pointerup')(pointer(21, 24))
  assert.equal(reorder.consumeSuppressedClick(original[0].id), false)
  assert.deepEqual(commits, [])
  assert.deepEqual(api.list(), original)
})

test('Escape, pointer cancellation, blur, closing, and dropping outside preserve the order', t => {
  const { reorder, pointer, original, commits } = fixture(t)
  for (const cancel of [
    () => listeners.get('keydown')({ key: 'Escape' }),
    () => listeners.get('pointercancel')(pointer(20, 96)),
    () => listeners.get('blur')(),
    () => reorder.cancel(),
  ]) {
    reorder.start(pointer(20, 22), original[0].id)
    listeners.get('pointermove')(pointer(20, 96))
    cancel()
    listeners.get('pointerup')(pointer(20, 96))
    assert.equal(reorder.dragging.value, false)
    assert.equal(reorder.consumeSuppressedClick(original[0].id), true)
  }
  reorder.start(pointer(20, 22), original[0].id)
  listeners.get('pointermove')(pointer(400, 96))
  assert.equal(reorder.targetId.value, '')
  listeners.get('pointerup')(pointer(400, 96))
  assert.deepEqual(commits, [])
  assert.deepEqual(api.list(), original)
})

test('scrolling at the list edge reveals targets and stops immediately on cancellation', t => {
  const { reorder, pointer, original, commits, container, step } = fixture(t)
  reorder.start(pointer(20, 22), original[0].id)
  listeners.get('pointermove')(pointer(20, 136))
  for (let frame = 0; frame < 30; frame++) step()
  assert.equal(container.scrollTop, 192)
  assert.equal(reorder.targetId.value, original.at(-1).id)
  listeners.get('pointerup')(pointer(20, 136))
  assert.deepEqual(commits, [[0, original.length - 1]])
  assert.equal(api.list().at(-1).id, original[0].id)
  reorder.start(pointer(20, 120), original[0].id)
  listeners.get('pointermove')(pointer(20, 2))
  step()
  assert.ok(container.scrollTop < 192)
  reorder.cancel()
  const stoppedAt = container.scrollTop
  step()
  assert.equal(container.scrollTop, stoppedAt)
})

test('padding supports dropping before the first row and keyboard moves honor list limits', t => {
  const { reorder, pointer, original, commits } = fixture(t)
  reorder.start(pointer(20, 86), original[2].id)
  listeners.get('pointermove')(pointer(2, 2))
  assert.equal(reorder.targetId.value, original[0].id)
  assert.equal(reorder.targetPosition.value, 'before')
  listeners.get('pointerup')(pointer(2, 2))
  assert.equal(api.list()[0].id, original[2].id)
  reorder.moveByKeyboard(original[2].id, -1)
  assert.equal(commits.length, 1)
  reorder.moveByKeyboard(original[2].id, 1)
  assert.equal(api.list()[1].id, original[2].id)
})
