import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader({
  '@/utils/window': dataModule('export const IS_TAURI = false'),
  // 皮肤目录在安装包里；测试不读磁盘，直接手动登记两套内置皮肤。
  '@/api/skins': dataModule(`
    export const BUILTIN_SKIN_IDS = ['kuriyama-mirai', 'midnight']
    export const skinDirectory = async () => ({ root: '/skins', skins: [] })
    export const skinFileUrl = (folder, file) => folder.path + '/' + file
    export const openSkinDirectory = async () => {}
  `),
})

const { DEFAULT_SETTINGS } = await load('src/types/settings.ts')
const { registerBuiltinSkin, skinRegistry } = await load(
  'src/utils/skin-registry.ts'
)
registerBuiltinSkin({
  id: 'kuriyama-mirai',
  name: 'Kuriyama Mirai',
  colorScheme: 'light',
  css: ':root { --color-accent: #c93478; }',
})
registerBuiltinSkin({
  id: 'midnight',
  name: 'Midnight',
  colorScheme: 'dark',
  css: ':root { --color-accent: #6366f1; }',
})
skinRegistry.loaded = true

const colorMode = await load('src/utils/color-mode.ts')
const { usesLightScheme } = await load('src/utils/skin.ts')
const api = await load('src/api/settings.ts')

/** matchMedia 的最小桩：只回答"系统是不是浅色"，并记录监听器以便手动触发。 */
function stubMatchMedia(light, { listeners = true } = {}) {
  const handlers = new Set()
  globalThis.matchMedia = query => ({
    matches: query.includes('light') ? light : false,
    ...(listeners
      ? {
          addEventListener: (_event, handler) => handlers.add(handler),
          removeEventListener: (_event, handler) => handlers.delete(handler),
        }
      : {}),
  })
  return handlers
}

test('非法模式回落深色，三种模式各自解析出确定的明暗', () => {
  assert.equal(DEFAULT_SETTINGS.colorMode, 'dark')
  stubMatchMedia(true)
  for (const value of ['', 'auto', null, undefined, 42, 'Dark'])
    assert.equal(colorMode.normalizeColorMode(value), 'dark')
  for (const value of ['dark', 'light', 'system'])
    assert.equal(colorMode.normalizeColorMode(value), value)

  assert.equal(colorMode.resolveColorScheme('dark'), 'dark')
  assert.equal(colorMode.resolveColorScheme('light'), 'light')
  // 跟随系统时才查媒体查询，固定模式不受系统影响。
  assert.equal(colorMode.resolveColorScheme('system'), 'light')
  stubMatchMedia(false)
  assert.equal(colorMode.resolveColorScheme('system'), 'dark')
  assert.equal(colorMode.resolveColorScheme('light'), 'light')
})

test('matchMedia 不可用或没有监听能力时，降级为深色且不抛错', () => {
  globalThis.matchMedia = () => {
    throw new Error('unsupported')
  }
  assert.equal(colorMode.systemColorScheme(), 'dark')
  assert.equal(colorMode.resolveColorScheme('system'), 'dark')
  assert.doesNotThrow(() => colorMode.watchSystemColorScheme(() => {})())

  // 老 WebView 只有 addListener，仍要能订阅到变化。
  const legacy = new Set()
  globalThis.matchMedia = () => ({
    matches: false,
    addListener: handler => legacy.add(handler),
    removeListener: handler => legacy.delete(handler),
  })
  const stop = colorMode.watchSystemColorScheme(() => {})
  assert.equal(legacy.size, 1)
  stop()
  assert.equal(legacy.size, 0)
})

test('订阅系统明暗变化，取消后不再回调', () => {
  const handlers = stubMatchMedia(false)
  const seen = []
  const stop = colorMode.watchSystemColorScheme(scheme => seen.push(scheme))
  assert.equal(handlers.size, 1)

  stubMatchMedia(true)
  for (const handler of handlers) handler()
  assert.deepEqual(seen, ['light'])

  stop()
  // stop 解绑的是第一次 stub 留下的那组监听器。
  assert.equal(handlers.size, 0)
})

test('皮肤自带的明暗优先于外观模式，项目默认样式才听模式', () => {
  stubMatchMedia(false)
  const base = { ...DEFAULT_SETTINGS }

  // 默认样式：三种模式各自生效。
  assert.equal(usesLightScheme({ ...base, colorMode: 'dark' }), false)
  assert.equal(usesLightScheme({ ...base, colorMode: 'light' }), true)
  assert.equal(usesLightScheme({ ...base, colorMode: 'system' }), false)
  stubMatchMedia(true)
  assert.equal(usesLightScheme({ ...base, colorMode: 'system' }), true)

  // 浅色皮肤 + 深色模式：皮肤赢，否则浅色表面会配上浅色文字。
  const lightSkin = { ...base, skinTheme: 'kuriyama-mirai' }
  assert.equal(usesLightScheme({ ...lightSkin, colorMode: 'dark' }), true)
  assert.equal(usesLightScheme({ ...lightSkin, colorMode: 'light' }), true)

  // 深色皮肤 + 浅色模式：同样是皮肤赢。
  const darkSkin = { ...base, skinTheme: 'midnight' }
  assert.equal(usesLightScheme({ ...darkSkin, colorMode: 'light' }), false)
  assert.equal(usesLightScheme({ ...darkSkin, colorMode: 'dark' }), false)

  // 皮肤样式被改回项目默认后，模式重新接管。
  assert.equal(
    usesLightScheme({ ...lightSkin, skinStyle: 'default', colorMode: 'dark' }),
    false
  )
})

test('编辑皮肤草稿不带模式时，沿用文档当前的明暗', () => {
  stubMatchMedia(false)
  const root = { dataset: {} }
  globalThis.document = { documentElement: root }
  const draft = { ...DEFAULT_SETTINGS }
  delete draft.colorMode

  assert.equal(usesLightScheme(draft), false)
  root.dataset.skinScheme = 'light'
  assert.equal(usesLightScheme(draft), true)
  // 显式给出的模式仍然优先于文档状态。
  assert.equal(usesLightScheme({ ...draft, colorMode: 'dark' }), false)
})

test('损坏的外观模式在读取设置时被修正', () => {
  stubMatchMedia(false)
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ colorMode: 'rainbow' }),
  }
  assert.equal(api.loadSettings().colorMode, 'dark')
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ colorMode: 'system' }),
  }
  assert.equal(api.loadSettings().colorMode, 'system')
})
