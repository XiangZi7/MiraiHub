<script setup lang="ts">
import SplitDivider from './SplitDivider.vue'
import type { SplitOrientation, SplitPane } from '@/composables/useSplitPanes'

defineProps<{
  panes: readonly SplitPane[]
  /** 与 panes 同序的占比，总和 100 */
  ratios: readonly number[]
  orientation: SplitOrientation
  activeId?: string
}>()

const emit = defineEmits<{
  /** 第 dividerIndex 个分隔条前的面板目标占比 */
  resize: [dividerIndex: number, leadingRatio: number]
  reset: []
}>()

defineSlots<{
  pane(props: { pane: SplitPane; index: number; active: boolean }): any
}>()
</script>

<template>
  <div
    :class="[
      'flex min-h-0 min-w-0 flex-1',
      orientation === 'vertical' ? 'flex-col' : 'flex-row',
    ]"
  >
    <template
      v-for="(pane, index) in panes"
      :key="pane.id"
    >
      <SplitDivider
        v-if="index > 0"
        :orientation="orientation"
        :value-now="ratios[index - 1] ?? 50"
        @resize="emit('resize', index - 1, $event)"
        @reset="emit('reset')"
      />
      <!-- 占比交给 flex-grow 承载、basis 归零：N 个面板按比例精确分配，
           内容再长也不会把面板撑开 -->
      <div
        class="flex min-h-0 min-w-0 shrink basis-0"
        :style="{ flexGrow: ratios[index] ?? 1 }"
      >
        <slot
          name="pane"
          :pane="pane"
          :index="index"
          :active="pane.id === activeId"
        />
      </div>
    </template>
  </div>
</template>
