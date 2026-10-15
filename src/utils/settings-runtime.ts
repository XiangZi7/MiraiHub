import { watch } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { pinia } from '@/stores'
import { useSettingsStore } from '@/stores/settings'
import { normalizeUiScale } from '@/utils/ui-scale'
import { IS_TAURI } from '@/utils/window'
import { applySkin } from '@/utils/skin-runtime'
import { loadSkinRegistry, skinRegistry } from '@/utils/skin-registry'
import { loadSettings } from '@/api/settings'
import { subscribeSkinPreview } from '@/api/skin-preview'
import type { AppearanceSettings, SkinSettings } from '@/utils/skin'
import { watchSystemColorScheme } from '@/utils/color-mode'
import { applyWindowBackgroundOpacity } from '@/utils/window-appearance'

let started = false

/**
 * 把纯前端就能生效的设置应用到当前文档：紧凑布局、减少动画、纯色材质、界面缩放。
 *
 * 每个 WebView 窗口都各自调用一次，这样设置窗口、连接窗口也跟着变；
 * 托盘、材质、自启动这类只能由主窗口触发一次的动作放在 WorkspaceLayout 里。
 */
export function startSettingsRuntime(
  options: { skinPreview?: boolean } = {}
): void {
  if (started) return
  started = true
  const settings = useSettingsStore(pinia).values
  let preview: SkinSettings | null = null
  /**
   * 设置窗口预览的是皮肤，不是外观模式；预览值里没有 colorMode，
   * 补上用户当前的，免得预览期间整个窗口的明暗跟着跳。
   */
  const previewWithMode = (): AppearanceSettings =>
    preview ? { ...preview, colorMode: settings.colorMode } : settings
  if (options.skinPreview) {
    const stop = subscribeSkinPreview(skin => {
      preview = skin
      // Read durable values on rollback, even if the save notification is still in flight.
      applySkin(skin ? previewWithMode() : loadSettings())
    })
    import.meta.hot?.dispose(stop)
  }
  // 皮肤文件在安装目录里，读完再应用一次；在此之前先按默认样式渲染。
  void loadSkinRegistry()

  watch(
    () =>
      [
        settings.compactLayout,
        settings.reduceMotion,
        settings.windowMaterial,
        settings.windowBackgroundOpacity,
      ] as const,
    ([compact, reduceMotion, material, backgroundOpacity]) => {
      const root = document.documentElement
      root.classList.toggle('compact', compact)
      root.classList.toggle('reduce-motion', reduceMotion)
      root.classList.toggle('material-solid', material === 'solid')
      applyWindowBackgroundOpacity(backgroundOpacity, root)
    },
    { immediate: true }
  )

  watch(
    () => [
      skinRegistry.version,
      settings.colorMode,
      settings.skinTheme,
      settings.skinLibrary,
      settings.skinBase,
      settings.skinStyle,
      settings.skinCustomCss,
      settings.skinCustomColors,
      settings.skinBackground,
      settings.skinBackgroundImage,
      settings.skinBackgroundOpacity,
      settings.skinBackgroundBlur,
      settings.skinBackgroundFit,
      settings.skinBackgroundPosition,
    ],
    () => applySkin(previewWithMode()),
    { immediate: true }
  )

  // 跟随系统时，Windows 那边切明暗不会动我们的设置，得自己听媒体查询。
  const stopSystemScheme = watchSystemColorScheme(() => {
    if (settings.colorMode === 'system') applySkin(previewWithMode())
  })
  import.meta.hot?.dispose(stopSystemScheme)

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
