import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const { createTerminalCursor } = await sourceLoader()(
  'src/utils/terminal-cursor.ts'
)

/** 用公开终端事件与可控网格验证光标定位、程序隐藏、焦点和卸载，不依赖渲染器内部实现。 */
function fixture(t) {
  const previous = { document: globalThis.document, window: globalThis.window }
  const listeners = new Map(),
    parsers = new Map()
  const focus = {}
  const animation = { currentTime: 100 }
  let removed = false
  const node = {
    dataset: {},
    style: {
      setProperty(key, value) {
        this[key] = value
      },
    },
    setAttribute() {},
    getAnimations: () => [animation],
    remove: () => {
      removed = true
    },
  }
  const screen = {
    style: { width: '800px', height: '480px' },
    appendChild() {},
  }
  const element = new EventTarget()
  element.querySelector = () => screen
  element.contains = target => target === focus
  globalThis.document = {
    activeElement: focus,
    hasFocus: () => true,
    createElement: () => node,
  }
  globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 2 })
  const event = name => callback => {
    listeners.set(name, callback)
    return { dispose: () => listeners.delete(name) }
  }
  const register = (id, callback) => {
    const key = (id.prefix || id.intermediates || '') + id.final
    parsers.set(key, callback)
    return { dispose: () => parsers.delete(key) }
  }
  const buffer = {
    cursorX: 4,
    cursorY: 3,
    baseY: 20,
    viewportY: 20,
    getLine: () => ({ getCell: () => ({ getWidth: () => 2 }) }),
  }
  const terminal = {
    element,
    cols: 80,
    rows: 24,
    options: { cursorStyle: 'block', fontSize: 13 },
    buffer: { active: buffer, onBufferChange: event('buffer') },
    onRender: event('render'),
    onCursorMove: event('move'),
    onResize: event('resize'),
    onScroll: event('scroll'),
    onKey: event('key'),
    parser: { registerCsiHandler: register, registerEscHandler: register },
  }
  let blink = true
  const api = createTerminalCursor(terminal, () => blink)
  t.after(() => {
    api.dispose()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  })
  return {
    api,
    terminal,
    node,
    buffer,
    parsers,
    listeners,
    animation,
    stopBlink: () => {
      blink = false
    },
    removed: () => removed,
  }
}

test('三种形状共用真实网格，中文宽字符、窗口缩放和滚离输入行保持对齐', t => {
  const f = fixture(t)
  assert.equal(f.node.style.transform, 'translate(40px, 60px)')
  assert.equal(f.node.style.width, '20px')
  assert.equal(f.node.style.height, '20px')
  assert.equal(f.node.style['--mirai-cursor-height'], '15px')
  f.terminal.options.fontSize = 16
  f.api.refresh()
  assert.equal(f.node.style['--mirai-cursor-height'], '18px')
  for (const shape of ['bar', 'underline', 'block']) {
    f.terminal.options.cursorStyle = shape
    f.api.refresh()
    assert.equal(f.node.dataset.shape, shape)
    assert.equal(f.node.dataset.blink, 'true')
  }
  f.terminal.cols = 40
  f.listeners.get('resize')()
  assert.equal(f.node.style.transform, 'translate(80px, 60px)')
  f.buffer.viewportY = 0
  f.buffer.cursorY = 12
  f.listeners.get('scroll')()
  assert.equal(f.node.hidden, true)
  f.buffer.viewportY = 20
  f.listeners.get('scroll')()
  assert.equal(f.node.hidden, false)
})

test('程序隐藏与重显光标仍交给终端，打开设置失焦后保留所选形状', t => {
  const f = fixture(t)
  assert.equal(f.parsers.get('?l')([25, 2004]), false)
  assert.equal(f.node.hidden, true)
  assert.equal(f.parsers.get('?h')([25]), false)
  assert.equal(f.node.hidden, false)
  f.stopBlink()
  f.api.refresh()
  assert.equal(f.node.dataset.blink, 'false')
  document.activeElement = null
  f.terminal.element.dispatchEvent(new Event('focusout'))
  assert.equal(f.node.dataset.focused, 'false')
  assert.equal(f.node.dataset.shape, 'block')
  for (const shape of ['underline', 'block', 'bar']) {
    f.terminal.options.cursorStyle = shape
    document.hasFocus = () => false
    window.dispatchEvent(new Event('blur'))
    assert.equal(f.node.dataset.focused, 'false')
    assert.equal(f.node.dataset.shape, shape)
  }
  f.parsers.get('?l')([25])
  f.parsers.get('c')()
  assert.equal(f.node.hidden, false)
})

test('输入从亮态重新闪烁，卸载后释放全部终端与解析器监听', t => {
  const f = fixture(t)
  f.animation.currentTime = 700
  f.listeners.get('key')()
  assert.equal(f.animation.currentTime, 0)
  f.api.dispose()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.parsers.size, 0)
  assert.equal(f.removed(), true)
})
