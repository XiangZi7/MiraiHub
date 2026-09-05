import { DEFAULT_SETTINGS, type SettingsValues } from '@/types/settings'

export type SkinSettings = Pick<
  SettingsValues,
  | 'skinTheme'
  | 'skinBase'
  | 'skinLibrary'
  | 'skinStyle'
  | 'skinCustomCss'
  | 'skinBackground'
  | 'skinBackgroundImage'
  | 'skinBackgroundName'
  | 'skinBackgroundOpacity'
  | 'skinBackgroundBlur'
  | 'skinBackgroundFit'
  | 'skinBackgroundPosition'
>

export const MAX_BACKGROUND_DATA_LENGTH = 2_000_000
export const MAX_CUSTOM_CSS_LENGTH = 100_000

export type SkinAppearance = Omit<SkinSettings, 'skinTheme' | 'skinLibrary'>
export interface CustomSkin {
  id: string
  name: string
  values: SkinAppearance
}

export function skinPreset(base = 'default'): SkinAppearance {
  return {
    skinBase: base === 'kuriyama-mirai' ? base : 'default',
    skinStyle: 'builtin',
    skinCustomCss: '',
    skinBackground: 'theme',
    skinBackgroundImage: '',
    skinBackgroundName: '',
    skinBackgroundOpacity: DEFAULT_SETTINGS.skinBackgroundOpacity,
    skinBackgroundBlur: '0',
    skinBackgroundFit: 'cover',
    skinBackgroundPosition: 'center',
  }
}

/** Image data belongs to its card only, never duplicated in the active settings. */
export function readSkinLibrary(raw: string): CustomSkin[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const ids = new Set<string>()
    return parsed.flatMap(item => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        !/^custom-[\w-]+$/.test(item.id) ||
        ids.has(item.id) ||
        typeof item.name !== 'string' ||
        !item.values ||
        typeof item.values !== 'object'
      )
        return []
      ids.add(item.id)
      const values = skinPreset()
      for (const key of Object.keys(values) as (keyof SkinAppearance)[]) {
        if (typeof item.values[key] === 'string') values[key] = item.values[key]
      }
      return [
        {
          id: item.id,
          name: item.name.slice(0, 48),
          values: normalizeAppearance(values),
        },
      ]
    })
  } catch {
    return []
  }
}

export function resolveSkinSettings(settings: SkinSettings): SkinSettings {
  const custom = readSkinLibrary(settings.skinLibrary).find(
    item => item.id === settings.skinTheme
  )
  return custom
    ? { ...settings, ...custom.values }
    : {
        ...settings,
        skinBase:
          settings.skinTheme === 'kuriyama-mirai'
            ? 'kuriyama-mirai'
            : 'default',
      }
}

export function createCustomSkin(
  settings: SkinSettings,
  patch: Partial<SkinAppearance> = {},
  name = '我的皮肤'
): CustomSkin {
  const current = resolveSkinSettings(settings)
  const values = skinPreset(current.skinBase)
  for (const key of Object.keys(values) as (keyof SkinAppearance)[])
    values[key] = current[key]
  return {
    id: `custom-${crypto.randomUUID()}`,
    name: name.slice(0, 48),
    values: normalizeAppearance({ ...values, ...patch }),
  }
}

/** Only local, decoded raster images are persisted as wallpapers. */
export function isBackgroundImage(value: string): boolean {
  return (
    value.length <= MAX_BACKGROUND_DATA_LENGTH &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

function normalizeAppearance<T extends SkinAppearance>(settings: T): T {
  const normalized = { ...settings }
  if (!['default', 'kuriyama-mirai'].includes(normalized.skinBase))
    normalized.skinBase = 'default'
  if (!['builtin', 'default', 'custom'].includes(normalized.skinStyle))
    normalized.skinStyle = 'builtin'
  if (!['theme', 'custom', 'none'].includes(normalized.skinBackground))
    normalized.skinBackground = 'theme'
  if (!isBackgroundImage(normalized.skinBackgroundImage)) {
    normalized.skinBackgroundImage = ''
    normalized.skinBackgroundName = ''
    if (normalized.skinBackground === 'custom')
      normalized.skinBackground = 'theme'
  }
  const opacity = Number(normalized.skinBackgroundOpacity)
  normalized.skinBackgroundOpacity = String(
    normalized.skinBackgroundOpacity.trim() && Number.isFinite(opacity)
      ? Math.max(0, Math.min(100, opacity))
      : 100
  )
  normalized.skinCustomCss = normalized.skinCustomCss.slice(
    0,
    MAX_CUSTOM_CSS_LENGTH
  )
  const blur = Number(normalized.skinBackgroundBlur)
  normalized.skinBackgroundBlur = String(
    Number.isFinite(blur) ? Math.max(0, Math.min(20, blur)) : 0
  )
  if (!['cover', 'contain'].includes(normalized.skinBackgroundFit))
    normalized.skinBackgroundFit = 'cover'
  if (
    !['center', 'top', 'bottom', 'left', 'right'].includes(
      normalized.skinBackgroundPosition
    )
  )
    normalized.skinBackgroundPosition = 'center'
  return normalized
}

export function normalizeSkinSettings<T extends SkinSettings>(settings: T): T {
  const normalized = normalizeAppearance(settings)
  const library = readSkinLibrary(normalized.skinLibrary).map(item => ({
    ...item,
    name: item.name.trim() || '自定义皮肤',
  }))
  normalized.skinLibrary = JSON.stringify(library)
  if (
    !['default', 'kuriyama-mirai'].includes(normalized.skinTheme) &&
    !library.some(item => item.id === normalized.skinTheme)
  )
    normalized.skinTheme = 'default'
  return normalized
}

export function usesMiraiStyle(settings: SkinSettings): boolean {
  const resolved = resolveSkinSettings(settings)
  return (
    resolved.skinBase === 'kuriyama-mirai' && resolved.skinStyle !== 'default'
  )
}

/** Re-encode once on upload; keep settings comfortably below localStorage quota. */
export async function readBackgroundImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('请选择 PNG、JPG 或 WebP 图片')
  if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MB')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('图片内容无法读取')
    const scale = Math.min(
      1,
      2560 / Math.max(image.naturalWidth, image.naturalHeight)
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法处理图片，请重试')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.9, 0.78, 0.6]) {
      const result = canvas.toDataURL('image/webp', quality)
      if (isBackgroundImage(result)) return result
    }
    throw new Error('图片压缩后仍然过大，请选择尺寸更小的图片')
  } finally {
    URL.revokeObjectURL(url)
  }
}
