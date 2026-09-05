<script setup lang="ts">
import { Icon } from '@iconify/vue'

withDefaults(
  defineProps<{
    /** iconify 图标名，如 lucide:server */
    name: string
    /** 尺寸，单位 px */
    size?: number | string
  }>(),
  {
    size: 16,
  }
)
</script>

<template>
  <Icon
    :icon="name"
    :width="size"
    :height="size"
    class="shrink-0"
  />
</template>
