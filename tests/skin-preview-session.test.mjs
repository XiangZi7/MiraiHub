import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as wait } from 'node:timers/promises'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader({
  '@/utils/window': dataModule('export const IS_TAURI = false'),
})
const { DEFAULT_SETTINGS } = await load('src/types/settings.ts')
const { createCustomSkin, resolveSkinSettings } =
  await load('src/utils/skin.ts')
const {
  skinPreviewSnapshot,
  createSkinPreviewSession,
  createSkinPreviewReceiver,
} = await load('src/api/skin-preview.ts')
const mirai = skinPreviewSnapshot({
  ...DEFAULT_SETTINGS,
  skinTheme: 'kuriyama-mirai',
})

test('跨窗口预览只发送当前皮肤，保留自定义 CSS、图片和参数', () => {
  const first = createCustomSkin(DEFAULT_SETTINGS)
  const active = createCustomSkin(
    { ...DEFAULT_SETTINGS, skinTheme: 'kuriyama-mirai' },
    {
      skinStyle: 'custom',
      skinCustomCss: ':root { --color-accent: red; }',
      skinBackground: 'custom',
      skinBackgroundImage: 'data:image/webp;base64,UklGRg==',
      skinBackgroundOpacity: '65',
    }
  )
  const snapshot = skinPreviewSnapshot({
    ...DEFAULT_SETTINGS,
    terminalFontSize: '18',
    skinTheme: active.id,
    skinLibrary: JSON.stringify([first, active]),
  })
  assert.equal('terminalFontSize' in snapshot, false)
  assert.deepEqual(JSON.parse(snapshot.skinLibrary), [active])
  const resolved = resolveSkinSettings(snapshot)
  assert.equal(resolved.skinCustomCss, active.values.skinCustomCss)
  assert.equal(resolved.skinBackgroundImage, active.values.skinBackgroundImage)
  assert.equal(resolved.skinBackgroundOpacity, '65')
})

test('预览接收端忽略乱序更新、已取消会话和旧窗口迟到的撤销', () => {
  const updates = []
  const receive = createSkinPreviewReceiver(skin => updates.push(skin))
  receive({ sessionId: 'first', revision: 2, skin: mirai })
  receive({ sessionId: 'first', revision: 1, skin: DEFAULT_SETTINGS })
  assert.equal(updates.length, 1)
  receive({ sessionId: 'first', revision: 3, skin: null })
  receive({ sessionId: 'first', revision: 4, skin: mirai })
  assert.deepEqual(updates, [mirai, null])
  receive({ sessionId: 'second', revision: 1, skin: mirai })
  receive({ sessionId: 'third', revision: 1, skin: DEFAULT_SETTINGS })
  receive({ sessionId: 'second', revision: 2, skin: null })
  assert.equal(updates.at(-1), DEFAULT_SETTINGS)
  receive({ sessionId: 'third', revision: 2, skin: null })
  assert.equal(updates.at(-1), null)
  const count = updates.length
  for (const bad of [
    null,
    {},
    { sessionId: 'bad', revision: 1, skin: {} },
    { sessionId: 'bad', revision: -1, skin: mirai },
  ])
    receive(bad)
  assert.equal(updates.length, count)
})

test('快速调整合并为最新帧；取消丢弃尚未发送的更新且不写入设置', async () => {
  const original = globalThis.BroadcastChannel
  const messages = []
  globalThis.BroadcastChannel = class {
    postMessage(value) {
      messages.push(value)
    }
    close() {}
  }
  try {
    const session = createSkinPreviewSession()
    session.preview(mirai)
    session.preview({ ...mirai, skinBackgroundOpacity: '70' })
    await wait(65)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].skin.skinBackgroundOpacity, '70')
    session.preview({ ...mirai, skinBackgroundOpacity: '90' })
    await session.end()
    session.preview(mirai)
    await session.end()
    await wait(65)
    assert.equal(messages.length, 2)
    assert.equal(messages[1].skin, null)
    assert.equal(messages[1].revision, 2)
  } finally {
    globalThis.BroadcastChannel = original
  }
})

test('原生预览 IPC 串行发送，关闭前等待撤销送达', async () => {
  const pending = []
  globalThis.skinPreviewTestEmit = (target, event, message) =>
    new Promise(resolve => pending.push({ target, event, message, resolve }))
  const nativeLoad = sourceLoader({
    '@/utils/window': dataModule('export const IS_TAURI = true'),
    '@tauri-apps/api/event': dataModule(
      'export const emitTo = (...args) => globalThis.skinPreviewTestEmit(...args); export const listen = async () => () => {};'
    ),
  })
  try {
    const { createSkinPreviewSession: createNative } = await nativeLoad(
      'src/api/skin-preview.ts'
    )
    const session = createNative()
    session.preview(mirai)
    await wait(65)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].target, 'main')
    let finished = false
    const end = session.end().then(() => {
      finished = true
    })
    await wait(0)
    assert.equal(finished, false)
    assert.equal(pending.length, 1)
    pending[0].resolve()
    await wait(0)
    assert.equal(pending[1].message.skin, null)
    pending[1].resolve()
    await end
    assert.equal(finished, true)
  } finally {
    delete globalThis.skinPreviewTestEmit
  }
})
