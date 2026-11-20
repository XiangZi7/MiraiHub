import type { SettingOption } from '@/types/settings'

interface FontOption extends SettingOption {
  /** 与本地 @font-face 注册名称一致的字体回退顺序。 */
  fontFamily: string
}

export const DEFAULT_UI_FONT = 'inter'
export const DEFAULT_TERMINAL_FONT = 'jetbrains-mono'

const SYSTEM_UI_FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const MONOSPACED_FONT_OPTIONS: readonly FontOption[] = [
  {
    value: 'jetbrains-mono',
    label: 'JetBrains Mono',
    description: '内置等宽字体',
    fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
  },
  {
    value: 'cascadia-code',
    label: 'Cascadia Code',
    description: '内置等宽字体',
    fontFamily:
      '"Cascadia Code", "JetBrains Mono Variable", ui-monospace, monospace',
  },
  {
    value: 'consolas',
    label: 'Consolas',
    description: '系统字体，未安装时回退到内置等宽字体',
    fontFamily: 'Consolas, "JetBrains Mono Variable", ui-monospace, monospace',
  },
]

/** 界面字体与终端字体分开保存，切换界面不会改变终端或代码编辑器。 */
export const UI_FONT_OPTIONS: readonly FontOption[] = [
  {
    value: DEFAULT_UI_FONT,
    label: 'Inter',
    fontFamily: `"Inter", ${SYSTEM_UI_FONT_FAMILY}`,
  },
  {
    value: 'system',
    label: '系统字体',
    fontFamily: SYSTEM_UI_FONT_FAMILY,
  },
  {
    value: 'hanyi',
    label: '汉仪正圆 55简',
    description: '内置中文字体',
    fontFamily: `"Hanyi", "Inter", ${SYSTEM_UI_FONT_FAMILY}`,
  },
  ...MONOSPACED_FONT_OPTIONS,
]

/** 汉仪正圆并非等宽字体；终端仅用它渲染中文，英文继续使用 JetBrains Mono。 */
export const TERMINAL_FONT_OPTIONS: readonly FontOption[] = [
  ...MONOSPACED_FONT_OPTIONS,
  {
    value: 'hanyi',
    label: '汉仪正圆 55简（中文）',
    description: '中文使用汉仪，英文保留等宽排版',
    fontFamily: '"JetBrains Mono Variable", "Hanyi", ui-monospace, monospace',
  },
]
