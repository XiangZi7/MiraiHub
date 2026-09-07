import { computed, type Ref } from 'vue'
import { useElementSize, useStorage } from '@vueuse/core'

/** 记住侧栏宽度，并在窗口变窄时为右侧工作区保留空间。 */
export function useDatabaseSidebarWidth(container: Ref<HTMLElement | null>) {
  const preferred = useStorage('miraihub:database-sidebar-width', 248)
  const { width: containerWidth } = useElementSize(container)
  const available = computed(() => Math.max(0, containerWidth.value || 900))
  const min = computed(() => Math.round(Math.min(180, available.value * 0.4)))
  const max = computed(() =>
    Math.round(Math.max(min.value, Math.min(560, available.value - 320)))
  )
  const width = computed({
    get: () =>
      Math.round(
        Math.min(
          max.value,
          Math.max(
            min.value,
            Number.isFinite(preferred.value) ? preferred.value : 248
          )
        )
      ),
    set: (value: number) => {
      if (Number.isFinite(value))
        preferred.value = Math.min(max.value, Math.max(min.value, value))
    },
  })
  const style = computed(() => ({ flex: `0 0 ${width.value}px` }))

  return { width, min, max, style }
}
