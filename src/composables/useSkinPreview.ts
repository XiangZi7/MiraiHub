import { onBeforeUnmount, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import {
  createSkinPreviewSession,
  skinPreviewSnapshot,
} from '@/api/skin-preview'
import { applySkin } from '@/utils/skin-runtime'
import type { SkinSettings } from '@/utils/skin'

/** The settings window owns a preview visit; save/cancel both release its override. */
export function useSkinPreview(draft: SkinSettings, saved: SkinSettings) {
  const session = createSkinPreviewSession()
  const stop = watch(
    () => skinPreviewSnapshot(draft),
    (skin, previous) => {
      applySkin(skin, { includeCustom: false, animate: Boolean(previous) })
      session.preview(skin)
    },
    { immediate: true }
  )
  function finish(): Promise<void> {
    stop()
    applySkin(saved, { includeCustom: false, animate: false })
    return session.end()
  }
  useEventListener(window, 'pagehide', () => {
    void finish()
  })
  useEventListener(window, 'miraihub:settings-hidden', () => {
    void finish()
  })
  onBeforeUnmount(() => {
    void finish()
  })
  return { finish }
}
