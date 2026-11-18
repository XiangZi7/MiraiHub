import type { ITheme } from '@xterm/xterm'
import { rgba } from '@/utils/color'

/**
 * xterm.js 配色。
 *
 * SSH、本地终端和回放共用 Geist Terminal 色板。允许皮肤覆盖的颜色
 * 从 CSS 令牌解析为具体色值，供 xterm 绘制到 canvas。
 */
const DARK_TERMINAL_THEME: ITheme = {
  cursorAccent: '#000000',
  selectionBackground: '#2e2e2e',
  selectionForeground: '#ededed',

  black: '#1a1a1a',
  red: '#e5484d',
  yellow: '#f1a10d',
  magenta: '#bf7af0',
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

/**
 * 浅色底的 ANSI 配色。
 *
 * Vercel Light 原始配色；bright 色在浅色模式加深而非提亮。
 * 深浅模式共用同一套语义色角色，避免本地终端与 SSH 终端各自维护色板。
 */
const LIGHT_TERMINAL_THEME: ITheme = {
  ...DARK_TERMINAL_THEME,
  cursorAccent: '#fbfbfa',
  black: '#24292f',
  red: '#cf2f36',
  yellow: '#8a5300',
  magenta: '#7e3ab8',
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

/** 按深浅模式选择色板，读取皮肤可覆盖的颜色，并保留底色 RGB 用于对比度计算。 */
export function currentTerminalTheme(): ITheme {
  const light = document.documentElement.dataset.skinScheme === 'light'
  return {
    ...(light ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME),
    background: rgba('var(--color-terminal)', 0),
    foreground: rgba('var(--color-term-fg)', 1),
    cursor: rgba('var(--color-accent)', 1),
    green: rgba('var(--color-term-green)', 1),
    blue: rgba('var(--color-term-blue)', 1),
    cyan: rgba('var(--color-term-cyan)', 1),
    selectionInactiveBackground: light ? '#e9edf2' : '#1a1a1a',
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
