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
    import { getCurrentScope, onScopeDispose, shallowRef } from ${JSON.stringify(import.meta.resolve('vue'))}
    export const useDebounceFn = fn => fn
    /** 用显式测试事件模拟 VueUse 的 matchMedia DPI 变更通知。 */
    export function useDevicePixelRatio() {
      const pixelRatio = shallowRef(window.devicePixelRatio || 1)
      useEventListener(window, 'test-dpr-change', () => {
        pixelRatio.value = window.devicePixelRatio || 1
      })
      return { pixelRatio }
    }
    /** 模拟 VueUse 的作用域清理与异步调用时可主动停止的监听器。 */
    export function useEventListener(target, event, handler) {
      target.addEventListener(event, handler)
      const stop = () => target.removeEventListener(event, handler)
      if (getCurrentScope()) onScopeDispose(stop)
      return stop
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
      cols = 80
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
  '@/constants/terminal': dataModule(`
    export const currentTerminalTheme = () => ({
      foreground: document.documentElement.dataset.skinScheme === 'light' ? '#24292f' : '#ededed'
    })
  `),
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
  let measurements = 0
  globalThis.window = new EventTarget()
  globalThis.document = {
    documentElement: { dataset: { skinScheme: scheme } },
    createElement: () => ({
      getContext: () => ({
        font: '',
        // 按当前字体串模拟 JetBrains Mono 字宽，统计真实重测而非普通布局调用。
        measureText() {
          measurements++
          return { width: Number.parseFloat(this.font) * 0.6 }
        },
      }),
    }),
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
  return {
    scope,
    api,
    terminal,
    pending,
    changes: () => changes,
    measurements: () => measurements,
  }
}

/** 等待字体 Promise 和动态插件导入完成，不依赖固定时间延迟。 */
async function finishFonts(pending) {
  for (const item of pending.splice(0)) item.resolve([])
  await new Promise(resolve => setImmediate(resolve))
}

/** 记录字体与终端网格，防止主题切换改变字号、行距或远端行列数。 */
function terminalLayout(terminal) {
  const {
    fontFamily,
    fontSize,
    fontWeight,
    fontWeightBold,
    lineHeight,
    letterSpacing,
  } = terminal.options
  return {
    fontFamily,
    fontSize,
    fontWeight,
    fontWeightBold,
    lineHeight,
    letterSpacing,
    cols: terminal.cols,
    rows: terminal.rows,
  }
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

/** 用独立画布记录公开 GL 混合状态，覆盖安装、恢复与移除监听，不访问 xterm 私有实现。 */
function webglCanvas() {
  const canvas = new EventTarget()
  const gl = {
    ONE: 1,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    BLEND_SRC_RGB: 0x80c9,
    BLEND_DST_RGB: 0x80c8,
    BLEND_SRC_ALPHA: 0x80cb,
    BLEND_DST_ALPHA: 0x80ca,
    lost: false,
    blend: [0x0302, 0x0303, 0x0302, 0x0303],
    calls: [],
    /** 返回当前混合因子；丢失期间禁止读取，检查实现是否先判断上下文状态。 */
    getParameter(parameter) {
      assert.equal(this.lost, false)
      const index = [
        this.BLEND_SRC_RGB,
        this.BLEND_DST_RGB,
        this.BLEND_SRC_ALPHA,
        this.BLEND_DST_ALPHA,
      ].indexOf(parameter)
      return this.blend[index]
    },
    /** 模拟浏览器对暂时丢失上下文的查询。 */
    isContextLost() {
      return this.lost
    },
    /** 模拟 xterm 初始化或恢复时使用相同的 RGB 和 Alpha 因子。 */
    blendFunc(source, destination) {
      this.blend = [source, destination, source, destination]
    },
    /** 记录修复对公开混合状态的修改，验证没有更改 RGB 方程。 */
    blendFuncSeparate(...factors) {
      this.blend = factors
      this.calls.push(factors)
    },
  }
  // 同一画布只有一种上下文，覆盖层调用 webgl2 应返回 null 而不是新建 GL。
  canvas.getContext = type => (type === 'webgl2' ? gl : null)
  return { canvas, gl }
}

for (const scheme of ['light', 'dark']) {
  test(`${scheme} 透明 WebGL 修正笔画覆盖率，但保留 RGB、字重与透明背景`, async t => {
    const { terminal, pending } = fixture(t, scheme)
    const { canvas, gl } = webglCanvas()
    const originalBlend = gl.blendFunc
    // 实际 WebGL 画布前可能有链接高亮 2D 层，不能取第一个 canvas 就停止。
    const highlight = { getContext: () => null }
    terminal.element.querySelectorAll = selector => {
      assert.equal(selector, '.xterm-screen > canvas')
      return [highlight, canvas]
    }
    await finishFonts(pending)
    assert.deepEqual(gl.calls, [
      [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
    ])
    assert.equal(gl.blendFunc, originalBlend)
    assert.equal(terminal.options.allowTransparency, true)
    assert.equal(terminal.options.fontWeight, 400)
    assert.equal(terminal.options.fontWeightBold, 700)
    const layout = terminalLayout(terminal)
    const buffer = terminal.buffer
    document.documentElement.dataset.skinScheme = scheme === 'light' ? 'dark' : 'light'
    window.dispatchEvent(new Event('skin-change'))
    assert.equal(gl.calls.length, 1)
    assert.deepEqual(terminalLayout(terminal), layout)
    assert.equal(terminal.buffer, buffer)
  })
}

test('短暂 GL 丢失保留监听，恢复时在 xterm 重置状态后重新修正 Alpha', async t => {
  const created = WebglAddon.created
  const { terminal, pending, changes } = fixture(t, 'light')
  const { canvas, gl } = webglCanvas()
  // xterm 的恢复监听先注册，复现真实插件先重建 GlyphRenderer 的执行顺序。
  canvas.addEventListener('webglcontextrestored', () =>
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  )
  terminal.element.querySelectorAll = () => [canvas]
  await finishFonts(pending)
  const buffer = terminal.buffer
  const layout = terminalLayout(terminal)
  const count = changes()
  gl.lost = true
  canvas.dispatchEvent(new Event('webglcontextlost'))
  assert.equal(gl.calls.length, 1)
  gl.lost = false
  canvas.dispatchEvent(new Event('webglcontextrestored'))
  assert.equal(gl.calls.length, 2)
  assert.equal(gl.getParameter(gl.BLEND_SRC_ALPHA), gl.ONE)
  assert.equal(WebglAddon.created, created + 1)
  assert.equal(changes(), count)
  assert.deepEqual(terminalLayout(terminal), layout)
  assert.equal(terminal.buffer, buffer)
})

for (const reason of ['GPU 回退', '作用域卸载']) {
  test(`${reason} 后移除 Alpha 修复监听，不再修改关闭的画布`, async t => {
    const { terminal, pending, scope } = fixture(t)
    const { canvas, gl } = webglCanvas()
    terminal.element.querySelectorAll = () => [canvas]
    await finishFonts(pending)
    assert.equal(gl.calls.length, 1)
    if (reason === 'GPU 回退') {
      const renderer = terminal.addons.find(addon => addon instanceof WebglAddon)
      renderer.contextLoss()
      assert.equal(renderer.disposed, true)
      assert.equal(terminal.options.letterSpacing, 0)
    } else scope.stop()
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    assert.equal(gl.calls.length, 1)
    assert.equal(gl.getParameter(gl.BLEND_SRC_ALPHA), gl.SRC_ALPHA)
  })
}

for (const variant of ['预乘 RGB', '其他 RGB 混合', '上下文暂时丢失']) {
  test(`${variant} 时不覆盖不匹配或不可读取的 GL 状态`, async t => {
    const { terminal, pending } = fixture(t)
    const { canvas, gl } = webglCanvas()
    if (variant === '预乘 RGB') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    else if (variant === '其他 RGB 混合') gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    else gl.lost = true
    terminal.element.querySelectorAll = () => [canvas]
    const original = [...gl.blend]
    await finishFonts(pending)
    assert.equal(gl.calls.length, 0)
    assert.deepEqual(gl.blend, original)
    if (gl.lost) {
      gl.lost = false
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      assert.equal(gl.calls.length, 1)
      assert.equal(gl.getParameter(gl.BLEND_SRC_ALPHA), gl.ONE)
    } else {
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      assert.equal(gl.calls.length, 0)
    }
  })
}

for (const failure of ['返回空上下文', '读取上下文失败']) {
  test(`${failure} 不会中断 WebGL 加载或修改字体与缓冲区`, async t => {
    const { terminal, pending, changes } = fixture(t, 'light')
    const buffer = terminal.buffer
    terminal.element.querySelectorAll = () => [
      {
        getContext() {
          if (failure === '读取上下文失败') throw new Error('GL access unavailable')
          return null
        },
      },
    ]
    await finishFonts(pending)
    assert.ok(terminal.addons.some(addon => addon instanceof WebglAddon))
    assert.equal(changes(), 2)
    assert.equal(terminal.buffer, buffer)
    assert.equal(terminal.options.fontSize, 13)
    assert.equal(terminal.options.lineHeight, 1.4)
  })
}

test('明暗主题共用 WebGL 与浅色基准排版，切换只更新配色', async t => {
  const created = WebglAddon.created
  const { terminal, pending, changes } = fixture(t, 'light')
  assert.equal(terminal.options.allowTransparency, true)
  assert.equal(terminal.options.fontWeight, 400)
  assert.equal(terminal.options.fontWeightBold, 700)
  assert.equal(terminal.options.fontSize, 13)
  assert.equal(terminal.options.lineHeight, 1.4)
  assert.equal(terminal.options.letterSpacing, 0)
  await finishFonts(pending)
  assert.equal(terminal.options.letterSpacing, 1)
  const layout = terminalLayout(terminal)
  const addons = [...terminal.addons]
  const buffer = terminal.buffer
  const renderer = addons.find(addon => addon instanceof WebglAddon)
  assert.ok(renderer)

  for (const scheme of ['dark', 'light', 'dark']) {
    document.documentElement.dataset.skinScheme = scheme
    window.dispatchEvent(new Event('skin-change'))
    assert.equal(pending.length, 0)
    await finishFonts(pending)
    assert.equal(
      terminal.options.theme.foreground,
      scheme === 'light' ? '#24292f' : '#ededed'
    )
    assert.deepEqual(terminalLayout(terminal), layout)
    assert.deepEqual(terminal.addons, addons)
    assert.equal(renderer.disposed, false)
    assert.equal(terminal.buffer, buffer)
    assert.equal(changes(), 2)
    assert.equal(WebglAddon.created, created + 1)
  }
})

test('字体加载途中连续切换主题，不重复加载字体或重建 WebGL', async t => {
  const created = WebglAddon.created
  const { terminal, pending, changes } = fixture(t)
  const layout = terminalLayout(terminal)
  for (const scheme of ['light', 'dark', 'light', 'dark']) {
    document.documentElement.dataset.skinScheme = scheme
    window.dispatchEvent(new Event('skin-change'))
    assert.equal(pending.length, 2)
    assert.deepEqual(terminalLayout(terminal), layout)
  }
  await finishFonts(pending)
  assert.equal(terminal.cleared, 1)
  assert.equal(terminal.refreshed, 1)
  assert.equal(changes(), 2)
  assert.equal(WebglAddon.created, created + 1)
})

test('字号设置在明暗主题中保持一致，旧字体下载不能覆盖新字号', async t => {
  const { terminal, pending, changes } = fixture(t)
  const initial = pending.splice(0)
  settings.terminalFontSize = '16'
  await nextTick()
  assert.equal(terminal.options.fontSize, 16)
  await finishFonts(initial)
  assert.equal(terminal.cleared, 0)
  assert.match(pending[0].font, /^400 16px /)
  await finishFonts(pending)
  assert.equal(terminal.refreshed, 1)
  const layout = terminalLayout(terminal)
  const count = changes()
  for (const scheme of ['light', 'dark']) {
    document.documentElement.dataset.skinScheme = scheme
    window.dispatchEvent(new Event('skin-change'))
    assert.deepEqual(terminalLayout(terminal), layout)
    assert.equal(pending.length, 0)
    assert.equal(changes(), count)
  }
})

/** 提供真实可见尺寸，检查 fit 只适配网格而不再按容器余数压缩行距。 */
function setTerminalHeight(terminal, height) {
  Object.assign(terminal.element, {
    clientWidth: 700,
    clientHeight: height,
    parentElement: { clientHeight: height },
    querySelector: () => ({ style: { height: '432px' } }),
  })
}

test('窗口和分屏高度变化保持浅色基准行距，普通 fit 不重复测量字体', async t => {
  const { api, terminal, pending, measurements } = fixture(t, 'light')
  await finishFonts(pending)
  const count = measurements()
  assert.ok(count > 0)
  for (const height of [401, 430, 480, 360]) {
    setTerminalHeight(terminal, height)
    assert.equal(api.fit(), true)
    assert.equal(terminal.options.lineHeight, 1.4)
    assert.equal(terminal.options.fontSize, 13)
    assert.equal(terminal.options.letterSpacing, 1)
    assert.equal(measurements(), count)
  }
})

test('字距按字号与系统缩放校准到最近整数网格，不固定放大字体或字距', async t => {
  const { api, terminal, pending } = fixture(t)
  await finishFonts(pending)
  for (const [size, ratio, spacing] of [
    [13, 1, 1],
    [13, 1.25, 1],
    [13, 1.5, 1],
    [13, 2, 1],
    [13, 3, 0],
    [14, 1, 0],
    [16, 1, 1],
  ]) {
    settings.terminalFontSize = String(size)
    await nextTick()
    await finishFonts(pending)
    window.devicePixelRatio = ratio
    setTerminalHeight(terminal, 401)
    assert.equal(api.fit(), true)
    assert.equal(terminal.options.fontSize, size)
    assert.equal(terminal.options.lineHeight, 1.4)
    assert.equal(terminal.options.letterSpacing, spacing)
    const deviceWidth = size * 0.6 * ratio
    assert.ok(
      Math.abs(Math.floor(deviceWidth) + spacing - deviceWidth) <= 0.500001
    )
  }
})

test('容器尺寸不变的 DPI 切换自动校准字距并通知远端适配，卸载后停止监听', async t => {
  const { terminal, pending, changes, measurements, scope } = fixture(t)
  await finishFonts(pending)
  const initial = changes()
  const measured = measurements()
  const buffer = terminal.buffer
  for (const [ratio, spacing] of [[3, 0], [1.5, 1]]) {
    window.devicePixelRatio = ratio
    window.dispatchEvent(new Event('test-dpr-change'))
    await nextTick()
    assert.equal(terminal.options.letterSpacing, spacing)
    assert.equal(terminal.options.fontSize, 13)
    assert.equal(terminal.options.lineHeight, 1.4)
    assert.equal(terminal.buffer, buffer)
  }
  assert.equal(changes(), initial + 2)
  assert.equal(measurements(), measured + 2)
  window.dispatchEvent(new Event('test-dpr-change'))
  await nextTick()
  assert.equal(changes(), initial + 2)
  scope.stop()
  window.devicePixelRatio = 3
  window.dispatchEvent(new Event('test-dpr-change'))
  await nextTick()
  assert.equal(changes(), initial + 2)
  assert.equal(measurements(), measured + 2)
})

test('字体下载期间 fit 缓存的回退字宽不会覆盖下载后的真实字宽', async t => {
  const { api, terminal, pending } = fixture(t)
  let width = 7.8
  // 模拟先用系统回退字体适配，再下载到字宽不同的实际字体。
  document.createElement = () => ({
    getContext: () => ({ font: '', measureText: () => ({ width }) }),
  })
  await finishFonts(pending)
  settings.terminalFontSize = '14'
  await nextTick()
  width = 8.6
  setTerminalHeight(terminal, 401)
  assert.equal(api.fit(), true)
  assert.equal(terminal.options.letterSpacing, 1)
  width = 8.4
  await finishFonts(pending)
  assert.equal(terminal.options.letterSpacing, 0)
  assert.equal(terminal.options.fontSize, 14)
})

test('GPU 上下文丢失时回退 DOM，撤销字距补偿但保留字体和缓冲区', async t => {
  const { terminal, pending, changes } = fixture(t, 'light')
  await finishFonts(pending)
  const renderer = terminal.addons.find(addon => addon instanceof WebglAddon)
  const buffer = terminal.buffer
  assert.equal(terminal.options.letterSpacing, 1)
  renderer.contextLoss()
  assert.equal(renderer.disposed, true)
  assert.equal(terminal.options.letterSpacing, 0)
  assert.equal(terminal.options.lineHeight, 1.4)
  assert.equal(terminal.options.fontSize, 13)
  assert.equal(terminal.buffer, buffer)
  assert.equal(changes(), 3)
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
