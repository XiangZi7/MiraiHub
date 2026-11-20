import {
  DEFAULT_TERMINAL_FONT,
  DEFAULT_UI_FONT,
  TERMINAL_FONT_OPTIONS,
  UI_FONT_OPTIONS,
} from '@/constants/fonts'

/** 读取旧设置或损坏的字体标识时恢复默认界面字体，禁止把任意字符串当成 CSS。 */
export function normalizeUiFont(value: unknown): string {
  return (
    UI_FONT_OPTIONS.find(option => option.value === value)?.value ??
    DEFAULT_UI_FONT
  )
}

/** 兼容旧终端字体标识；不存在的选项统一回退到已内置的 JetBrains Mono。 */
export function normalizeTerminalFont(value: unknown): string {
  return (
    TERMINAL_FONT_OPTIONS.find(option => option.value === value)?.value ??
    DEFAULT_TERMINAL_FONT
  )
}

/** 将界面字体设置解析为已注册字体及系统中文字体的回退顺序。 */
export function uiFontFamily(value: unknown): string {
  return UI_FONT_OPTIONS.find(
    option => option.value === normalizeUiFont(value)
  )!.fontFamily
}

/** 将终端字体设置解析为等宽回退链，汉仪选项仅替换中文字体。 */
export function resolveTerminalFontFamily(value: unknown): string {
  return TERMINAL_FONT_OPTIONS.find(
    option => option.value === normalizeTerminalFont(value)
  )!.fontFamily
}

/** 在当前窗口应用保存值或草稿预览的界面字体；不覆盖终端与代码区域的等宽字体令牌。 */
export function applyUiFont(
  value: unknown,
  root: HTMLElement = document.documentElement
): void {
  root.style.setProperty('--font-sans', uiFontFamily(value))
}
