<script setup lang="ts">
import type { VNode } from 'vue'
import SplitDivider from './SplitDivider.vue'
import type { SplitOrientation, SplitPane } from '@/composables/useSplitPanes'

const props = withDefaults(
  defineProps<{
    panes: readonly SplitPane[]
    /** 与 panes 同序的占比，总和 100 */
    ratios: readonly number[]
    orientation: SplitOrientation
    activeId?: string
    /** 按两列网格平铺：各格等分，不显示分隔条、不能拖动调整比例 */
    grid?: boolean
  }>(),
  { grid: false }
)

const emit = defineEmits<{
  /** 第 dividerIndex 个分隔条前的面板目标占比 */
  resize: [dividerIndex: number, leadingRatio: number]
  reset: []
}>()

defineSlots<{
  pane(props: { pane: SplitPane; index: number; active: boolean }): VNode[]
}>()

// 网格平铺且面板数为奇数时，让最后一块横跨整行，避免右下角空出一格
function spansRow(index: number): boolean {
  return props.panes.length % 2 === 1 && index === props.panes.length - 1
}
</script>

<template>
  <!-- 网格平铺与分栏共用同一批带 key 的面板节点，只换容器和面板的 class/style：
       换成两棵子树会卸载重建插槽里的终端，xterm 的回滚内容随之丢失 -->
  <div
    :class="[
      'min-h-0 min-w-0 flex-1',
      grid
        ? 'grid auto-rows-fr grid-cols-2 gap-3'
        : ['flex', orientation === 'vertical' ? 'flex-col' : 'flex-row'],
    ]"
  >
    <template
      v-for="(pane, index) in panes"
      :key="pane.id"
    >
      <SplitDivider
        v-if="index > 0 && !grid"
        :orientation="orientation"
        :value-now="ratios[index - 1] ?? 50"
        @resize="emit('resize', index - 1, $event)"
        @reset="emit('reset')"
      />
      <!-- 分栏时占比交给 flex-grow 承载、basis 归零：N 个面板按比例精确分配，
           内容再长也不会把面板撑开；网格平铺时由网格等分，不带占比样式 -->
      <div
        :class="
          grid
            ? [
                'panel-fade-in flex min-h-0 min-w-0',
                spansRow(index) && 'col-span-2',
              ]
            : 'flex min-h-0 min-w-0 shrink basis-0'
        "
        :style="grid ? undefined : { flexGrow: ratios[index] ?? 1 }"
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
