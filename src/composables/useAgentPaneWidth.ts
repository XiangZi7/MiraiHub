import {
  computed,
  onScopeDispose,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'
import { useElementSize, useStorage } from '@vueuse/core'

// 失焦兜底：指针在窗口外松开且没有捕获时收不到 pointerup。
const RELEASE_EVENTS = [
  'pointerup',
  'pointercancel',
  'lostpointercapture',
  'blur',
]

/**
 * 指针按住期间只把新值留在内存里，松开时一次性写回存储，
 * 避免拖动时每次 pointermove 都同步写 localStorage；键盘与程序设置仍立即写入。
 */
export function usePointerDeferredStorage<T>(
  stored: Ref<T, T | null | undefined>,
  key: Readonly<Ref<string>>
): Ref<T> {
  // 草稿记下所属键，拖动途中切换连接时不会把宽度写进另一个连接。
  const draft = shallowRef<{ key: string; value: T } | null>(null)
  let pressed = false
  function commit(): void {
    const pending = draft.value
    draft.value = null
    if (pending && pending.key === key.value) stored.value = pending.value
  }
  if (typeof window !== 'undefined') {
    const press = (): void => {
      pressed = true
    }
    // 冒泡阶段监听：分隔条自身的 pointerup 先补齐最后一帧，再在这里落盘。
    const release = (): void => {
      pressed = false
      commit()
    }
    window.addEventListener('pointerdown', press, true)
    for (const type of RELEASE_EVENTS) window.addEventListener(type, release)
    onScopeDispose(() => {
      window.removeEventListener('pointerdown', press, true)
      for (const type of RELEASE_EVENTS)
        window.removeEventListener(type, release)
      commit()
    })
  }
  return computed<T>({
    get: () =>
      draft.value?.key === key.value ? draft.value.value : stored.value,
    set: value => {
      if (pressed) draft.value = { key: key.value, value }
      else {
        draft.value = null
        stored.value = value
      }
    },
  })
}

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
  const preferred = usePointerDeferredStorage(useStorage(key, 400), key)
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
