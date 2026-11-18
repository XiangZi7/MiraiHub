import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { effectScope, nextTick } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const settingsModule = dataModule(`
  import { reactive } from ${JSON.stringify(import.meta.resolve('vue'))}
  export const settings = reactive({ terminalFont: 'jetbrains-mono', terminalFontSize: '13' })
  export const settingsSnapshot = () => settings
  export const useSettings = () => ({ settings })
  export const settingNumber = (key, fallback) => Number(settings[key]) || fallback
`)
const webglModule = dataModule(`
  export class WebglAddon {
    static created = 0
    disposed = false
    constructor() { WebglAddon.created++ }
    onContextLoss(handler) { this.contextLoss = handler }
    dispose() { this.disposed = true }
  }
`)
const load = sourceLoader({
  '@vueuse/core': dataModule(`
    import { onScopeDispose } from ${JSON.stringify(import.meta.resolve('vue'))}
    export const useDebounceFn = fn => fn
    export function useEventListener(target, event, handler) {
      target.addEventListener(event, handler)
      onScopeDispose(() => target.removeEventListener(event, handler))
    }
  `),
  '@tauri-apps/plugin-opener': dataModule('export async function openUrl() {}'),
  '@xterm/addon-fit': dataModule('export class FitAddon { fit() {} }'),
  '@xterm/addon-unicode11': dataModule('export class Unicode11Addon {}'),
  '@xterm/addon-web-links': dataModule('export class WebLinksAddon {}'),
  '@xterm/addon-webgl': webglModule,
  '@xterm/xterm': dataModule(`
    export class Terminal {
      rows = 24
      unicode = {}
      cleared = 0
      refreshed = 0
      addons = []
      element = { isConnected: true, querySelector() { return null } }
      buffer = { active: { type: 'normal' } }
      csi = new Map()
      writes = new Set()
      parser = {
        registerCsiHandler: (id, handler) => {
          const key = (id.intermediates || '') + id.final
          this.csi.set(key, handler)
          return { dispose: () => this.csi.delete(key) }
        }
      }
      constructor(options) { this.options = options }
      open() {}
      loadAddon(addon) { this.addons.push(addon) }
      onSelectionChange() {}
      onWriteParsed(handler) {
        this.writes.add(handler)
        return { dispose: () => this.writes.delete(handler) }
      }
      clearTextureAtlas() { this.cleared++ }
      refresh() { this.refreshed++ }
    }
  `),
  '@/i18n': dataModule('export const i18n = { global: { t: text => text } }'),
  '@/constants/terminal': dataModule(
    'export const currentTerminalTheme = () => ({})'
  ),
  '@/composables/useToast': dataModule('export const toast = { error() {} }'),
  '@/utils/clipboard': dataModule('export async function copyText() {}'),
  '@/utils/skin-runtime': dataModule(
    "export const SKIN_CHANGE_EVENT = 'skin-change'"
  ),
  '@/utils/window': dataModule('export const IS_TAURI = false'),
  '@/composables/useSettings': settingsModule,
})
const { useXterm } = await load('src/composables/useXterm.ts')
const { settings } = await import(settingsModule)
const { WebglAddon } = await import(webglModule)

/** 提供可控的字体下载与主题切换，验证渲染器、字体到达和用户设置的竞态。 */
function fixture(t, scheme = 'dark') {
  const previous = { window: globalThis.window, document: globalThis.document }
  const pending = []
  globalThis.window = new EventTarget()
  globalThis.document = {
    documentElement: { dataset: { skinScheme: scheme } },
    fonts: {
      check: () => false,
      load: font => new Promise(resolve => pending.push({ font, resolve })),
    },
  }
  settings.terminalFont = 'jetbrains-mono'
  settings.terminalFontSize = '13'
  settings.terminalCursor = 'bar'
  settings.terminalCursorBlink = true
  const scope = effectScope()
  let changes = 0
  const api = scope.run(() => useXterm(() => changes++))
  const terminal = api.open({})
  t.after(() => {
    scope.stop()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  })
  return { terminal, pending, changes: () => changes }
}

/** 等待字体 Promise 和动态插件导入完成，不依赖固定时间延迟。 */
async function finishFonts(pending) {
  for (const item of pending.splice(0)) item.resolve([])
  await new Promise(resolve => setImmediate(resolve))
}

test('慢字体到达前不缓存 WebGL 字形，到达后重新测量并重绘终端', async t => {
  const created = WebglAddon.created
  const { terminal, pending, changes } = fixture(t)
  assert.equal(pending.length, 2)
  assert.match(pending[0].font, /^400 13px .*JetBrains Mono Variable/)
  assert.match(pending[1].font, /^700 13px /)
  assert.equal(WebglAddon.created, created)
  assert.equal(terminal.options.minimumContrastRatio, 4.5)
  await finishFonts(pending)
  assert.equal(terminal.cleared, 1)
  assert.equal(terminal.refreshed, 1)
  assert.equal(changes(), 2)
  assert.equal(WebglAddon.created, created + 1)
})

test('浅色终端保留透明背景并用 DOM 绘字，深浅切换只替换渲染插件', async t => {
  const created = WebglAddon.created
  const { terminal, pending } = fixture(t, 'light')
  assert.equal(terminal.options.allowTransparency, true)
  assert.equal(terminal.options.fontWeight, 400)
  await finishFonts(pending)
  assert.equal(WebglAddon.created, created)

  document.documentElement.dataset.skinScheme = 'dark'
  window.dispatchEvent(new Event('skin-change'))
  await finishFonts(pending)
  const addon = terminal.addons.find(addon => addon instanceof WebglAddon)
  assert.ok(addon)
  assert.equal(WebglAddon.created, created + 1)

  document.documentElement.dataset.skinScheme = 'light'
  window.dispatchEvent(new Event('skin-change'))
  assert.equal(addon.disposed, true)
  await finishFonts(pending)
  assert.equal(WebglAddon.created, created + 1)

  document.documentElement.dataset.skinScheme = 'dark'
  window.dispatchEvent(new Event('skin-change'))
  await finishFonts(pending)
  assert.equal(WebglAddon.created, created + 2)
})

test('字体迟到与连续主题切换不会在浅色加载 WebGL 或重复创建渲染器', async t => {
  const created = WebglAddon.created
  const { terminal, pending } = fixture(t)
  document.documentElement.dataset.skinScheme = 'light'
  window.dispatchEvent(new Event('skin-change'))
  await finishFonts(pending)
  assert.equal(WebglAddon.created, created)

  document.documentElement.dataset.skinScheme = 'dark'
  window.dispatchEvent(new Event('skin-change'))
  window.dispatchEvent(new Event('skin-change'))
  await finishFonts(pending)
  assert.equal(WebglAddon.created, created + 1)

  const addon = terminal.addons.find(addon => addon instanceof WebglAddon)
  addon.contextLoss()
  assert.equal(addon.disposed, true)
})

test('切换字体后旧下载不会覆盖新字体，关闭后的字体也不会触发重绘', async t => {
  const { terminal, pending } = fixture(t)
  const initial = pending.splice(0)
  settings.terminalFont = 'consolas'
  await nextTick()
  await finishFonts(initial)
  assert.match(terminal.options.fontFamily, /^Consolas/)
  assert.equal(terminal.cleared, 0)
  terminal.element.isConnected = false
  await finishFonts(pending)
  assert.equal(terminal.refreshed, 0)
})

test('浅色终端保持透明，同时把实际底色交给文字对比度计算', async t => {
  const previous = globalThis.document
  globalThis.document = {
    documentElement: { dataset: { skinScheme: 'light' } },
  }
  t.after(() => {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  })
  const themeLoad = sourceLoader({
    '@/utils/color': dataModule(`
      export const parseColor = value => value.includes('terminal') ? [250, 249, 255] : [124, 58, 237]
      export const rgba = (value, alpha) => value.includes('terminal') ? 'rgba(250, 249, 255, ' + alpha + ')' : 'rgba(50, 45, 60, ' + alpha + ')'
    `),
  })
  const { currentTerminalTheme } = await themeLoad('src/constants/terminal.ts')
  assert.equal(currentTerminalTheme().background, 'rgba(250, 249, 255, 0)')
})

test('深浅终端的文字和语义色均达到 4.5:1，浅色高亮通过加深保持清晰', async t => {
  const previous = globalThis.document
  globalThis.document = { documentElement: { dataset: { skinScheme: 'dark' } } }
  t.after(() => {
    globalThis.document = previous
  })
  const styles = readFileSync(
    new URL('../src/assets/styles/main.css', import.meta.url),
    'utf8'
  )
  const [dark, light] = styles.split('/* light-tokens:start */')
  const tokens = { dark, light }
  const themeLoad = sourceLoader({
    '@/utils/color': dataModule(`
      const styles = ${JSON.stringify(tokens)}
      export const rgba = value => {
        const token = value.slice(4, -1)
        const style = styles[document.documentElement.dataset.skinScheme]
        return style.match(new RegExp(token + ': (#[0-9a-f]{6});'))?.[1]
      }
    `),
  })
  const { currentTerminalTheme } = await themeLoad('src/constants/terminal.ts')
  /** 将实际色板换算为相对亮度，检查可读性而非固定某个颜色值。 */
  function luminance(color) {
    const rgb = color
      .slice(1)
      .match(/../g)
      .map(channel => {
        const value = parseInt(channel, 16) / 255
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4
      })
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  for (const [scheme, background] of [
    ['dark', '#000000'],
    ['light', '#fbfbfa'],
  ]) {
    document.documentElement.dataset.skinScheme = scheme
    const theme = currentTerminalTheme()
    for (const role of [
      'foreground',
      'brightBlack',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
    ]) {
      const text = luminance(theme[role]),
        surface = luminance(background)
      const contrast =
        (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05)
      assert.ok(
        contrast >= 4.5,
        scheme + ' ' + role + ': ' + contrast.toFixed(2)
      )
    }
    if (scheme === 'light')
      assert.ok(luminance(theme.brightBlue) < luminance(theme.blue))
  }
})

test('Shell 控制序列不会覆盖所选光标，全屏程序可切换形状并在退出后恢复', async t => {
  const { terminal } = fixture(t)
  const cursor = terminal.csi.get(' q')
  assert.equal(terminal.options.cursorWidth, 2)
  assert.equal(terminal.options.cursorInactiveStyle, 'none')
  for (const style of ['bar', 'block', 'underline']) {
    settings.terminalCursor = style
    await nextTick()
    for (const code of [0, 1, 2, 3, 4, 5, 6]) {
      assert.equal(cursor([code]), true)
      assert.equal(terminal.options.cursorStyle, style)
      assert.equal(terminal.options.cursorBlink, false)
    }
    // 原生硬闪烁保持关闭，实际闪烁由统一光标层控制。
    terminal.options.cursorBlink = true
    terminal.writes.forEach(handler => handler())
    assert.equal(terminal.options.cursorBlink, false)
  }
  assert.equal(cursor([7]), false)
  terminal.buffer.active.type = 'alternate'
  cursor([2])
  assert.equal(terminal.options.cursorStyle, 'block')
  assert.equal(terminal.options.cursorBlink, false)
  cursor([4])
  assert.equal(terminal.options.cursorStyle, 'underline')
  terminal.buffer.active.type = 'normal'
  terminal.writes.forEach(handler => handler())
  assert.equal(terminal.options.cursorStyle, settings.terminalCursor)
})

test('关闭闪烁后控制序列无法重新开启，卸载时清理光标监听', async t => {
  const { terminal } = fixture(t)
  settings.terminalCursorBlink = false
  await nextTick()
  terminal.csi.get(' q')([1])
  assert.equal(terminal.options.cursorBlink, false)
  terminal.options.cursorBlink = true
  terminal.writes.forEach(handler => handler())
  assert.equal(terminal.options.cursorBlink, false)
  t.after(() => {
    assert.equal(terminal.csi.size, 0)
    assert.equal(terminal.writes.size, 0)
  })
})
