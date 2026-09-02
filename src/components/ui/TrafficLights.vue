<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from '@/utils/window'

/** 交通灯按钮定义，顺序与 macOS 一致：关闭 / 最小化 / 最大化 */
const LIGHTS = [
  { id: 'close', color: 'bg-tl-red', icon: 'lucide:x', title: '关闭', run: closeWindow },
  { id: 'min', color: 'bg-tl-yellow', icon: 'lucide:minus', title: '最小化', run: minimizeWindow },
  { id: 'max', color: 'bg-tl-green', icon: 'lucide:plus', title: '最大化', run: toggleMaximizeWindow },
] as const
</script>

<template>
  <div class="group/tl flex items-center gap-2">
    <button
      v-for="light in LIGHTS"
      :key="light.id"
      type="button"
      :class="[
        'grid size-3 place-items-center rounded-full text-black/60 transition-opacity hover:opacity-85',
        light.color,
      ]"
      :title="light.title"
      @click="light.run()"
    >
      <!-- 符号平时隐藏，鼠标移到整组交通灯上才浮现 —— macOS 的做法 -->
      <AppIcon
        :name="light.icon"
        :size="8"
        class="opacity-0 transition-opacity duration-150 group-hover/tl:opacity-100"
      />
    </button>
  </div>
</template>
