<script setup lang="ts" generic="T extends TabItem">
import type { TabItem } from '@/components/ui/TabBar.vue'

// 数据库内容保持挂载；标签入口统一由顶部主标签栏提供。
defineProps<{ tabs: readonly T[] }>()
const active = defineModel<string>('active', { required: true })
defineSlots<{
  default(props: { tab: T; visible: boolean }): unknown
  empty(): unknown
}>()
</script>

<template>
  <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <slot
      v-if="!tabs.some(tab => tab.id === active)"
      name="empty"
    />
    <div
      v-for="tab in tabs"
      :key="tab.id"
      v-show="tab.id === active"
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <slot
        :tab="tab"
        :visible="tab.id === active"
      />
    </div>
  </div>
</template>
