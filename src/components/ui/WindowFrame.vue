<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

type WindowSurface = 'material' | 'dialog'

const props = withDefaults(defineProps<{
  /** 是否显示顶部环境光 */
  ambient?: boolean
  /** material 透出原生窗口材质；dialog 使用高性能静态背景。 */
  surface?: WindowSurface
  /** 附加 class */
  class?: string
}>(), {
  ambient: false,
  surface: 'material',
})

const classes = computed(() => cn(
  'win',
  props.surface === 'dialog' && 'win-dialog',
  props.ambient && 'ambient',
  props.class,
))
</script>

<template>
  <section :class="classes">
    <slot />
  </section>
</template>
