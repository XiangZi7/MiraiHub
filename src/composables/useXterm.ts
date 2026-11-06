/**
 * xterm.js 实例的公共部分。
 *
 * SSH 终端和本地终端只在"数据从哪来、按键发到哪"上不同，
 * 字体、光标、回滚缓冲、皮肤配色和设置联动都一样，统一放在这里。
 */

import { shallowRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { currentTerminalTheme } from '@/constants/terminal'
import { SKIN_CHANGE_EVENT } from '@/utils/skin-runtime'
import {
  settingNumber,
  settingsSnapshot,
  useSettings,
} from '@/composables/useSettings'

type CursorStyle = 'block' | 'bar' | 'underline'

const FONT_FAMILIES: Record<string, string> = {
  'jetbrains-mono': '"JetBrains Mono Variable", ui-monospace, monospace',
  'cascadia-code': '"Cascadia Code", ui-monospace, monospace',
  consolas: 'Consolas, ui-monospace, monospace',
}

export function terminalFontFamily(): string {
  return (
    FONT_FAMILIES[settingsSnapshot().terminalFont] ??
    FONT_FAMILIES['jetbrains-mono']!
  )
}

/**
 * @param onOptionsChange 字体、字号等设置变化后调用，调用方借此重新 fit 并同步远端尺寸。
 */
export function useXterm(onOptionsChange: () => void) {
  const { settings } = useSettings()
  // xterm 实例不参与响应式：它内部持有大量 DOM 与缓冲区，
  // 被 Vue 深度代理会显著拖慢渲染
  const term = shallowRef<Terminal>()
  const fitAddon = shallowRef<FitAddon>()

  useEventListener(window, SKIN_CHANGE_EVENT, () => {
    if (term.value) term.value.options.theme = currentTerminalTheme()
  })

  /** 创建终端并挂到容器上，立即按容器尺寸 fit 一次。 */
  function open(container: HTMLElement): Terminal {
    const terminal = new Terminal({
      fontFamily: terminalFontFamily(),
      fontSize: settingNumber('terminalFontSize', 13),
      lineHeight: 1.4,
      cursorStyle: settings.terminalCursor as CursorStyle,
      cursorBlink: settings.terminalCursorBlink,
      // 回滚缓冲给足：排查日志时经常要往回翻很多屏
      scrollback: settingNumber('terminalScrollback', 5000),
      theme: currentTerminalTheme(),
      allowTransparency: true,
      // 让 xterm 自己吞掉 Ctrl+C 之类的组合键交给远端，而不是被浏览器截走
      macOptionIsMeta: true,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    fit.fit()

    term.value = terminal
    fitAddon.value = fit
    return terminal
  }

  const stopSettingsWatch = watch(
    () =>
      [
        settings.terminalFont,
        settings.terminalFontSize,
        settings.terminalCursor,
        settings.terminalCursorBlink,
        settings.terminalScrollback,
      ] as const,
    () => {
      const terminal = term.value
      if (!terminal) return
      terminal.options.fontFamily = terminalFontFamily()
      terminal.options.fontSize = settingNumber('terminalFontSize', 13)
      terminal.options.cursorStyle = settings.terminalCursor as CursorStyle
      terminal.options.cursorBlink = settings.terminalCursorBlink
      terminal.options.scrollback = settingNumber('terminalScrollback', 5000)
      onOptionsChange()
    }
  )

  return { term, fitAddon, open, stopSettingsWatch }
}
