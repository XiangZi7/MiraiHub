import { shallowReactive } from 'vue'
import miraiBackground from '@/assets/skins/kuriyama-mirai.png'
import miraiCss from '@/assets/styles/skins/kuriyama-mirai.css?raw'
import {
  normalizeSkinSettings,
  resolveSkinSettings,
  usesMiraiStyle,
  type SkinSettings,
} from './skin'

export { miraiBackground, miraiCss }
export const SKIN_CHANGE_EVENT = 'miraihub:skin-applied'
export const skinRuntime = shallowReactive({
  background: '',
  opacity: 1,
  blur: 0,
  fit: 'cover',
  position: 'center',
})
let previousSignature = ''
let previousAppearance = ''
let revision = 0
let transition: { skipTransition: () => void } | undefined
let cleanupTimer: ReturnType<typeof setTimeout> | undefined

export function skinBackground(settings: SkinSettings): string {
  settings = resolveSkinSettings(settings)
  if (settings.skinBackground === 'none') return ''
  if (settings.skinBackground === 'custom') return settings.skinBackgroundImage
  return settings.skinBase === 'kuriyama-mirai' ? miraiBackground : ''
}

export function skinCss(settings: SkinSettings, includeCustom = true): string {
  settings = resolveSkinSettings(settings)
  return [
    usesMiraiStyle(settings) ? miraiCss : '',
    includeCustom && settings.skinStyle === 'custom'
      ? settings.skinCustomCss
      : '',
  ].join('\n')
}

/** Each WebView applies its own theme. Settings can preview without saving. */
export function applySkin(
  values: SkinSettings,
  options: { animate?: boolean; includeCustom?: boolean } = {}
): void {
  const settings = resolveSkinSettings(normalizeSkinSettings(values))
  const css = skinCss(settings, options.includeCustom !== false)
  const background = skinBackground(settings)
  const signature = JSON.stringify([
    settings.skinTheme,
    settings.skinStyle,
    css,
    background,
    settings.skinBackgroundOpacity,
    settings.skinBackgroundBlur,
    settings.skinBackgroundFit,
    settings.skinBackgroundPosition,
  ])
  if (signature === previousSignature) return
  const initialized = Boolean(previousSignature)
  const appearance = JSON.stringify([css, background])
  const appearanceChanged = appearance !== previousAppearance
  previousSignature = signature
  previousAppearance = appearance
  const currentRevision = ++revision
  const root = document.documentElement
  const reduced =
    root.classList.contains('reduce-motion') ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  const apply = () => {
    if (currentRevision !== revision) return
    let style = document.getElementById(
      'miraihub-skin'
    ) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'miraihub-skin'
      document.head.append(style)
    }
    const nextStyle = usesMiraiStyle(settings) ? 'mirai' : 'default'
    const colorsChanged =
      style.textContent !== css ||
      root.dataset.skin !== settings.skinTheme ||
      root.dataset.skinStyle !== nextStyle
    if (style.textContent !== css) style.textContent = css
    root.dataset.skin = settings.skinTheme
    root.dataset.skinStyle = nextStyle
    skinRuntime.background = background
    skinRuntime.opacity = Number(settings.skinBackgroundOpacity) / 100
    skinRuntime.blur = Number(settings.skinBackgroundBlur)
    skinRuntime.fit = settings.skinBackgroundFit
    skinRuntime.position = settings.skinBackgroundPosition
    if (colorsChanged) window.dispatchEvent(new Event(SKIN_CHANGE_EVENT))
  }
  transition?.skipTransition()
  transition = undefined
  if (
    !initialized ||
    !appearanceChanged ||
    reduced ||
    options.animate === false
  ) {
    apply()
    return
  }
  // View Transitions also cross-fade canvas terminals. Older WebViews use CSS.
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => {
      skipTransition: () => void
      ready: Promise<void>
    }
  }
  if (doc.startViewTransition) {
    const next = doc.startViewTransition(apply)
    transition = next
    void next.ready.catch(() => {})
  } else {
    root.classList.add('skin-changing')
    apply()
    clearTimeout(cleanupTimer)
    cleanupTimer = setTimeout(() => root.classList.remove('skin-changing'), 420)
  }
}
