import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

globalThis.window = { __TAURI_INTERNALS__: {} }
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Windows' },
})

const native = dataModule(`
  export const state = { calls: [], maximized: false, fullscreen: false }
  const win = {
    async isMaximized() { return state.maximized },
    async isFullscreen() { return state.fullscreen },
    async toggleMaximize() {
      state.maximized = !state.maximized
      state.calls.push(state.maximized ? 'maximize' : 'restore')
    },
    async setFullscreen(enabled) {
      state.calls.push(enabled ? 'enter' : 'exit')
      if (state.fail) throw new Error('fullscreen unavailable')
      state.fullscreen = enabled
    },
  }
  export const getCurrentWindow = () => win
`)
const { state } = await import(native)
const { setWindowFullscreen } = await sourceLoader({
  '@tauri-apps/api/window': native,
})('src/utils/window.ts')

test('Windows 从最大化进入全屏会先还原窗口，退出后恢复最大化', async () => {
  state.maximized = true
  await setWindowFullscreen(true)
  await setWindowFullscreen(true)
  assert.equal(state.maximized, false)
  await setWindowFullscreen(false)
  assert.deepEqual(state.calls.splice(0), [
    'restore',
    'enter',
    'exit',
    'maximize',
  ])
  assert.equal(state.maximized, true)
})

test('普通窗口退出全屏后保持普通窗口，进入失败会恢复最大化', async () => {
  state.maximized = false
  await setWindowFullscreen(true)
  await setWindowFullscreen(false)
  assert.deepEqual(state.calls.splice(0), ['enter', 'exit'])
  assert.equal(state.maximized, false)

  state.maximized = true
  state.fail = true
  await assert.rejects(setWindowFullscreen(true), /fullscreen unavailable/)
  assert.deepEqual(state.calls.splice(0), ['restore', 'enter', 'maximize'])
  assert.equal(state.maximized, true)
})
