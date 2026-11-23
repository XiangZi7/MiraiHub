import type { SettingOption } from '@/types/settings'

interface FontOption extends SettingOption {
  /** 与本地 @font-face 注册名称一致的字体回退顺序。 */
  fontFamily: string
}

/** 新安装与缺失/无效设置默认使用截图中的英文等宽、汉仪中文组合。 */
export const DEFAULT_UI_FONT = 'jetbrains-mono'
export const DEFAULT_TERMINAL_FONT = 'jetbrains-mono'

const SYSTEM_UI_FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

// 只列出拉丁等宽字体及其内置回退；界面和终端按各自需求补充中文与通用字体。
const MONOSPACED_FONT_OPTIONS: readonly FontOption[] = [
  {
    value: 'jetbrains-mono',
    label: 'JetBrains Mono',
    description: '内置等宽字体',
    fontFamily: '"JetBrains Mono Variable"',
  },
  {
    value: 'cascadia-code',
    label: 'Cascadia Code',
    description: '内置等宽字体',
    fontFamily: '"Cascadia Code", "JetBrains Mono Variable"',
  },
  {
    value: 'consolas',
    label: 'Consolas',
    description: '系统字体，未安装时回退到内置等宽字体',
    fontFamily: 'Consolas, "JetBrains Mono Variable"',
  },
]

/** 界面字体与终端字体分开保存，切换界面不会改变终端或代码编辑器。 */
export const UI_FONT_OPTIONS: readonly FontOption[] = [
  {
    value: 'inter',
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
  // 这些字体没有中文字形：汉仪必须排在通用 monospace 前面，中文才能实际使用它。
  ...MONOSPACED_FONT_OPTIONS.map(option => ({
    ...option,
    description: '英文等宽，中文使用汉仪',
    fontFamily: `${option.fontFamily}, "Hanyi", ui-monospace, monospace`,
  })),
]

/** 汉仪正圆并非等宽字体；终端仅用它渲染中文，英文继续使用 JetBrains Mono。 */
export const TERMINAL_FONT_OPTIONS: readonly FontOption[] = [
  ...MONOSPACED_FONT_OPTIONS.map(option => ({
    ...option,
    fontFamily: `${option.fontFamily}, ui-monospace, monospace`,
  })),
  {
    value: 'hanyi',
    label: '汉仪正圆 55简（中文）',
    description: '中文使用汉仪，英文保留等宽排版',
    fontFamily: '"JetBrains Mono Variable", "Hanyi", ui-monospace, monospace',
  },
]
