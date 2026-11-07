/**
 * xterm.js 实例的公共部分。
 *
 * SSH 终端和本地终端只在"数据从哪来、按键发到哪"上不同，
 * 字体、光标、回滚缓冲、皮肤配色和设置联动都一样，统一放在这里。
 */

import { shallowRef, watch } from 'vue'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { i18n } from '@/i18n'
import { currentTerminalTheme } from '@/constants/terminal'
import { toast } from '@/composables/useToast'
import { copyText } from '@/utils/clipboard'
import { SKIN_CHANGE_EVENT } from '@/utils/skin-runtime'
import { IS_TAURI } from '@/utils/window'
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
 * 用 WebGL 渲染终端，持续大量输出时比 DOM 渲染省得多。
 * 显卡不支持或上下文丢失（驱动重置、休眠唤醒）时卸载插件，xterm 自动退回 DOM 渲染。
 */
async function enableWebgl(terminal: Terminal): Promise<void> {
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl')
    // 终端可能在插件加载期间已经关闭。
    if (!terminal.element?.isConnected) return
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    terminal.loadAddon(webgl)
  } catch {
    /* 不支持 WebGL2 时保留 DOM 渲染。 */
  }
}

/**
 * 终端里的网址按 Ctrl/⌘+单击打开：普通单击常用于定位或拖选，直接跳浏览器容易误触。
 */
function loadWebLinks(terminal: Terminal): void {
  const hint = i18n.global.t('按住 Ctrl 或 ⌘ 单击打开链接')
  const addon = new WebLinksAddon(
    (event, uri) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const open = IS_TAURI
        ? openUrl(uri)
        : Promise.resolve(window.open(uri, '_blank', 'noopener,noreferrer'))
      void open.catch(() =>
        toast.error(i18n.global.t('无法打开链接，请复制地址后在浏览器打开'))
      )
    },
    {
      hover: () => terminal.element?.setAttribute('title', hint),
      leave: () => terminal.element?.removeAttribute('title'),
    }
  )
  terminal.loadAddon(addon)
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
      // Unicode 11 宽度表与搜索高亮装饰都属于 proposed API。
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    // 默认的 Unicode 6 宽度表会把大部分 emoji 当成单宽，光标与后续字符随之错位。
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    loadWebLinks(terminal)
    terminal.open(container)
    fit.fit()
    void enableWebgl(terminal)

    // 拖选过程中选区会连续变化，停稳后再写剪贴板。
    const copySelection = useDebounceFn(() => {
      const text = terminal.getSelection()
      if (settings.terminalCopyOnSelect && text)
        void copyText(text).catch(() => {})
    }, 160)
    terminal.onSelectionChange(() => {
      if (settings.terminalCopyOnSelect) void copySelection()
    })

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
