<script setup lang="ts">
import { cn } from '@/utils/cn'

withDefaults(defineProps<{
  /** 是否显示顶部环境光 */
  ambient?: boolean
  /** 附加 class */
  class?: string
}>(), {
  ambient: false,
})
</script>

<template>
  <section :class="cn('win', ambient && 'ambient', $props.class)">
    <slot />
  </section>
</template>
