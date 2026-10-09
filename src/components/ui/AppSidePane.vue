<script setup lang="ts">
defineProps<{
  open: boolean
  /** 包括分隔条在内的宽度；省略时占满父容器。 */
  width?: number
}>()
</script>

<template>
  <Transition
    appear
    enter-active-class="transition-[width,opacity,transform] duration-260 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
    leave-active-class="transition-[width,opacity,transform] duration-260 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
    enter-from-class="w-0! translate-x-2 opacity-0"
    leave-to-class="w-0! translate-x-2 opacity-0"
  >
    <div
      v-show="open"
      data-side-pane
      class="flex min-h-0 w-(--side-pane-width) min-w-0 shrink-0 overflow-hidden"
      :inert="!open"
      :style="{
        '--side-pane-width': width === undefined ? '100%' : `${width}px`,
      }"
    >
      <div class="flex min-h-0 w-(--side-pane-width) min-w-0 shrink-0">
        <slot />
      </div>
    </div>
  </Transition>
</template>
