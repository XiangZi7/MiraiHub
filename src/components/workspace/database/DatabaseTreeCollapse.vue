<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue'

/**
 * 对象树分组的展开过渡：grid-rows 0fr → 1fr。
 * 子节点只在展开时渲染；收起时等过渡结束再卸载，大库折叠后不保留几千个节点。
 */
const props = defineProps<{ open: boolean }>()

/** 与 duration-200 对应；减少动画时 transitionend 不会触发，靠定时器兜底卸载。 */
const COLLAPSE_MS = 200

const rendered = shallowRef(props.open)
const expanded = shallowRef(props.open)
let timer: ReturnType<typeof setTimeout> | undefined
let frame = 0

watch(
  () => props.open,
  open => {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    if (open) {
      rendered.value = true
      // 先以 0fr 挂载，下一帧再切到 1fr，过渡才有起点。
      frame = requestAnimationFrame(() => {
        expanded.value = true
      })
      return
    }
    expanded.value = false
    timer = setTimeout(() => {
      if (!props.open) rendered.value = false
    }, COLLAPSE_MS)
  }
)

onBeforeUnmount(() => {
  clearTimeout(timer)
  cancelAnimationFrame(frame)
})
</script>

<template>
  <div
    v-if="rendered"
    role="group"
    :data-tree-collapsed="open ? undefined : ''"
    :class="[
      'grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-200 motion-safe:ease-out',
      expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
    ]"
  >
    <div class="min-h-0 overflow-hidden">
      <slot />
    </div>
  </div>
</template>
