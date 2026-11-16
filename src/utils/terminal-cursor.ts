import type { Terminal } from '@xterm/xterm'

/** 用同一层圆角光标覆盖 DOM/WebGL 网格，形状仍由终端选项控制，不改写缓冲区或输入。 */
export function createTerminalCursor(terminal: Terminal, blink: () => boolean) {
  const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen')
  if (!screen) return
  const cursor = document.createElement('div')
  cursor.className = 'mirai-terminal-cursor'
  cursor.setAttribute('aria-hidden', 'true')
  screen.appendChild(cursor)
  let visible = true
  let previousPosition = ''

  /** 键入或移动时重新从亮态开始闪烁，不用强制布局或另开计时器。 */
  function restartBlink(): void {
    cursor.getAnimations().forEach(animation => {
      animation.currentTime = 0
    })
  }

  /** 按公开缓冲坐标定位光标；滚离输入行时隐藏，中文与全屏程序继续使用 xterm 的真实网格。 */
  function refresh(): void {
    const buffer = terminal.buffer.active
    const row = buffer.baseY + buffer.cursorY - buffer.viewportY
    const column = Math.min(buffer.cursorX, terminal.cols - 1)
    const width =
      (parseFloat(screen!.style.width) || screen!.clientWidth) / terminal.cols
    const height =
      (parseFloat(screen!.style.height) || screen!.clientHeight) / terminal.rows
    cursor.hidden =
      !visible || row < 0 || row >= terminal.rows || !width || !height
    const focused =
      document.hasFocus() &&
      (terminal.element?.contains(document.activeElement) ?? false)
    cursor.dataset.focused = String(focused)
    cursor.dataset.blink = String(blink())
    cursor.dataset.shape = terminal.options.cursorStyle
    const cell = buffer.getLine(buffer.baseY + buffer.cursorY)?.getCell(column)
    cursor.style.width = `${width * Math.max(1, cell?.getWidth() ?? 1)}px`
    cursor.style.height = `${height}px`
    cursor.style.setProperty(
      '--mirai-cursor-height',
      `${Math.min(height, (terminal.options.fontSize ?? 14) + 2)}px`
    )
    const ratio = window.devicePixelRatio || 1
    const x = Math.round(column * width * ratio) / ratio
    const y = Math.round(row * height * ratio) / ratio
    const position = `${x},${y},${cursor.dataset.shape},${focused}`
    if (position !== previousPosition) {
      cursor.style.transform = `translate(${x}px, ${y}px)`
      previousPosition = position
      restartBlink()
    }
  }

  /** 只记录 DECTCEM 可见性，返回 false 让隐藏光标及同批的其他模式继续交给 xterm。 */
  function setVisibility(
    params: (number | number[])[],
    enabled: boolean
  ): boolean {
    if (params.includes(25)) {
      visible = enabled
      refresh()
    }
    return false
  }

  /** 重连或终端复位时恢复可见性，后续远端隐藏序列仍会正常生效。 */
  function reset(): boolean {
    visible = true
    previousPosition = ''
    refresh()
    return false
  }

  const disposables = [
    terminal.onRender(refresh),
    terminal.onCursorMove(refresh),
    terminal.onResize(refresh),
    terminal.onScroll(refresh),
    terminal.onKey(restartBlink),
    terminal.buffer.onBufferChange(refresh),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params =>
      setVisibility(params, true)
    ),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params =>
      setVisibility(params, false)
    ),
    terminal.parser.registerEscHandler({ final: 'c' }, reset),
    terminal.parser.registerCsiHandler(
      { intermediates: '!', final: 'p' },
      reset
    ),
  ]
  terminal.element!.addEventListener('focusin', refresh)
  terminal.element!.addEventListener('focusout', refresh)
  window.addEventListener('focus', refresh)
  window.addEventListener('blur', refresh)
  refresh()

  /** 卸载时释放 DOM、解析器与事件监听，防止关闭的分屏继续更新光标。 */
  function dispose(): void {
    disposables.forEach(item => item.dispose())
    terminal.element?.removeEventListener('focusin', refresh)
    terminal.element?.removeEventListener('focusout', refresh)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('blur', refresh)
    cursor.remove()
  }

  return { refresh, reset, dispose }
}
