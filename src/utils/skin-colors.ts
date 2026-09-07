/** Only these color tokens can be changed by the visual editor. */
export const SKIN_COLOR_FIELDS = [
  { key: 'accent', label: '强调色', dark: '#9864db', light: '#c93478' },
  { key: 'window', label: '窗口背景', dark: '#0f0e15', light: '#fff7fa' },
  { key: 'panel', label: '侧栏背景', dark: '#14131a', light: '#fff8fb' },
  { key: 'card', label: '卡片背景', dark: '#25232d', light: '#fff8fb' },
  { key: 'text', label: '文字颜色', dark: '#ebe9ed', light: '#593a49' },
  { key: 'terminal', label: '终端背景', dark: '#050408', light: '#fff9fb' },
] as const

export type SkinColorKey = (typeof SKIN_COLOR_FIELDS)[number]['key']
export type SkinColors = Partial<Record<SkinColorKey, string>>

export function readSkinColors(raw: string): SkinColors {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {}
    return Object.fromEntries(
      SKIN_COLOR_FIELDS.flatMap(({ key }) => {
        const value = (parsed as Record<string, unknown>)[key]
        return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
          ? [[key, value.toLowerCase()]]
          : []
      })
    )
  } catch {
    return {}
  }
}

/** Related shades are derived so buttons, text and terminals stay consistent. */
export function skinColorsCss(raw: string): string {
  const colors = readSkinColors(raw)
  const declarations: string[] = []
  const set = (token: string, value: string) =>
    declarations.push(`--${token}: ${value};`)
  for (const [key, color] of Object.entries(colors)) {
    if (key === 'accent') {
      set('color-violet', color)
      set('color-accent', color)
      set('color-accent-deep', `color-mix(in srgb, ${color} 85%, black)`)
    } else if (key === 'text') {
      set('color-txt', color)
      set('color-term-fg', color)
      for (const [level, alpha] of [
        [2, 78],
        [3, 62],
        [4, 48],
      ])
        set(
          `color-txt-${level}`,
          `color-mix(in srgb, ${color} ${alpha}%, transparent)`
        )
      set('color-term-dim', 'var(--color-txt-3)')
      set('color-line', `color-mix(in srgb, ${color} 12%, transparent)`)
      set('color-line-soft', `color-mix(in srgb, ${color} 7%, transparent)`)
      set('color-line-strong', `color-mix(in srgb, ${color} 24%, transparent)`)
    } else {
      set(`color-${key}`, color)
      if (key === 'window') set('color-canvas', color)
      if (key === 'card') {
        set('color-pane', color)
        set(
          'color-raised',
          `color-mix(in srgb, ${color} 88%, var(--color-txt))`
        )
        set('color-hover', `color-mix(in srgb, ${color} 80%, var(--color-txt))`)
      }
    }
  }
  return declarations.length ? `:root {\n${declarations.join('\n')}\n}` : ''
}
