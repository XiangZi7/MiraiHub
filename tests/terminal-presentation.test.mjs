import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, shallowRef } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const settingsUrl = dataModule(`
  import { reactive } from ${JSON.stringify(import.meta.resolve('vue'))}
  export const settings = reactive({ terminalStyle: 'v4', terminalCommandBlocks: true })
  export const useSettings = () => ({ settings })
`)
const load = sourceLoader({ '@/composables/useSettings': settingsUrl })
const { settings } = await import(settingsUrl)
const { parseTerminalPrompt, useTerminalPresentation } = await load(
  'src/composables/useTerminalPresentation.ts'
)
const { createTerminalOutputFormatter } = await load(
  'src/utils/terminal-output.ts'
)

test('提示符解析支持实际目录、分支和 Windows 路径，普通日志不被识别为提示符', () => {
  assert.equal(
    parseTerminalPrompt('root@server:/data/miraiTV# ls').directory,
    '/data/miraiTV'
  )
  const prompt = parseTerminalPrompt(
    'haruto@mirai-server:~/MiraiHub ⎇ main $ git pull'
  )
  assert.equal(prompt.branch, 'main')
  assert.equal(prompt.directory, '~/MiraiHub')
  assert.equal(parseTerminalPrompt('PS D:\\项目> ls').directory, 'D:\\项目')
  assert.equal(parseTerminalPrompt('fatal: repository not found'), undefined)
  assert.equal(parseTerminalPrompt('hello $ world'), undefined)
})

test('v4 只在提示符前补留白，完整保留 ANSI、已存在的空行和普通输出', () => {
  const formatter = createTerminalOutputFormatter(() => true)
  assert.equal(formatter.write('total 48\r\n'), 'total 48\r\n')
  assert.equal(
    formatter.write('root@server:/data# '),
    '\r\nroot@server:/data# '
  )
  assert.equal(
    formatter.write('ls\r\nfile.txt\r\n\r\n'),
    'ls\r\nfile.txt\r\n\r\n'
  )
  assert.equal(
    formatter.write('\x1b[32mroot@server:/data# \x1b[0m'),
    '\x1b[32mroot@server:/data# \x1b[0m'
  )
  assert.equal(
    formatter.write('echo ok\r\nok\r\n\x1b]133;D;0\x07\r\n\x1b]133;A\x07'),
    'echo ok\r\nok\r\n\x1b]133;D;0\x07\r\n\x1b]133;A\x07'
  )
})

test('跨包 ANSI、提示符和 UTF-8 保持顺序，超时与重连可释放或丢弃未闭合片段', () => {
  const formatter = createTerminalOutputFormatter(() => true)
  assert.equal(formatter.write('\x1b[3'), '')
  assert.equal(formatter.write('2mroot@ser'), '\x1b[32m')
  assert.equal(formatter.write('ver:/data# '), '\r\nroot@server:/data# ')
  const bytes = new TextEncoder().encode('中文')
  assert.equal(formatter.write(bytes.subarray(0, 2)), '')
  assert.equal(formatter.write(bytes.subarray(2)), '中文')
  formatter.reset()
  assert.equal(formatter.write('loading'), '')
  assert.equal(formatter.flush(), 'loading')
  formatter.reset()
  formatter.write('old')
  formatter.reset()
  assert.equal(formatter.flush(), '')
})

test('经典样式保留原始字节，全屏程序与光标回写原样转发', () => {
  let enabled = false
  const formatter = createTerminalOutputFormatter(() => enabled)
  const bytes = new TextEncoder().encode('root@server:~# ')
  assert.equal(formatter.write(bytes), bytes)
  enabled = true
  const enter = '\x1b[?1049h\x1b[Hroot@server:/data# '
  assert.equal(formatter.write(enter), enter)
  assert.equal(formatter.write('root@server:/data# '), 'root@server:/data# ')
  assert.equal(formatter.write('\x1b[?1049l'), '\x1b[?1049l')
  assert.equal(
    formatter.write('\rroot@server:/data# '),
    '\rroot@server:/data# '
  )
})

/** 用可控缓冲区和公开事件模拟终端，检查装饰、样式切换和监听清理。 */
function fixture(t, lines = ['root@server:/data# ls'], readGitBranch) {
  const previous = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  let sequence = 0
  const frames = new Map(),
    handlers = new Map(),
    osc = new Map()
  globalThis.requestAnimationFrame = fn => {
    frames.set(++sequence, fn)
    return sequence
  }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  const event = name => callback => {
    const callbacks = handlers.get(name) ?? new Set()
    handlers.set(name, callbacks)
    callbacks.add(callback)
    return { dispose: () => callbacks.delete(callback) }
  }
  const normal = {
    type: 'normal',
    baseY: 0,
    viewportY: 0,
    cursorY: lines.length - 1,
    cursorX: lines.at(-1).length,
    getLine: line =>
      lines[line] === undefined
        ? undefined
        : {
            isWrapped: false,
            translateToString: () => lines[line],
            getCell: column => ({
              getWidth: () => 1,
              getChars: () => lines[line][column] ?? '',
              isFgDefault: () => true,
              isFgPalette: () => false,
            }),
          },
  }
  const decorations = [],
    markers = []
  const terminal = {
    cols: 120,
    rows: 30,
    options: {
      theme: {
        foreground: '#d6d6de',
        blue: '#82a8d8',
        magenta: '#b39ddb',
        green: '#8cb369',
        red: '#de7a72',
        yellow: '#d9b26a',
        cyan: '#7bb5ad',
        brightBlack: '#62626e',
      },
    },
    buffer: { normal, active: normal, onBufferChange: event('buffer') },
    onRender: event('render'),
    onCursorMove: event('cursor'),
    onWriteParsed: event('write'),
    onResize: event('resize'),
    onScroll: event('scroll'),
    onData: event('data'),
    parser: {
      registerOscHandler: (code, handler) => {
        osc.set(code, handler)
        return { dispose: () => osc.delete(code) }
      },
    },
    registerMarker(offset) {
      const marker = {
        line: normal.baseY + normal.cursorY + offset,
        isDisposed: false,
        dispose() {
          this.isDisposed = true
        },
      }
      markers.push(marker)
      return marker
    },
    registerDecoration(options) {
      const element = {
        textContent: '',
        dataset: {},
        classList: {
          classes: [],
          add(value) {
            this.classes.push(value)
          },
        },
      }
      const decoration = {
        options,
        element,
        disposed: false,
        onRender: fn => fn(element),
        dispose() {
          this.disposed = true
        },
      }
      decorations.push(decoration)
      return decoration
    },
  }
  settings.terminalStyle = 'v4'
  settings.terminalCommandBlocks = true
  const scope = effectScope(),
    sessionId = shallowRef('session-1'),
    term = shallowRef(terminal)
  const api = scope.run(() =>
    useTerminalPresentation(term, sessionId, { readGitBranch })
  )
  const emit = (name, data) =>
    [...(handlers.get(name) ?? [])].forEach(fn => fn(data))
  const render = () => {
    for (const fn of frames.values()) fn()
    frames.clear()
  }
  t.after(() => {
    scope.stop()
    Object.assign(globalThis, previous)
  })
  return {
    api,
    lines,
    normal,
    terminal,
    term,
    sessionId,
    emit,
    render,
    osc,
    scope,
    handlers,
    markers,
    decorations,
    active: () => decorations.filter(item => !item.disposed),
  }
}

test('普通 Shell 回车到下一提示符的耗时在右侧显示，不覆盖提示符，也不伪造退出码', t => {
  const f = fixture(t)
  f.emit('data', '\r')
  f.lines.push('file.txt', 'root@server:/data# ')
  f.normal.cursorY = 2
  f.emit('write')
  f.render()
  const meta = f
    .active()
    .filter(item =>
      item.element.classList.classes.includes('mirai-command-meta')
    )
  assert.equal(meta.length, 1)
  assert.match(meta[0].element.textContent, /^\d+\.\ds$/)
  assert.equal(meta[0].options.anchor, 'right')
  assert.ok(
    meta[0].options.x > 0,
    'xterm x=0 会清空 right 样式，导致耗时叠到左侧'
  )
  assert.equal(meta[0].element.dataset.failed, 'false')
})

test('OSC 退出码、目录与光标来自当前会话；样式切换和备用缓冲区不重建终端或输出', async t => {
  const f = fixture(t)
  assert.equal(f.osc.get(133)('C'), false)
  f.osc.get(133)('D;126')
  f.osc.get(7)('file://server/data/%E9%A1%B9%E7%9B%AE')
  assert.equal(f.api.directory.value, '/data/项目')
  f.normal.cursorX = 12
  f.emit('cursor')
  assert.equal(f.api.position.value, 'Ln 1, Col 13')
  f.render()
  assert.ok(f.active().some(item => item.element.textContent === 'exit 126'))
  const original = [...f.lines]
  settings.terminalStyle = 'classic'
  await nextTick()
  f.render()
  assert.equal(f.active().length, 0)
  settings.terminalStyle = 'v4'
  await nextTick()
  f.render()
  assert.ok(f.active().length)
  f.terminal.buffer.active = { ...f.normal, type: 'alternate' }
  f.emit('buffer')
  f.render()
  assert.equal(f.active().length, 0)
  assert.equal(f.term.value, f.terminal)
  assert.deepEqual(f.lines, original)
  f.scope.stop()
  assert.ok(f.markers.every(marker => marker.isDisposed))
  assert.equal(f.osc.size, 0)
})

test('普通 Bash 没有分支文本时按实际目录查询，切换目录和会话后丢弃过期结果', async t => {
  const requests = []
  const f = fixture(
    t,
    ['root@server:/data/project# '],
    (id, directory) =>
      new Promise(resolve => requests.push({ id, directory, resolve }))
  )
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 140))
  assert.equal(requests[0].directory, '/data/project')
  requests[0].resolve('feature/live-git')
  await nextTick()
  await nextTick()
  assert.equal(f.api.branch.value, 'feature/live-git')
  f.render()
  assert.ok(
    f.active().some(item => item.element.textContent === '⎇ feature/live-git')
  )
  f.lines.push('root@server:/data/other# ')
  f.normal.cursorY = 1
  f.emit('write')
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 140))
  assert.equal(requests[1].directory, '/data/other')
  f.lines.push('root@server:/data/third# ')
  f.normal.cursorY = 2
  f.emit('write')
  await nextTick()
  requests[1].resolve('stale-branch')
  await nextTick()
  assert.notEqual(f.api.branch.value, 'stale-branch')
  await new Promise(resolve => setTimeout(resolve, 140))
  requests[2].resolve('main')
  await nextTick()
  assert.equal(f.api.branch.value, 'main')
  f.sessionId.value = 'session-2'
  await nextTick()
  assert.equal(f.api.branch.value, '')
})
