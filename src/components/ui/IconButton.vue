<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(defineProps<{
  /** iconify 图标名 */
  icon: string
  /** 图标尺寸 */
  size?: number
  /** 原生 title 提示 */
  title?: string
}>(), {
  size: 15,
})
</script>

<template>
  <button type="button" class="icon-btn" :title="title">
    <AppIcon :name="icon" :size="size" />
  </button>
</template>
