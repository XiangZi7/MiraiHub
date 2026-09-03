<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  closeWindow,
  isMaximized,
  minimizeWindow,
  toggleMaximizeWindow,
  trackMaximized,
} from '@/utils/window'

// 订阅句柄不参与渲染，用普通变量即可；卸载时解除，避免热更新越挂越多
let stopTracking: (() => void) | undefined

onMounted(() => {
  stopTracking = trackMaximized()
})

onBeforeUnmount(() => {
  stopTracking?.()
})

/**
 * Windows 标准顺序：最小化 → 最大化/还原 → 关闭，一律靠右。
 * 尺寸取 Win11 的 46×32，高度撑满标题栏；
 * 关闭键 hover 用系统同款红 #c42b1c，其余用极淡的白。
 */
const buttons = computed(() => [
  { id: 'min', icon: 'mirai:win-min', title: '最小化', danger: false, run: minimizeWindow },
  {
    id: 'max',
    icon: isMaximized.value ? 'mirai:win-restore' : 'mirai:win-max',
    title: isMaximized.value ? '向下还原' : '最大化',
    danger: false,
    run: toggleMaximizeWindow,
  },
  { id: 'close', icon: 'mirai:win-close', title: '关闭', danger: true, run: closeWindow },
])
</script>

<template>
  <div class="flex h-full shrink-0 items-stretch">
    <button
      v-for="button in buttons"
      :key="button.id"
      type="button"
      :class="[
        'grid w-11.5 place-items-center text-txt-2 transition-colors duration-100',
        button.danger
          ? 'hover:bg-danger hover:text-white'
          : 'hover:bg-hover hover:text-txt',
      ]"
      :title="button.title"
      @click="button.run()"
    >
      <AppIcon :name="button.icon" :size="22" />
    </button>
  </div>
</template>
