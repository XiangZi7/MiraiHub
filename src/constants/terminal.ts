import type { ITheme } from '@xterm/xterm'
import { parseColor, rgba } from '@/utils/color'

/**
 * xterm.js 配色。
 *
 * 值写成十六进制而不是引用 main.css 的 --color-term-* 变量：
 * xterm 把颜色取到 canvas 里做像素合成，只认能直接解析的具体色值，
 * 拿不到 CSS 变量，也不接受带透明度的 oklch。
 * 这里的色相与设计令牌保持一致，改令牌时需同步这份。
 *
 * background 用全透明：终端容器自身已铺了 bg-terminal（半透明底色，
 * 透出系统 acrylic），xterm 再涂一层不透明底会把这个效果盖掉。
 */
export const TERMINAL_THEME: ITheme = {
  background: '#00000000',
  foreground: '#d6d6de',
  cursor: '#b39ddb',
  cursorAccent: '#0d0d10',
  selectionBackground: '#ffffff26',

  black: '#2a2a31',
  red: '#de7a72',
  green: '#8cb369',
  yellow: '#d9b26a',
  blue: '#82a8d8',
  magenta: '#b39ddb',
  cyan: '#7bb5ad',
  white: '#c9c9d1',

  brightBlack: '#62626e',
  brightRed: '#ea938c',
  brightGreen: '#a3cc8a',
  brightYellow: '#eac887',
  brightBlue: '#9dbde6',
  brightMagenta: '#c6b3e6',
  brightCyan: '#97ccc4',
  brightWhite: '#f2f2f5',
}

/**
 * 浅色底的 ANSI 配色。
 *
 * 色相跟着 main.css 的浅色令牌走冷调（紫蓝一侧），亮度压在 35%–50%：
 * 深色那套的高亮度值放在白底上基本读不出来。
 * foreground / cursor / green / blue / cyan 会被 `currentTerminalTheme` 用
 * CSS 令牌覆盖，所以自带配色的皮肤仍能把自己的色相带回来。
 */
const LIGHT_TERMINAL_THEME: ITheme = {
  ...TERMINAL_THEME,
  foreground: '#3b3744',
  cursor: '#6d3fc4',
  cursorAccent: '#fbfaff',
  black: '#413d4a',
  red: '#b03030',
  green: '#2f7350',
  yellow: '#8a6514',
  blue: '#2f5fa8',
  magenta: '#8c3f99',
  cyan: '#1f6f80',
  white: '#8a8696',

  brightBlack: '#6f6a7c',
  brightRed: '#c23a3a',
  brightGreen: '#357f59',
  brightYellow: '#96701c',
  brightBlue: '#3a6cb8',
  brightMagenta: '#9a48a8',
  brightCyan: '#257a8c',
  brightWhite: '#413d4a',
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

/** 将皮肤令牌转成 xterm 可解析的颜色，并为文字对比度计算保留真实底色。 */
export function currentTerminalTheme(): ITheme {
  const light = document.documentElement.dataset.skinScheme === 'light'
  return {
    ...(light ? LIGHT_TERMINAL_THEME : TERMINAL_THEME),
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
