import { computed, type Ref } from 'vue'
import { useElementSize, useStorage } from '@vueuse/core'

/** Remember the user's width while fitting both panes into the current container. */
export function useAgentPaneWidth(
  container: Ref<HTMLElement | null>,
  kind: 'ssh' | 'database'
) {
  const preferred = useStorage(`miraihub:agent-pane-width:${kind}`, 400)
  const { width: containerWidth } = useElementSize(container)
  const available = computed(() =>
    Math.max(0, (containerWidth.value || 900) - 10)
  )
  const min = computed(() => Math.round(Math.min(280, available.value * 0.5)))
  const max = computed(() =>
    Math.round(
      Math.max(
        min.value,
        available.value - Math.min(260, available.value * 0.4)
      )
    )
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
    set: value => {
      preferred.value = Math.min(max.value, Math.max(min.value, value))
    },
  })
  const style = computed(() => ({
    flex: `0 0 ${width.value}px`,
    minWidth: '0',
  }))
  return { width, min, max, style }
}
