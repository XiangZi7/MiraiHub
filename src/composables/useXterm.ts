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

/** 将终端字体设置解析为内置字体和系统等宽字体的回退顺序。 */
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

  /**
   * 首次打开或切换字体时主动加载常规与粗体字形，完成后重新测量网格。
   * xterm 会缓存字体尚未就绪时的回退字形；只刷新行内容无法修正字宽和纹理。
   * 关闭终端或切到其他字体后忽略旧加载结果，加载失败则保留系统等宽回退。
   */
  async function refreshFont(terminal: Terminal): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    const family = terminal.options.fontFamily!
    const size = terminal.options.fontSize!
    const regular = `400 ${size}px ${family}`
    const bold = `700 ${size}px ${family}`
    if (document.fonts.check(regular) && document.fonts.check(bold)) return
    try {
      await Promise.all([
        document.fonts.load(regular),
        document.fonts.load(bold),
      ])
    } catch {
      return
    }
    if (
      term.value !== terminal ||
      !terminal.element?.isConnected ||
      terminal.options.fontFamily !== family ||
      terminal.options.fontSize !== size
    )
      return
    // 用公开选项触发字宽重测；两次同步赋值由 xterm 合并到下一帧绘制。
    terminal.options.fontFamily = 'monospace'
    terminal.options.fontFamily = family
    terminal.clearTextureAtlas()
    terminal.refresh(0, terminal.rows - 1)
    onOptionsChange()
  }

  /** 创建终端并挂到容器上，立即按容器尺寸 fit 一次。 */
  function open(container: HTMLElement): Terminal {
    const terminal = new Terminal({
      fontFamily: terminalFontFamily(),
      fontSize: settingNumber('terminalFontSize', 13),
      fontWeight: 400,
      fontWeightBold: 700,
      lineHeight: 1.4,
      cursorStyle: settings.terminalCursor as CursorStyle,
      cursorBlink: settings.terminalCursorBlink,
      // 回滚缓冲给足：排查日志时经常要往回翻很多屏
      scrollback: settingNumber('terminalScrollback', 5000),
      theme: currentTerminalTheme(),
      // 程序自带的浅灰、白色和真彩色在浅色皮肤下也应保持可读。
      minimumContrastRatio: 4.5,
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
    // 先等内置字体就绪再创建 WebGL 字形图集，避免首屏缓存系统回退字体。
    void refreshFont(terminal).then(() => enableWebgl(terminal))
    return terminal
  }

  // 字体、字号与终端选项变更后重新适配；异步字体到达时再补一次测量。
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
      void refreshFont(terminal)
    }
  )

  return { term, fitAddon, open, stopSettingsWatch }
}
