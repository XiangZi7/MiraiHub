import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { IS_TAURI } from '@/utils/window'
import { toast } from '@/composables/useToast'

/** 同步原生窗口或浏览器全屏状态，支持按钮、F11 和 Esc。 */
export function useFullscreen() {
  const fullscreen = shallowRef(false)
  let disposed = false
  let busy = false
  let stop: (() => void) | undefined
  async function sync(): Promise<void> {
    fullscreen.value = IS_TAURI
      ? await getCurrentWindow().isFullscreen()
      : Boolean(document.fullscreenElement)
  }
  async function toggle(exit = false): Promise<void> {
    if (busy) return
    busy = true
    try {
      await sync()
      const target = exit ? false : !fullscreen.value
      if (IS_TAURI) await getCurrentWindow().setFullscreen(target)
      else if (target) await document.documentElement.requestFullscreen()
      else if (document.fullscreenElement) await document.exitFullscreen()
      await sync()
    } catch (error) {
      toast.error({ title: '切换全屏失败', description: String(error) })
    } finally {
      busy = false
    }
  }
  function handleKey(event: KeyboardEvent): void {
    if (event.key === 'F11' || (event.key === 'Escape' && fullscreen.value)) {
      event.preventDefault()
      void toggle(event.key === 'Escape')
    }
  }
  const syncBrowser = () => {
    void sync()
  }
  onMounted(() => {
    window.addEventListener('keydown', handleKey)
    document.addEventListener('fullscreenchange', syncBrowser)
    void sync().catch(() => {})
    if (IS_TAURI) {
      void getCurrentWindow()
        .onResized(() => {
          void sync().catch(() => {})
        })
        .then((unlisten) => {
          if (disposed) unlisten()
          else stop = unlisten
        })
        .catch(() => {})
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    stop?.()
    window.removeEventListener('keydown', handleKey)
    document.removeEventListener('fullscreenchange', syncBrowser)
  })
  return { fullscreen, toggleFullscreen: () => toggle() }
}
