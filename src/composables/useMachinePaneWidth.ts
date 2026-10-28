import { computed, shallowRef, watch, type Ref } from 'vue'
import { useElementSize } from '@vueuse/core'

/** 当前连接的终端与机器面板各保留可用空间，隐藏或缩小分屏不覆盖用户偏好。 */
export function useMachinePaneWidth(
  container: Ref<HTMLElement | null>,
  preferred: Ref<number>
) {
  const { width: measuredWidth } = useElementSize(container)
  const lastWidth = shallowRef(900)
  watch(
    measuredWidth,
    width => {
      if (width > 0) lastWidth.value = width
    },
    { immediate: true }
  )
  const available = computed(() => Math.max(0, lastWidth.value - 10))
  const min = computed(() => Math.round(Math.min(240, available.value * 0.45)))
  const max = computed(() =>
    Math.round(Math.max(min.value, available.value - 48))
  )
  const width = computed({
    get: () =>
      Math.round(
        Math.min(
          max.value,
          Math.max(
            min.value,
            Number.isFinite(preferred.value) ? preferred.value : 400
          )
        )
      ),
    set: (value: number) => {
      if (Number.isFinite(value))
        preferred.value = Math.min(max.value, Math.max(min.value, value))
    },
  })
  return { width, min, max }
}
