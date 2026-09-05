import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader({
  '@/utils/window': dataModule('export const IS_TAURI = false'),
  '@/assets/skins/kuriyama-mirai.png': dataModule(
    'export default "/mirai.png"'
  ),
  '@/assets/styles/skins/kuriyama-mirai.css?raw': dataModule(
    'export default ":root { --color-accent: #c93478; }"'
  ),
})
const { DEFAULT_SETTINGS } = await load('src/types/settings.ts')
const {
  normalizeSkinSettings,
  isBackgroundImage,
  readBackgroundImage,
  createCustomSkin,
  resolveSkinSettings,
  readSkinLibrary,
  skinPreset,
} = await load('src/utils/skin.ts')
const api = await load('src/api/settings.ts')
const { applySkin, skinRuntime, skinCss, skinBackground } = await load(
  'src/utils/skin-runtime.ts'
)
const image = 'data:image/webp;base64,UklGRg=='
const mirai = { ...DEFAULT_SETTINGS, skinTheme: 'kuriyama-mirai' }

test('旧设置保留用户偏好，并补齐默认皮肤和背景参数', () => {
  globalThis.localStorage = {
    getItem: () =>
      JSON.stringify({ terminalFontSize: '16', reduceMotion: true }),
  }
  const settings = api.loadSettings()
  assert.equal(settings.terminalFontSize, '16')
  assert.equal(settings.reduceMotion, true)
  assert.equal(settings.skinTheme, 'default')
  assert.equal(settings.skinBackgroundOpacity, '30')
  assert.equal(settings.skinBackgroundBlur, '0')
})

test('损坏的皮肤、图片和参数回退，不修改输入对象', () => {
  const invalid = {
    ...mirai,
    skinTheme: 'missing',
    skinStyle: 'bad',
    skinBackground: 'custom',
    skinBackgroundImage: 'javascript:alert(1)',
    skinBackgroundOpacity: 'NaN',
    skinBackgroundBlur: 'Infinity',
    skinBackgroundFit: 'bad',
    skinBackgroundPosition: 'bad',
  }
  const normalized = normalizeSkinSettings(invalid)
  assert.equal(normalized.skinTheme, 'default')
  assert.equal(normalized.skinStyle, 'builtin')
  assert.equal(normalized.skinBackground, 'theme')
  assert.equal(normalized.skinBackgroundImage, '')
  assert.equal(normalized.skinBackgroundOpacity, '100')
  assert.equal(normalized.skinBackgroundBlur, '0')
  assert.equal(normalized.skinBackgroundFit, 'cover')
  assert.equal(normalized.skinBackgroundPosition, 'center')
  assert.equal(invalid.skinTheme, 'missing')
  for (const [input, expected] of [
    ['0', '0'],
    ['-5', '0'],
    ['45', '45'],
    ['200', '100'],
  ])
    assert.equal(
      normalizeSkinSettings({ ...mirai, skinBackgroundOpacity: input })
        .skinBackgroundOpacity,
      expected
    )
  assert.equal(
    normalizeSkinSettings({ ...mirai, skinBackgroundBlur: '50' })
      .skinBackgroundBlur,
    '20'
  )
  assert.equal(isBackgroundImage(image), true)
  assert.equal(isBackgroundImage('data:image/svg+xml;base64,AAAA'), false)
})

test('保存和重载保留自定义 CSS、图片和全部背景参数；配额不足时不广播成功', () => {
  let raw = null
  let changes = 0
  globalThis.window = new EventTarget()
  window.addEventListener('miraihub:settings-changed', () => changes++)
  globalThis.localStorage = {
    getItem: () => raw,
    setItem: (_key, value) => {
      raw = value
    },
  }
  const settings = {
    ...mirai,
    skinStyle: 'custom',
    skinCustomCss: ':root { --color-accent: #aabbcc; }',
    skinBackground: 'custom',
    skinBackgroundImage: image,
    skinBackgroundName: 'test.webp',
    skinBackgroundOpacity: '45',
    skinBackgroundBlur: '6',
    skinBackgroundFit: 'contain',
    skinBackgroundPosition: 'right',
  }
  api.saveSettings(settings)
  assert.deepEqual(api.loadSettings(), settings)
  assert.equal(changes, 1)
  localStorage.setItem = () => {
    throw new DOMException('Quota', 'QuotaExceededError')
  }
  assert.throws(() => api.saveSettings(mirai), { name: 'QuotaExceededError' })
  assert.deepEqual(api.loadSettings(), settings)
  assert.equal(changes, 1)
})

test('皮肤、样式和背景独立组合，自定义 CSS 可以只作用于预览', () => {
  assert.match(skinCss(mirai), /#c93478/)
  assert.equal(skinCss({ ...mirai, skinStyle: 'default' }).trim(), '')
  assert.equal(skinBackground({ ...mirai, skinStyle: 'default' }), '/mirai.png')
  assert.equal(skinBackground({ ...mirai, skinBackground: 'none' }), '')
  assert.equal(
    skinBackground({
      ...mirai,
      skinBackground: 'custom',
      skinBackgroundImage: image,
    }),
    image
  )
  const custom = {
    ...mirai,
    skinStyle: 'custom',
    skinCustomCss: '.pane { border-radius: 20px; }',
  }
  assert.match(skinCss(custom), /border-radius: 20px/)
  assert.doesNotMatch(skinCss(custom, false), /border-radius: 20px/)
})

test('快速切换或取消时旧动画不会覆盖最新主题，减少动画设置立即生效', () => {
  const classes = new Set()
  let style
  const callbacks = []
  const root = {
    dataset: {},
    classList: {
      contains: value => classes.has(value),
      add: value => classes.add(value),
      remove: value => classes.delete(value),
    },
  }
  globalThis.document = {
    documentElement: root,
    getElementById: () => style,
    createElement: () => ({ textContent: '' }),
    head: {
      append: value => {
        style = value
      },
    },
    startViewTransition: update => {
      callbacks.push(update)
      return { skipTransition() {}, ready: Promise.resolve() }
    },
  }
  globalThis.matchMedia = () => ({ matches: false })
  globalThis.window = new EventTarget()
  applySkin(DEFAULT_SETTINGS)
  applySkin(mirai)
  applySkin(DEFAULT_SETTINGS, { animate: false })
  callbacks.forEach(callback => callback())
  assert.equal(root.dataset.skin, 'default')
  assert.equal(skinRuntime.background, '')
  assert.equal(style.textContent.trim(), '')
  classes.add('reduce-motion')
  const pending = callbacks.length
  applySkin(mirai)
  assert.equal(root.dataset.skin, 'kuriyama-mirai')
  assert.equal(callbacks.length, pending)
  applySkin({
    ...mirai,
    skinBackgroundOpacity: '0',
    skinBackgroundBlur: '10',
    skinBackgroundFit: 'contain',
  })
  assert.equal(skinRuntime.opacity, 0)
  assert.equal(skinRuntime.blur, 10)
  assert.equal(skinRuntime.fit, 'contain')
})

test('上传在解码前拒绝不支持的格式和超大图片', async () => {
  await assert.rejects(
    readBackgroundImage(new File(['text'], 'bad.txt', { type: 'text/plain' })),
    /PNG/
  )
  await assert.rejects(
    readBackgroundImage(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', {
        type: 'image/png',
      })
    ),
    /10 MB/
  )
})

test('多个自定义皮肤独立保存，切换与编辑不会覆盖内置主题或其他卡片', () => {
  const first = createCustomSkin(
    mirai,
    {
      skinBackground: 'custom',
      skinBackgroundImage: image,
      skinBackgroundOpacity: '45',
      skinCustomCss: '.pane { border-radius: 17px; }',
      skinStyle: 'custom',
    },
    '樱花'
  )
  const second = createCustomSkin(
    DEFAULT_SETTINGS,
    { skinBackgroundOpacity: '70' },
    '夜色'
  )
  let settings = {
    ...DEFAULT_SETTINGS,
    skinTheme: first.id,
    skinLibrary: JSON.stringify([first, second]),
  }
  assert.equal(resolveSkinSettings(settings).skinBackgroundOpacity, '45')
  assert.equal(skinBackground(settings), image)
  assert.match(skinCss(settings), /#c93478/)
  assert.match(skinCss(settings), /17px/)
  settings = { ...settings, skinTheme: second.id }
  assert.equal(resolveSkinSettings(settings).skinBackgroundOpacity, '70')
  assert.equal(skinBackground(settings), '')
  assert.equal(skinCss(settings).trim(), '')
  const library = readSkinLibrary(settings.skinLibrary)
  library[1].values.skinBackgroundBlur = '12'
  settings.skinLibrary = JSON.stringify(library)
  settings.skinTheme = first.id
  assert.equal(resolveSkinSettings(settings).skinBackgroundBlur, '0')
  const builtin = {
    ...settings,
    ...skinPreset('kuriyama-mirai'),
    skinTheme: 'kuriyama-mirai',
  }
  assert.equal(skinBackground(builtin), '/mirai.png')
  assert.equal(resolveSkinSettings(builtin).skinBackgroundOpacity, '30')
  assert.doesNotMatch(skinCss(builtin), /17px/)
  assert.deepEqual(normalizeSkinSettings(settings), settings)
  assert.equal(settings.skinBackgroundImage, '', '图片仅存储在所属卡片')
})

test('损坏的自定义皮肤库隔离无效条目，已删除的活动主题回退默认', () => {
  const good = createCustomSkin(mirai, {}, '保留')
  const raw = JSON.stringify([
    null,
    { id: 'default', name: '覆盖内置', values: {} },
    good,
    good,
    {
      id: 'custom-bad',
      name: '',
      values: {
        skinBase: 'bad',
        skinBackgroundImage: 'https://invalid.test/a.png',
        skinBackground: 'custom',
        skinBackgroundOpacity: '1000',
      },
    },
  ])
  const library = readSkinLibrary(raw)
  assert.equal(library.length, 2)
  assert.equal(library[1].values.skinBackgroundImage, '')
  assert.equal(library[1].values.skinBackgroundOpacity, '100')
  assert.equal(library[1].values.skinBase, 'default')
  assert.deepEqual(readSkinLibrary('{broken'), [])
  assert.equal(
    normalizeSkinSettings({ ...mirai, skinTheme: good.id, skinLibrary: '[]' })
      .skinTheme,
    'default'
  )
})
