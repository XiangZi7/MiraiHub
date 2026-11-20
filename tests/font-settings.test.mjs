import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createPinia, disposePinia } from 'pinia'
import { effectScope, nextTick } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const nativeEvents = dataModule(
  'export async function emit() {}; export async function listen() { return () => {} }'
)
const overrides = {
  '@tauri-apps/api/event': nativeEvents,
  '@/utils/window': dataModule('export const IS_TAURI = false'),
  '@/utils/skin': dataModule(
    'export const normalizeSkinSettings = value => value'
  ),
}
const load = sourceLoader(overrides)
const fonts = await load('src/utils/fonts.ts')
const { UI_FONT_OPTIONS, TERMINAL_FONT_OPTIONS } = await load(
  'src/constants/fonts.ts'
)
const { DEFAULT_SETTINGS } = await load('src/types/settings.ts')
const { SETTINGS_PAGES } = await load('src/constants/settings.ts')

/** 给实际设置 API 提供独立存储与窗口事件，测试结束后恢复宿主环境。 */
async function fixture(t) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  }
  const storage = new Map()
  const properties = new Map([['--font-mono', 'original-mono']])
  globalThis.window = new EventTarget()
  globalThis.document = {
    documentElement: {
      classList: { toggle() {} },
      style: { setProperty: (key, value) => properties.set(key, value) },
    },
  }
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  })
  const apiLoad = sourceLoader(overrides)
  const api = await apiLoad('src/api/settings.ts')
  return { api, apiLoad, storage, properties }
}

test('外观和终端提供可用字体选项，并保留旧版本默认字体', () => {
  const appearance = SETTINGS_PAGES.find(page => page.id === 'appearance')
  const terminal = SETTINGS_PAGES.find(page => page.id === 'terminal')
  assert.equal(
    appearance.groups
      .flatMap(group => group.fields)
      .find(field => field.key === 'uiFont').options,
    UI_FONT_OPTIONS
  )
  assert.equal(
    terminal.groups
      .flatMap(group => group.fields)
      .find(field => field.key === 'terminalFont').options,
    TERMINAL_FONT_OPTIONS
  )
  assert.deepEqual(
    UI_FONT_OPTIONS.map(option => option.value),
    ['inter', 'system', 'hanyi', 'jetbrains-mono', 'cascadia-code', 'consolas']
  )
  assert.deepEqual(
    TERMINAL_FONT_OPTIONS.map(option => option.value),
    ['jetbrains-mono', 'cascadia-code', 'consolas', 'hanyi']
  )
  assert.equal(DEFAULT_SETTINGS.uiFont, 'inter')
  assert.equal(DEFAULT_SETTINGS.terminalFont, 'jetbrains-mono')
  for (const option of UI_FONT_OPTIONS)
    assert.equal(fonts.uiFontFamily(option.value), option.fontFamily)
  for (const option of TERMINAL_FONT_OPTIONS)
    assert.equal(
      fonts.resolveTerminalFontFamily(option.value),
      option.fontFamily
    )
})

test('汉仪字体保持原始 WOFF2，中文终端选项不使用非等宽英文', () => {
  const font = readFileSync(
    new URL('../src/assets/fonts/hanyi.woff2', import.meta.url)
  )
  assert.equal(font.subarray(0, 4).toString(), 'wOF2')
  assert.equal(font.readUInt32BE(8), font.length)
  assert.ok(font.length > 100000)
  assert.match(fonts.uiFontFamily('hanyi'), /^"Hanyi"/)
  assert.match(
    fonts.resolveTerminalFontFamily('hanyi'),
    /^"JetBrains Mono Variable", "Hanyi"/
  )
  assert.match(
    fonts.resolveTerminalFontFamily('cascadia-code'),
    /^"Cascadia Code"/
  )
  assert.match(fonts.resolveTerminalFontFamily('consolas'), /^Consolas/)
})

test('界面等宽字体使用汉仪中文回退，终端默认回退链保持独立', () => {
  for (const value of ['jetbrains-mono', 'cascadia-code', 'consolas']) {
    const family = fonts.uiFontFamily(value)
    assert.ok(family.indexOf('"Hanyi"') > 0)
    assert.ok(family.indexOf('"Hanyi"') < family.indexOf('ui-monospace'))
    assert.ok(family.includes('JetBrains Mono Variable'))
    assert.equal(
      fonts.resolveTerminalFontFamily(value).includes('Hanyi'),
      false
    )
  }
  assert.equal(fonts.uiFontFamily('inter').includes('Hanyi'), false)
})

test('未知、损坏和原型属性名称不会流入 CSS 或形成空白选择', () => {
  for (const value of [
    undefined,
    null,
    '',
    'missing',
    'toString',
    '__proto__',
    'constructor',
    '"Injected Font"',
    {},
    3,
  ]) {
    assert.equal(fonts.normalizeUiFont(value), 'inter')
    assert.equal(fonts.normalizeTerminalFont(value), 'jetbrains-mono')
    assert.equal(fonts.uiFontFamily(value), fonts.uiFontFamily('inter'))
    assert.equal(
      fonts.resolveTerminalFontFamily(value),
      fonts.resolveTerminalFontFamily('jetbrains-mono')
    )
  }
})

test('旧设置补齐界面字体，新增字体可保存、重载、重置且与终端分开', async t => {
  const { api, storage } = await fixture(t)
  storage.set(
    'miraihub.settings.v1',
    JSON.stringify({ terminalFont: 'consolas' })
  )
  assert.equal(api.loadSettings().uiFont, 'inter')
  assert.equal(api.loadSettings().terminalFont, 'consolas')
  for (const option of UI_FONT_OPTIONS) {
    api.saveSettings({
      ...api.defaultSettings(),
      uiFont: option.value,
      terminalFont: 'hanyi',
    })
    assert.equal(api.loadSettings().uiFont, option.value)
    assert.equal(api.loadSettings().terminalFont, 'hanyi')
  }
  storage.set(
    'miraihub.settings.v1',
    JSON.stringify({ uiFont: 'unknown', terminalFont: 'constructor' })
  )
  assert.equal(api.loadSettings().uiFont, 'inter')
  assert.equal(api.loadSettings().terminalFont, 'jetbrains-mono')
  api.saveSettings(api.defaultSettings())
  assert.equal(api.loadSettings().uiFont, 'inter')
  assert.equal(api.loadSettings().terminalFont, 'jetbrains-mono')
})

test('字体保存通过已有通知链同步到其他设置 store，并在销毁后停止刷新', async t => {
  const { apiLoad } = await fixture(t)
  const { useSettingsStore } = await apiLoad('src/stores/settings.ts')
  const first = createPinia()
  const second = createPinia()
  try {
    const a = useSettingsStore(first)
    const b = useSettingsStore(second)
    const reference = b.values
    a.save({ ...a.values, uiFont: 'hanyi', terminalFont: 'cascadia-code' })
    assert.equal(b.values, reference)
    assert.equal(b.values.uiFont, 'hanyi')
    assert.equal(b.values.terminalFont, 'cascadia-code')
    disposePinia(second)
    a.save({ ...a.values, uiFont: 'system' })
    assert.equal(b.values.uiFont, 'hanyi')
  } finally {
    disposePinia(first)
    disposePinia(second)
  }
})

test('每个窗口在挂载前应用已保存字体，字体切换不改等宽区域令牌', async t => {
  const { api, properties } = await fixture(t)
  const settingsModule = dataModule(`
    import { reactive } from ${JSON.stringify(import.meta.resolve('vue'))}
    export const settings = reactive(${JSON.stringify(api.defaultSettings())})
    export const useSettingsStore = () => ({ values: settings })
  `)
  const runtimeLoad = sourceLoader({
    ...overrides,
    '@/stores': dataModule('export const pinia = {}'),
    '@/stores/settings': settingsModule,
    '@/api/settings': dataModule('export const loadSettings = () => ({})'),
    '@/api/skin-preview': dataModule(
      'export const subscribeSkinPreview = () => () => {}'
    ),
    '@/utils/skin-runtime': dataModule('export function applySkin() {}'),
    '@/utils/skin-registry': dataModule(
      'export const skinRegistry = { version: 0 }; export async function loadSkinRegistry() {}'
    ),
    '@/utils/color-mode': dataModule(
      'export const watchSystemColorScheme = () => () => {}'
    ),
    '@/utils/window-appearance': dataModule(
      'export function applyWindowBackgroundOpacity() {}'
    ),
  })
  const { settings } = await import(settingsModule)
  settings.uiFont = 'hanyi'
  const { startSettingsRuntime } = await runtimeLoad(
    'src/utils/settings-runtime.ts'
  )
  const scope = effectScope()
  try {
    scope.run(() => startSettingsRuntime())
    assert.equal(properties.get('--font-sans'), fonts.uiFontFamily('hanyi'))
    for (const option of UI_FONT_OPTIONS) {
      settings.uiFont = option.value
      await nextTick()
      assert.equal(properties.get('--font-sans'), option.fontFamily)
      assert.equal(properties.get('--font-mono'), 'original-mono')
    }
    scope.stop()
    settings.uiFont = 'hanyi'
    await nextTick()
    assert.equal(properties.get('--font-sans'), fonts.uiFontFamily('consolas'))
  } finally {
    scope.stop()
  }
})
