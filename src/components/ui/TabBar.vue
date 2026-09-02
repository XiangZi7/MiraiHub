<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import StatusDot from './StatusDot.vue'
import { cn } from '@/utils/cn'

export interface TabItem {
  /** 唯一标识 */
  id: string
  /** 标签文案 */
  label: string
  /** 左侧图标（与 dot 二选一） */
  icon?: string
  /** 左侧状态点色调 */
  dot?: 'accent' | 'txt-3'
  /** 是否可关闭 */
  closable?: boolean
}

defineProps<{
  tabs: TabItem[]
  /** 是否显示新建按钮 */
  addable?: boolean
}>()

const active = defineModel<string>('active', { required: true })
</script>

<template>
  <div class="flex min-w-0 h-full items-center gap-0.5 overflow-x-auto scroll-none">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      :class="cn(
        'group flex h-full shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 text-xs transition-colors duration-150',
        active === tab.id
          ? 'border-accent bg-card text-txt'
          : 'border-transparent text-txt-3 hover:bg-panel hover:text-txt-2',
      )"
      @click="active = tab.id"
    >
      <StatusDot v-if="tab.dot" :tone="tab.dot" :size="6" :glow="tab.dot === 'accent'" />
      <AppIcon v-else-if="tab.icon" :name="tab.icon" :size="13" />
      <span class="whitespace-nowrap">{{ tab.label }}</span>
      <AppIcon
        v-if="tab.closable"
        name="lucide:x"
        :size="12"
        class="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
      />
    </button>

    <button
      v-if="addable"
      type="button"
      class="icon-btn ml-1"
      title="新建"
    >
      <AppIcon name="lucide:plus" :size="14" />
    </button>
  </div>
</template>
