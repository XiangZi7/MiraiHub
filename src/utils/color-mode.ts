/**
 * 外观模式（浅色 / 深色 / 跟随系统）。
 *
 * 模式只是"想要哪种明暗"的用户偏好；真正生效的明暗由 skin-runtime 写进
 * `document.documentElement.dataset.skinScheme`，CSS 令牌与终端配色都读那一处。
 * 皮肤自带配色时它的明暗优先，模式开关只作用于项目默认样式 —— 见 `usesLightScheme`。
 */

export type ColorMode = 'system' | 'light' | 'dark'
export type ColorScheme = 'light' | 'dark'

/** 选项顺序即设置界面的展示顺序：默认值排在最前。 */
export const COLOR_MODES = ['dark', 'light', 'system'] as const

/** 非法值回落到深色，也就是项目一直以来的外观。 */
export function normalizeColorMode(value: unknown): ColorMode {
  return (COLOR_MODES as readonly string[]).includes(value as string)
    ? (value as ColorMode)
    : 'dark'
}

/**
 * 系统当前的明暗。
 *
 * 查浅色而不是查深色：`matchMedia` 在不支持该特性的环境下一律返回 false，
 * 问"是不是浅色"得到 false 正好落在深色这个默认值上。
 */
export function systemColorScheme(): ColorScheme {
  try {
    return matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveColorScheme(mode: unknown): ColorScheme {
  const normalized = normalizeColorMode(mode)
  return normalized === 'system' ? systemColorScheme() : normalized
}

/**
 * 订阅系统明暗变化。返回取消订阅函数。
 *
 * 旧 WebView 只有 `addListener`，测试里的 matchMedia 桩两个都没有；
 * 拿不到监听能力时返回一个空的取消函数，调用方不需要分支处理。
 */
export function watchSystemColorScheme(
  listener: (scheme: ColorScheme) => void
): () => void {
  let query: MediaQueryList
  try {
    query = matchMedia('(prefers-color-scheme: light)')
  } catch {
    return () => {}
  }
  const handle = (): void => listener(systemColorScheme())
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handle)
    return () => query.removeEventListener('change', handle)
  }
  // Safari < 14 / 老 WebView2
  const legacy = query as MediaQueryList & {
    addListener?: (callback: () => void) => void
    removeListener?: (callback: () => void) => void
  }
  if (typeof legacy.addListener === 'function') {
    legacy.addListener(handle)
    return () => legacy.removeListener?.(handle)
  }
  return () => {}
}
