<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  size?: number
}>(), {
  size: 24,
})

const logoStyle = computed(() => {
  const size = Math.max(1, props.size)

  return {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: `${Math.round(size / 3)}px`,
  }
})
</script>

<template>
  <span
    aria-hidden="true"
    class="pointer-events-none block shrink-0 overflow-hidden"
    :style="logoStyle"
  >
    <img
      src="/logo-app-icon.png"
      alt=""
      draggable="false"
      class="block size-full object-cover"
    >
  </span>
</template>
