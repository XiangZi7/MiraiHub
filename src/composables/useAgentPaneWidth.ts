import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useElementSize, useStorage } from '@vueuse/core'

/** 按连接记住 AI 面板宽度；共享容器中可预留侧栏空间，避免挤占主内容的最小宽度。 */
export function useAgentPaneWidth(
  container: Ref<HTMLElement | null>,
  kind: 'ssh' | 'database',
  connectionId?: MaybeRefOrGetter<string | undefined>,
  reservedWidth: MaybeRefOrGetter<number> = 0
) {
  const key = computed(
    () =>
      `miraihub:agent-pane-width:${kind}${toValue(connectionId) ? ':' + toValue(connectionId) : ''}`
  )
  const preferred = useStorage(key, 400)
  const { width: containerWidth } = useElementSize(container)
  const available = computed(() =>
    Math.max(0, (containerWidth.value || 900) - toValue(reservedWidth) - 10)
  )
  const min = computed(() => Math.round(Math.min(280, available.value * 0.5)))
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
