<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    /** iconify 图标名 */
    icon: string
    /** 图标尺寸 */
    size?: number
    /** 原生 title 提示 */
    title?: string
    /** 禁用。用于"没有上一级可回"这类当前不可用的动作 */
    disabled?: boolean
  }>(),
  {
    size: 15,
  }
)
</script>

<template>
  <button
    type="button"
    class="icon-btn disabled:pointer-events-none disabled:opacity-35"
    :title="title"
    :disabled="disabled"
  >
    <AppIcon
      :name="icon"
      :size="size"
    />
  </button>
</template>
