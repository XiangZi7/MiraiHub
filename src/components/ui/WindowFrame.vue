<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(defineProps<{
  /** 是否显示顶部环境光 */
  ambient?: boolean
  /** 附加 class */
  class?: string
}>(), {
  ambient: false,
})

const classes = computed(() => cn(
  'win',
  props.ambient && 'ambient',
  props.class,
))
</script>

<template>
  <section :class="classes">
    <slot />
  </section>
</template>
