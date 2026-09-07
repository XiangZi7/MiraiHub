import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

test('原生子窗口 Toast 统一转发到主窗口', async () => {
  const calls = []
  const emissions = []
  let listener
  globalThis.toastWindowTest = {
    label: 'connection',
    calls,
    emissions,
    setListener(value) {
      listener = value
    },
  }

  const load = sourceLoader({
    '@/stores': dataModule('export const pinia = {}'),
    '@/stores/notifications': dataModule(`
      export const useNotificationsStore = () => ({
        items: [],
        notifications: [],
        unreadCount: 0,
        show: (...args) => {
          globalThis.toastWindowTest.calls.push(args)
          return 'local-toast'
        },
        dismiss() {},
        clear() {},
        pause() {},
        resume() {},
        markAllRead() {},
        clearNotifications() {},
      })
    `),
    '@/utils/window': dataModule('export const IS_TAURI = true'),
    '@tauri-apps/api/window': dataModule(`
      export const getCurrentWindow = () => ({
        label: globalThis.toastWindowTest.label,
      })
    `),
    '@tauri-apps/api/event': dataModule(`
      export const emitTo = async (...args) => {
        globalThis.toastWindowTest.emissions.push(args)
      }
      export const listen = async (_event, handler) => {
        globalThis.toastWindowTest.setListener(handler)
        return () => {}
      }
    `),
  })

  try {
    const { startMainToastReceiver, toast } = await load(
      'src/composables/useToast.ts'
    )
    const input = { title: 'SSH 连接失败', description: 'Disconnected' }

    assert.equal(toast.error(input), '')
    await Promise.resolve()
    assert.deepEqual(emissions, [
      ['main', 'miraihub:toast', { tone: 'error', input }],
    ])
    assert.equal(calls.length, 0)

    globalThis.toastWindowTest.label = 'main'
    await startMainToastReceiver()
    listener({ payload: emissions[0][2] })
    assert.deepEqual(calls, [['error', input]])
    assert.equal(toast.success('已保存'), 'local-toast')
    assert.deepEqual(calls[1], ['success', '已保存'])

    listener({ payload: { tone: 'error', input: { title: 123 } } })
    assert.equal(calls.length, 2)
  } finally {
    delete globalThis.toastWindowTest
  }
})
