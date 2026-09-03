import type { ITheme } from '@xterm/xterm'

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
