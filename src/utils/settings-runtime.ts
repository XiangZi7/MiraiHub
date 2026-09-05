import { watch } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { pinia } from '@/stores'
import { useSettingsStore } from '@/stores/settings'
import { normalizeUiScale } from '@/utils/ui-scale'
import { IS_TAURI } from '@/utils/window'
import { applySkin } from '@/utils/skin-runtime'

let started = false

/**
 * 把纯前端就能生效的设置应用到当前文档：紧凑布局、减少动画、纯色材质、界面缩放。
 *
 * 每个 WebView 窗口都各自调用一次，这样设置窗口、连接窗口也跟着变；
 * 托盘、材质、自启动这类只能由主窗口触发一次的动作放在 WorkspaceLayout 里。
 */
export function startSettingsRuntime(): void {
  if (started) return
  started = true
  const settings = useSettingsStore(pinia).values

  watch(
    () =>
      [
        settings.compactLayout,
        settings.reduceMotion,
        settings.windowMaterial,
      ] as const,
    ([compact, reduceMotion, material]) => {
      const root = document.documentElement
      root.classList.toggle('compact', compact)
      root.classList.toggle('reduce-motion', reduceMotion)
      root.classList.toggle('material-solid', material === 'solid')
    },
    { immediate: true }
  )

  watch(
    () => [
      settings.skinTheme,
      settings.skinLibrary,
      settings.skinBase,
      settings.skinStyle,
      settings.skinCustomCss,
      settings.skinBackground,
      settings.skinBackgroundImage,
      settings.skinBackgroundOpacity,
      settings.skinBackgroundBlur,
      settings.skinBackgroundFit,
      settings.skinBackgroundPosition,
    ],
    () => applySkin(settings),
    { immediate: true }
  )

  watch(
    () => settings.uiScale,
    scale => void applyZoom(scale),
    { immediate: true }
  )
}

export async function applyZoom(value: string): Promise<void> {
  const factor = normalizeUiScale(value) / 100

  if (IS_TAURI) {
    try {
      await getCurrentWebview().setZoom(factor)
    } catch (error) {
      console.warn('应用界面缩放失败：', error)
    }
    return
  }

  // 浏览器预览没有原生缩放，退回 CSS zoom
  const style = document.documentElement.style as CSSStyleDeclaration & {
    zoom: string
  }
  style.zoom = factor === 1 ? '' : String(factor)
  style.setProperty('--preview-zoom', String(factor))
}
