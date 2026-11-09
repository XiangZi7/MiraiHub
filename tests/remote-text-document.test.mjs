import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, nextTick } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const boundary = dataModule(`
  export const calls = [];
  export const handlers = new Map();
  export const notices = [];
  export const snapshot = { id: 'text-1', text: 'original', path: '/demo.conf' };
  export let write = async (_id, text) => ({ ...snapshot, text });
  export const setWrite = value => { write = value };
  export const openText = async () => ({ ...snapshot });
  export const closeText = async () => {};
  export const saveText = (...args) => { calls.push(args); return write(...args) };
  export const errorMessage = error => error.message;
  export const isAppError = error => Boolean(error && typeof error.kind === 'string');
  export const useEventListener = (_target, name, handler) => { handlers.set(name, handler) };
  export const i18n = { global: { t: key => key } };
  export const toast = {
    success: text => notices.push(['success', text]),
    info: text => notices.push(['info', text]),
  };
`)
const api = await import(boundary)
const load = sourceLoader({
  '@/api/operations': boundary,
  '@/api/ssh': boundary,
  '@/i18n': boundary,
  '@/composables/useToast': boundary,
  '@vueuse/core': boundary,
})
const { useRemoteTextDocument } = await load(
  'src/composables/useRemoteTextDocument.ts'
)
const renderer = createRenderer({
  createElement: type => ({ type, children: [] }),
  createText: text => ({ text }),
  createComment: text => ({ text }),
  insert: (child, parent) => parent.children.push(child),
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
})

/** 等待文档加载、保存结果及状态订阅完成。 */
async function flush() {
  for (let index = 0; index < 5; index++) await nextTick()
}

/** 挂载真实文档生命周期，仅替换远端读写和通知边界。 */
async function fixture(t) {
  const previousWindow = globalThis.window
  globalThis.window = {}
  api.calls.length = 0
  api.notices.length = 0
  api.setWrite(async (_id, text) => ({ ...api.snapshot, text }))
  const closed = []
  const statuses = []
  let editor
  const app = renderer.createApp({
    setup() {
      editor = useRemoteTextDocument(
        { sessionId: 'session-1', path: '/demo.conf', connectionName: 'Demo' },
        true,
        () =>
          closed.push({ dirty: editor.dirty.value, busy: editor.state.busy }),
        (dirty, busy) => statuses.push({ dirty, busy })
      )
      return () => h('div')
    },
  })
  app.mount({ children: [] })
  t.after(() => {
    app.unmount()
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })
  await flush()
  return { editor, closed, statuses }
}

test('clean close is immediate; editing opens confirmation and cancellation retains the draft', async t => {
  const { editor, closed } = await fixture(t)
  editor.requestClose()
  assert.equal(closed.length, 1)
  editor.state.draft = 'changed'
  editor.requestClose()
  assert.equal(editor.state.discard, 'close')
  assert.equal(closed.length, 1)
  editor.state.discard = ''
  assert.equal(editor.state.draft, 'changed')
  assert.equal(editor.dirty.value, true)
  editor.requestClose()
  editor.confirmDiscard()
  assert.equal(closed.length, 2)
  assert.equal(api.calls.length, 0)
})

test('save and close waits for the write and clears busy status before closing', async t => {
  const { editor, closed, statuses } = await fixture(t)
  let complete
  api.setWrite(
    () =>
      new Promise(resolve => {
        complete = resolve
      })
  )
  editor.state.draft = 'changed'
  editor.requestClose()
  const pending = editor.saveAndClose()
  assert.equal(editor.state.busy, true)
  assert.equal(closed.length, 0)
  await editor.saveAndClose()
  editor.confirmDiscard()
  assert.equal(api.calls.length, 1)
  assert.equal(closed.length, 0)
  complete({ ...api.snapshot, text: 'changed' })
  await pending
  assert.deepEqual(closed, [{ dirty: false, busy: false }])
  assert.deepEqual(statuses.at(-1), { dirty: false, busy: false })
  assert.deepEqual(api.calls[0], ['text-1', 'changed', false])
})

test('a failed save keeps the window and draft; a later manual save does not close it', async t => {
  const { editor, closed } = await fixture(t)
  api.setWrite(async () => {
    throw new Error('Permission denied')
  })
  editor.state.draft = 'changed'
  editor.requestClose()
  await editor.saveAndClose()
  assert.equal(closed.length, 0)
  assert.equal(editor.state.draft, 'changed')
  assert.equal(editor.dirty.value, true)
  assert.equal(editor.state.error, 'Permission denied')
  api.setWrite(async (_id, text) => ({ ...api.snapshot, text }))
  await editor.save()
  assert.equal(closed.length, 0)
  assert.equal(editor.dirty.value, false)
})

test('a conflicting close-save waits for explicit overwrite before closing', async t => {
  const { editor, closed } = await fixture(t)
  api.setWrite(async () => {
    throw { kind: 'conflict', message: 'Remote changed' }
  })
  editor.state.draft = 'changed'
  editor.requestClose()
  await editor.saveAndClose()
  assert.equal(editor.state.conflict, true)
  assert.equal(closed.length, 0)
  api.setWrite(async (_id, text) => ({ ...api.snapshot, text }))
  editor.overwriteRemote()
  await flush()
  assert.equal(api.calls.at(-1)[2], true)
  assert.deepEqual(closed, [{ dirty: false, busy: false }])
})

test('canceling conflict cancels the pending close and preserves the edited text', async t => {
  const { editor, closed } = await fixture(t)
  api.setWrite(async () => {
    throw { kind: 'conflict', message: 'Remote changed' }
  })
  editor.state.draft = 'changed'
  editor.requestClose()
  await editor.saveAndClose()
  editor.dismissConflict()
  assert.equal(editor.state.draft, 'changed')
  api.setWrite(async (_id, text) => ({ ...api.snapshot, text }))
  await editor.save()
  assert.equal(closed.length, 0)
})

test('an oversized draft is neither written nor closed', async t => {
  const { editor, closed } = await fixture(t)
  editor.state.draft = 'x'.repeat(1024 * 1024 + 1)
  editor.requestClose()
  await editor.saveAndClose()
  assert.equal(closed.length, 0)
  assert.equal(api.calls.length, 0)
  assert.equal(editor.dirty.value, true)
  assert.match(editor.state.error, /1 MB/)
})
