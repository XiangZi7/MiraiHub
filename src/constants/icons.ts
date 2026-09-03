import type { IconifyJSON } from '@iconify/vue'

/**
 * 项目自绘图标集，前缀 mirai:。
 *
 * 只收两类 lucide 给不了的图标：
 * 1. 实心文件 / 文件夹 —— lucide 全是线性描边，UI 稿里这两个是实心的；
 * 2. Windows 窗口控制符号 —— 系统按钮要求直角细线，lucide 的圆角描边不对味。
 *
 * 统一 24×24 viewBox，一律用 currentColor 以便跟随文字色。
 */
export const MIRAI_ICONS: IconifyJSON = {
  prefix: 'mirai',
  width: 24,
  height: 24,
  icons: {
    /** 实心文件夹：左上一段 tab，主体从 y=6.8 起 */
    'folder': {
      body: '<path fill="currentColor" d="M4 4h4.7a2 2 0 0 1 1.6.8l1.2 1.6a1 1 0 0 0 .8.4H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
    },

    /** 实心文件：主体 + 半透明折角，靠调用方的文字色区分类型 */
    'file': {
      body:
        '<path fill="currentColor" d="M6 2h7v5a2 2 0 0 0 2 2h5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/>'
        + '<path fill="currentColor" opacity=".5" d="M14 2.3 19.7 8H15.5A1.5 1.5 0 0 1 14 6.5V2.3Z"/>',
    },

    /** 窗口最小化：一条水平细线 */
    'win-min': {
      body: '<path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="square" d="M6.5 12h11"/>',
    },

    /** 窗口最大化：直角方框 */
    'win-max': {
      body: '<path fill="none" stroke="currentColor" stroke-width="1.1" d="M6.75 6.75h10.5v10.5H6.75z"/>',
    },

    /** 窗口还原：两层错位方框 */
    'win-restore': {
      body:
        '<path fill="none" stroke="currentColor" stroke-width="1.1" d="M6.5 9.5h8v8h-8z"/>'
        + '<path fill="none" stroke="currentColor" stroke-width="1.1" d="M9.5 9.5v-3h8v8h-3"/>',
    },

    /** 窗口关闭：直角叉 */
    'win-close': {
      body: '<path fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="square" d="m7 7 10 10M17 7 7 17"/>',
    },
  },
}
