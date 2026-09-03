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
  dot?: 'accent' | 'amber' | 'txt-3'
  /** 激活下划线颜色；连接标签可跟随用户选择的标签色。 */
  accent?: string
  /** 是否可关闭 */
  closable?: boolean
}

defineProps<{
  tabs: TabItem[]
  /** 是否显示新建按钮 */
  addable?: boolean
}>()

const emit = defineEmits<{
  add: []
  /** 请求关闭某个标签 */
  close: [id: string]
}>()

const active = defineModel<string>('active', { required: true })
</script>

<template>
  <div class="flex min-w-0 h-full items-center gap-0.5 overflow-x-auto scroll-none">
    <!-- 关闭按钮嵌在标签里，所以外层用 div 而不是 button：button 不能嵌套 -->
    <div
      v-for="tab in tabs"
      :key="tab.id"
      role="tab"
      tabindex="0"
      :aria-selected="active === tab.id"
      :style="active === tab.id ? { borderBottomColor: tab.accent || 'var(--color-accent)' } : undefined"
      :class="cn(
        'group flex h-full shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border-b-2 px-3 text-xs transition-colors duration-150',
        active === tab.id
          ? 'border-transparent bg-card text-txt'
          : 'border-transparent text-txt-3 hover:bg-panel hover:text-txt-2',
      )"
      @click="active = tab.id"
      @keydown.enter="active = tab.id"
      @keydown.space.prevent="active = tab.id"
    >
      <StatusDot v-if="tab.dot" :tone="tab.dot" :size="6" :glow="tab.dot !== 'txt-3'" />
      <AppIcon v-else-if="tab.icon" :name="tab.icon" :size="13" />
      <span class="whitespace-nowrap">{{ tab.label }}</span>

      <!-- 常态半隐，hover 才显形：一排标签全挂着叉号太吵 -->
      <button
        v-if="tab.closable"
        type="button"
        class="-mr-1 grid size-4 shrink-0 place-items-center rounded opacity-0 transition-opacity hover:bg-hover group-hover:opacity-60 hover:opacity-100!"
        :title="`关闭 ${tab.label}`"
        @click.stop="emit('close', tab.id)"
      >
        <AppIcon name="lucide:x" :size="12" />
      </button>
    </div>

    <button
      v-if="addable"
      type="button"
      class="icon-btn ml-1"
      title="新建"
      @click="emit('add')"
    >
      <AppIcon name="lucide:plus" :size="14" />
    </button>
  </div>
</template>
