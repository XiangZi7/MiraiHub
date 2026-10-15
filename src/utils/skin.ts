import { i18n } from '@/i18n'
import { DEFAULT_SETTINGS, type SettingsValues } from '@/types/settings'
import { resolveColorScheme } from './color-mode'
import { readSkinColors } from './skin-colors'
import { builtinSkin, isBuiltinSkinId } from './skin-registry'

export type SkinSettings = Pick<
  SettingsValues,
  | 'skinTheme'
  | 'skinBase'
  | 'skinLibrary'
  | 'skinStyle'
  | 'skinCustomCss'
  | 'skinCustomColors'
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

/**
 * 皮肤设置 + 外观模式。
 *
 * `colorMode` 刻意不并进 `SkinSettings`：它是全局偏好，
 * 而 `SkinAppearance` 会被整份存进每张皮肤卡片，模式不该跟着复制进去。
 * 设为可选是给设置窗口的皮肤编辑流程留的口子 —— 那里手上只有一份草稿皮肤，
 * 缺模式时沿用文档当前的明暗即可，见 `usesLightScheme`。
 */
export type AppearanceSettings = SkinSettings &
  Partial<Pick<SettingsValues, 'colorMode'>>

/** 基础主题只能是 default 或皮肤目录里的某个 id。 */
function normalizeBase(base: string): string {
  return isBuiltinSkinId(base) ? base : 'default'
}

export function skinPreset(base = 'default'): SkinAppearance {
  return {
    skinBase: normalizeBase(base),
    skinStyle: 'builtin',
    skinCustomCss: '',
    skinCustomColors: '{}',
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

/** 泛型保留调用方多带的字段（如 colorMode），展开实现本来就不会丢它们。 */
export function resolveSkinSettings<T extends SkinSettings>(settings: T): T {
  const custom = readSkinLibrary(settings.skinLibrary).find(
    item => item.id === settings.skinTheme
  )
  return custom
    ? { ...settings, ...custom.values }
    : { ...settings, skinBase: normalizeBase(settings.skinTheme) }
}

export function createCustomSkin(
  settings: SkinSettings,
  patch: Partial<SkinAppearance> = {},
  name = i18n.global.t('我的皮肤')
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
  normalized.skinCustomColors = JSON.stringify(
    readSkinColors(settings.skinCustomColors)
  )
  normalized.skinBase = normalizeBase(normalized.skinBase)
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
    name: item.name.trim() || i18n.global.t('自定义皮肤'),
  }))
  normalized.skinLibrary = JSON.stringify(library)
  if (
    !isBuiltinSkinId(normalized.skinTheme) &&
    !library.some(item => item.id === normalized.skinTheme)
  )
    normalized.skinTheme = 'default'
  return normalized
}

/** 当前生效的是否为某套内置皮肤自带的样式（而不是项目默认深色样式）。 */
export function usesBuiltinStyle(settings: SkinSettings): boolean {
  const resolved = resolveSkinSettings(settings)
  return resolved.skinBase !== 'default' && resolved.skinStyle !== 'default'
}

/**
 * 当前皮肤是否按浅色处理：CSS 令牌、终端配色、取色器默认值都据此切换。
 *
 * 皮肤 CSS 本身就是一整套完整配色（skin.json 自报 colorScheme），强行翻转它
 * 只会让深色表面配上浅色文字；所以皮肤自带样式时听皮肤的，
 * 只有项目默认样式才由用户的外观模式决定。
 */
export function usesLightScheme(settings: AppearanceSettings): boolean {
  if (usesBuiltinStyle(settings))
    return (
      builtinSkin(resolveSkinSettings(settings).skinBase)?.colorScheme ===
      'light'
    )
  if (settings.colorMode)
    return resolveColorScheme(settings.colorMode) === 'light'
  // 编辑皮肤草稿时不带模式：沿用文档当前的明暗，取色器默认值才跟眼前看到的一致。
  return (
    typeof document !== 'undefined' &&
    document.documentElement.dataset.skinScheme === 'light'
  )
}

/** Re-encode once on upload; keep settings comfortably below localStorage quota. */
export async function readBackgroundImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error(i18n.global.t('请选择 PNG、JPG 或 WebP 图片'))
  if (file.size > 10 * 1024 * 1024)
    throw new Error(i18n.global.t('图片不能超过 10 MB'))
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error(i18n.global.t('图片内容无法读取'))
    const scale = Math.min(
      1,
      2560 / Math.max(image.naturalWidth, image.naturalHeight)
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(i18n.global.t('无法处理图片，请重试'))
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.9, 0.78, 0.6]) {
      const result = canvas.toDataURL('image/webp', quality)
      if (isBackgroundImage(result)) return result
    }
    throw new Error(i18n.global.t('图片压缩后仍然过大，请选择尺寸更小的图片'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
