import type { ITheme } from '@xterm/xterm'
import { parseColor, rgba } from '@/utils/color'

/**
 * xterm.js 配色。
 *
 * 值写成十六进制而不是引用 main.css 的 --color-term-* 变量：
 * xterm 把颜色取到 canvas 里做像素合成，只认能直接解析的具体色值，
 * 拿不到 CSS 变量，也不接受带透明度的 oklch。
 * v4 直接采用 Vercel 官方 Geist Terminal 的 Dark/Light 16 色板：
 * https://vercel.com/geist/terminal
 * 表面色需与 terminal.css 同步；光标外观继续遵循用户的主题色设置。
 *
 * background 用全透明：终端容器自身已铺了 bg-terminal（半透明底色，
 * 透出系统 acrylic），xterm 再涂一层不透明底会把这个效果盖掉。
 */
export const TERMINAL_THEME: ITheme = {
  background: '#00000000',
  foreground: '#ededed',
  cursor: '#ededed',
  cursorAccent: '#000000',
  selectionBackground: '#2e2e2e',
  selectionForeground: '#ededed',

  black: '#1a1a1a',
  red: '#e5484d',
  green: '#63c174',
  yellow: '#f1a10d',
  blue: '#52a9ff',
  magenta: '#bf7af0',
  cyan: '#0ac5b3',
  white: '#a0a0a0',

  brightBlack: '#8f8f8f',
  brightRed: '#fe7573',
  brightGreen: '#83e293',
  brightYellow: '#ffc983',
  brightBlue: '#97c9fe',
  brightMagenta: '#d7a4ff',
  brightCyan: '#4be6d3',
  brightWhite: '#ffffff',
}

/** 经典样式沿用原有 ANSI 色板，供用户随时切回。 */
const CLASSIC_TERMINAL_THEME: ITheme = {
  background: '#00000000',
  foreground: '#dededf',
  cursor: '#7ee787',
  cursorAccent: '#0d0d10',
  selectionBackground: '#ffffff26',
  black: '#2a2a30',
  red: '#ff6b62',
  green: '#7ee787',
  yellow: '#ffcb6b',
  blue: '#7cb0ff',
  magenta: '#d9a3ff',
  cyan: '#84e0e8',
  white: '#cfcfd2',
  brightBlack: '#5b5b63',
  brightRed: '#ff8a7a',
  brightGreen: '#9df0a4',
  brightYellow: '#ffd98a',
  brightBlue: '#9cc4ff',
  brightMagenta: '#e6bcff',
  brightCyan: '#a6ecf2',
  brightWhite: '#f0f0f2',
}

/**
 * 浅色底的 ANSI 配色。
 *
 * Vercel Light 原始配色；bright 色在浅色模式加深而非提亮。
 * foreground / cursor / green / blue / cyan 会被 `currentTerminalTheme` 用
 * CSS 令牌覆盖，所以自带配色的皮肤仍能把自己的色相带回来。
 */
const LIGHT_TERMINAL_THEME: ITheme = {
  ...TERMINAL_THEME,
  foreground: '#24292f',
  cursor: '#24292f',
  cursorAccent: '#fbfbfa',
  black: '#24292f',
  red: '#cf2f36',
  green: '#18703a',
  yellow: '#8a5300',
  blue: '#1a5fb4',
  magenta: '#7e3ab8',
  cyan: '#0b7268',
  white: '#4f5359',
  selectionBackground: '#dce3ec',
  selectionForeground: '#24292f',

  brightBlack: '#656a70',
  brightRed: '#a8242b',
  brightGreen: '#0f5a2c',
  brightYellow: '#6b3f00',
  brightBlue: '#124a8c',
  brightMagenta: '#622a92',
  brightCyan: '#085a52',
  brightWhite: '#171717',
}

/** 将浅色选区与实际终端底色混合，避免透明背景被 xterm 当作黑色。 */
function lightSelectionBackground(opacity: number): string {
  const background = parseColor('var(--color-terminal)')
  const accent = parseColor('var(--color-accent)')
  // xterm 会把半透明选区与 theme.background 的透明黑色混合，生成深色实底。
  // 先与浅色终端底色混合，再传入不透明色，保留 ANSI 文字颜色与透明终端背景。
  const channels = background.map((channel, index) =>
    Math.round(channel + (accent[index]! - channel) * opacity)
  )
  return `rgb(${channels.join(', ')})`
}

/** 按终端样式选择色板；经典样式跟随皮肤令牌，并为文字对比度保留真实底色。 */
export function currentTerminalTheme(style = 'classic'): ITheme {
  const light = document.documentElement.dataset.skinScheme === 'light'
  if (style === 'v4') {
    return {
      ...(light ? LIGHT_TERMINAL_THEME : TERMINAL_THEME),
      // v4 的扁平表面与色板独立于通用玻璃皮肤，避免又被全局高饱和语法色覆盖。
      background: light ? 'rgba(251, 251, 250, 0)' : 'rgba(0, 0, 0, 0)',
      selectionInactiveBackground: light ? '#e9edf2' : '#1a1a1a',
    }
  }
  return {
    ...(light ? LIGHT_TERMINAL_THEME : CLASSIC_TERMINAL_THEME),
    // 保留终端底色的 RGB、只将 alpha 设为 0：视觉仍透明，对比度不再按黑底计算。
    background: rgba('var(--color-terminal)', 0),
    foreground: rgba('var(--color-term-fg)', 1),
    cursor: rgba('var(--color-accent)', 1),
    green: rgba('var(--color-term-green)', 1),
    blue: rgba('var(--color-term-blue)', 1),
    cyan: rgba('var(--color-term-cyan)', 1),
    selectionBackground: light
      ? lightSelectionBackground(0.16)
      : rgba('var(--color-accent)', 0.24),
    selectionInactiveBackground: light
      ? lightSelectionBackground(0.1)
      : undefined,
  }
}

/** 搜索高亮装饰。xterm 要求背景色为不透明的 #RRGGBB。 */
export function terminalSearchDecorations() {
  const light = document.documentElement.dataset.skinScheme === 'light'
  return light
    ? {
        matchBackground: '#fff0bf',
        matchBorder: '#d9a520',
        matchOverviewRuler: '#d9a520',
        activeMatchBackground: '#ffd54d',
        activeMatchBorder: '#8a6514',
        activeMatchColorOverviewRuler: '#8a6514',
      }
    : {
        matchBackground: '#4a3b12',
        matchBorder: '#8a6d2a',
        matchOverviewRuler: '#ffcb6b',
        activeMatchBackground: '#8a6514',
        activeMatchBorder: '#ffcb6b',
        activeMatchColorOverviewRuler: '#ffcb6b',
      }
}
