/**
 * xterm.js 实例的公共部分。
 *
 * SSH 终端和本地终端只在"数据从哪来、按键发到哪"上不同，
 * 字体、光标、回滚缓冲、皮肤配色和设置联动都一样，统一放在这里。
 */

import { onScopeDispose, shallowRef, watch } from 'vue'
import {
  useDebounceFn,
  useDevicePixelRatio,
  useEventListener,
} from '@vueuse/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { i18n } from '@/i18n'
import { currentTerminalTheme } from '@/constants/terminal'
import { toast } from '@/composables/useToast'
import { copyText } from '@/utils/clipboard'
import { SKIN_CHANGE_EVENT } from '@/utils/skin-runtime'
import { IS_TAURI } from '@/utils/window'
import { createTerminalCursor } from '@/utils/terminal-cursor'
import {
  settingNumber,
  settingsSnapshot,
  useSettings,
} from '@/composables/useSettings'

type CursorStyle = 'block' | 'bar' | 'underline'

const TERMINAL_LINE_HEIGHT = 1.4

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
 * 管理 SSH 与本地终端的字体、渲染器和设置联动，不重建底层会话。
 * @param onOptionsChange 字体、字号等设置变化后调用，调用方借此重新 fit 并同步远端尺寸。
 */
export function useXterm(onOptionsChange: () => void) {
  const { settings } = useSettings()
  const { pixelRatio } = useDevicePixelRatio()
  // xterm 实例不参与响应式：它内部持有大量 DOM 与缓冲区，
  // 被 Vue 深度代理会显著拖慢渲染
  const term = shallowRef<Terminal>()
  let fitAddon: FitAddon | undefined
  let webglAddon: WebglAddon | undefined
  let stopWebglAlpha: (() => void) | undefined
  let rendererRevision = 0
  let fontContext: CanvasRenderingContext2D | null | undefined
  let measuredFont = ''
  let cursor: ReturnType<typeof createTerminalCursor>
  const cursorDisposables: IDisposable[] = []
  onScopeDispose(() => {
    cursorDisposables.forEach(item => item.dispose())
    stopWebglAlpha?.()
    stopWebglAlpha = undefined
    cursor?.dispose()
    cursor = undefined
  })

  /** SSH 与本地输出统一原样交给 xterm，保留 ANSI、换行与跨包 UTF-8。 */
  function writeOutput(data: string | Uint8Array): void {
    term.value?.write(data)
  }

  /** 重连前重置光标层，避免沿用上一会话的光标位置。 */
  function resetOutput(): void {
    cursor?.reset()
  }

  // 皮肤变化只同步配色，复用 WebGL、字体网格、缓冲区与 SSH 会话，避免文字密度跳变。
  useEventListener(window, SKIN_CHANGE_EVENT, () => {
    const terminal = term.value
    if (!terminal) return
    terminal.options.theme = rendererTheme()
    cursor?.refresh()
  })

  // 跨 DPI 屏幕或系统缩放变化时，即使容器 CSS 尺寸不变也重新校准并同步 PTY 网格。
  watch(pixelRatio, () => {
    const terminal = term.value
    if (!terminal?.element?.isConnected) return
    syncLetterSpacing(terminal)
    onOptionsChange()
  })

  /**
   * 明暗主题共用 WebGL 加速，内置字体就绪后再创建字形图集；不随皮肤切换渲染器。
   * 字体或插件迟到时忽略过期加载，不支持 WebGL2 时保留 DOM 回退。
   */
  async function refreshRenderer(terminal: Terminal): Promise<void> {
    const revision = ++rendererRevision
    if (typeof document === 'undefined') return
    await refreshFont(terminal)
    if (
      revision !== rendererRevision ||
      term.value !== terminal ||
      !terminal.element?.isConnected
    )
      return
    if (webglAddon) {
      syncLetterSpacing(terminal)
      return
    }
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl')
      if (
        revision !== rendererRevision ||
        term.value !== terminal ||
        !terminal.element?.isConnected
      )
        return
      const addon = new WebglAddon()
      // 驱动重置或休眠唤醒后回退到 DOM，撤销 WebGL 字距补偿并重新适配。
      addon.onContextLoss(() => {
        if (webglAddon !== addon) return
        webglAddon = undefined
        stopWebglAlpha?.()
        stopWebglAlpha = undefined
        addon.dispose()
        syncLetterSpacing(terminal)
        onOptionsChange()
      })
      terminal.loadAddon(addon)
      webglAddon = addon
      stopWebglAlpha?.()
      stopWebglAlpha = bindWebglAlpha(terminal)
      syncLetterSpacing(terminal)
      onOptionsChange()
    } catch {
      /* 不支持 WebGL2 时保留 DOM 渲染。 */
    }
  }

  /**
   * 修正 addon-webgl 0.19 的透明字形混合：Alpha 使用 SRC_ALPHA 会把覆盖率平方，浅底文字因此发虚。
   * 只调整此画布的公开 GL 状态，保留原 RGB、字重和透明背景；上下文恢复后重设，销毁时移除监听。
   */
  function bindWebglAlpha(terminal: Terminal): (() => void) | undefined {
    try {
      const canvases = terminal.element?.querySelectorAll<HTMLCanvasElement>(
        '.xterm-screen > canvas'
      )
      if (!canvases) return
      for (const canvas of canvases) {
        // 链接高亮也是 Canvas，跳过已使用 2D 上下文的覆盖层，只处理实际 WebGL 画布。
        const gl = canvas.getContext('webgl2')
        if (!gl) continue
        // 保持颜色混合不变，仅让透明笔画的 Alpha 按一次覆盖率合成；兼容未来的预乘 RGB 渲染。
        const applyBlend = () => {
          if (
            gl.isContextLost() ||
            gl.getParameter(gl.BLEND_SRC_RGB) !== gl.SRC_ALPHA ||
            gl.getParameter(gl.BLEND_DST_RGB) !== gl.ONE_MINUS_SRC_ALPHA
          )
            return
          gl.blendFuncSeparate(
            gl.SRC_ALPHA,
            gl.ONE_MINUS_SRC_ALPHA,
            gl.ONE,
            gl.ONE_MINUS_SRC_ALPHA
          )
        }
        applyBlend()
        // 在 xterm 同步重建 GL 状态之后、下一帧绘制之前重新设置；最终回退或卸载时主动清理。
        return useEventListener(canvas, 'webglcontextrestored', applyBlend)
      }
    } catch {
      // 不支持读取绘制状态时保留原 WebGL 渲染，不中断终端输出。
      return
    }
  }

  /** 补偿 WebGL 的字宽向下取整，按字体与系统缩放贴近原浅色 DOM 网格；普通 fit 复用测量。 */
  function syncLetterSpacing(terminal: Terminal): void {
    if (!webglAddon) {
      terminal.options.letterSpacing = 0
      measuredFont = ''
      return
    }
    const ratio = window.devicePixelRatio || 1
    const font = `${terminal.options.fontSize}px ${terminal.options.fontFamily}`
    const key = `${ratio}:${font}`
    if (measuredFont === key) return
    fontContext ??= document.createElement('canvas').getContext('2d')
    if (!fontContext) return
    fontContext.font = font
    const width = fontContext.measureText('W').width * ratio
    if (!Number.isFinite(width) || width <= 0) return
    terminal.options.letterSpacing = Math.round(width) - Math.floor(width)
    measuredFont = key
  }

  /**
   * 首次打开或切换字体时主动加载常规与粗体字形，完成后重新测量网格。
   * xterm 会缓存字体尚未就绪时的回退字形；只刷新行内容无法修正字宽和纹理。
   * 关闭终端或切到其他字体后忽略旧加载结果，加载失败则保留系统等宽回退。
   */
  async function refreshFont(terminal: Terminal): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    // 字体下载完成后即便选项未变，也必须抛弃此前回退字体的字宽缓存。
    measuredFont = ''
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
    // 下载期间可能已 fit 并缓存回退字宽，字体到达后再次使字距缓存失效。
    measuredFont = ''
    terminal.clearTextureAtlas()
    terminal.refresh(0, terminal.rows - 1)
    onOptionsChange()
  }

  /** 原生光标交给透明层，避免 DOM/WebGL 的硬切闪烁与圆角光标叠加；文字继续由 xterm 绘制。 */
  function rendererTheme() {
    const theme = currentTerminalTheme()
    return { ...theme, cursor: '#00000000', cursorAccent: theme.foreground }
  }

  /** 输出后同步所选形状；闪烁统一由圆角光标层控制，全屏程序退出后恢复用户选项。 */
  function syncCursor(terminal: Terminal): void {
    if (terminal.options.cursorBlink) terminal.options.cursorBlink = false
    if (
      terminal.buffer.active.type === 'normal' &&
      terminal.options.cursorStyle !== settings.terminalCursor
    )
      terminal.options.cursorStyle = settings.terminalCursor as CursorStyle
    cursor?.refresh()
  }

  /** 重新适配可见终端；没有可用网格时跳过 PTY 尺寸同步。 */
  function fit(): boolean {
    const terminal = term.value
    if (
      !terminal?.element?.clientWidth ||
      !terminal.element.clientHeight ||
      !fitAddon
    )
      return false
    syncLetterSpacing(terminal)
    fitAddon.fit()
    return true
  }

  /** 创建终端并挂到容器上，立即按容器尺寸 fit 一次。 */
  function open(container: HTMLElement): Terminal {
    const terminal = new Terminal({
      fontFamily: terminalFontFamily(),
      fontSize: settingNumber('terminalFontSize', 13),
      fontWeight: 400,
      fontWeightBold: 700,
      letterSpacing: 0,
      // 保留浅色基准行距，不再为填满面板而动态压缩行高。
      lineHeight: TERMINAL_LINE_HEIGHT,
      cursorStyle: settings.terminalCursor as CursorStyle,
      cursorBlink: false,
      cursorWidth: 2,
      // 失焦状态由统一光标层绘制，保留用户所选形状。
      cursorInactiveStyle: 'none',
      // 回滚缓冲给足：排查日志时经常要往回翻很多屏
      scrollback: settingNumber('terminalScrollback', 5000),
      theme: rendererTheme(),
      // 程序自带的浅灰、白色和真彩色在浅色皮肤下也应保持可读。
      minimumContrastRatio: 4.5,
      allowTransparency: true,
      // 让 xterm 自己吞掉 Ctrl+C 之类的组合键交给远端，而不是被浏览器截走
      macOptionIsMeta: true,
      // Unicode 11 宽度表与搜索高亮装饰都属于 proposed API。
      allowProposedApi: true,
    })
    // xterm 6 的 DECSCUSR 会优先于公开 options。统一由 options 管理光标，
    // 普通 Shell 遵循用户外观；Vim 等全屏程序仍可切换形状，闪烁始终遵循用户开关。
    cursorDisposables.push(
      terminal.parser.registerCsiHandler(
        { intermediates: ' ', final: 'q' },
        params => {
          const style = params[0] ?? 0
          if (typeof style !== 'number' || style < 0 || style > 6) return false
          terminal.options.cursorStyle =
            terminal.buffer.active.type === 'alternate' && style > 0
              ? style <= 2
                ? 'block'
                : style <= 4
                  ? 'underline'
                  : 'bar'
              : (settings.terminalCursor as CursorStyle)
          syncCursor(terminal)
          return true
        }
      ),
      terminal.onWriteParsed(() => syncCursor(terminal))
    )
    const addon = new FitAddon()
    terminal.loadAddon(addon)
    // 默认的 Unicode 6 宽度表会把大部分 emoji 当成单宽，光标与后续字符随之错位。
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    loadWebLinks(terminal)
    terminal.open(container)
    addon.fit()
    cursor = createTerminalCursor(terminal, () => settings.terminalCursorBlink)

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
    fitAddon = addon
    void refreshRenderer(terminal)
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
      terminal.options.cursorBlink = false
      terminal.options.scrollback = settingNumber('terminalScrollback', 5000)
      terminal.options.theme = rendererTheme()
      cursor?.refresh()
      onOptionsChange()
      void refreshRenderer(terminal)
    }
  )

  return { term, fit, open, stopSettingsWatch, writeOutput, resetOutput }
}
