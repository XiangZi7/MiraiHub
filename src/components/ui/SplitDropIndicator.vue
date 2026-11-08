<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import type { SplitDropPosition } from '@/utils/split-drop'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    direction: SplitDropPosition
    /** 分屏组正按网格平铺：新面板只按顺序插在当前分屏前后，落点与半区无关 */
    grid?: boolean
  }>(),
  { grid: false }
)

// 投放提示的图标与文案；网格平铺时左/上表示插到当前分屏之前，右/下表示之后
const hint = computed(() => {
  if (props.grid && props.direction !== 'center')
    return props.direction === 'left' || props.direction === 'up'
      ? { icon: 'lucide:arrow-left-to-line', label: t('插到当前分屏之前') }
      : { icon: 'lucide:arrow-right-to-line', label: t('插到当前分屏之后') }
  switch (props.direction) {
    case 'center':
      return { icon: 'lucide:panels-top-left', label: t('移动到此标签分组') }
    case 'left':
      return { icon: 'lucide:panel-left', label: t('在左侧分屏') }
    case 'right':
      return { icon: 'lucide:panel-right', label: t('在右侧分屏') }
    case 'up':
      return { icon: 'lucide:panel-top', label: t('在上方分屏') }
    default:
      return { icon: 'lucide:panel-bottom', label: t('在下方分屏') }
  }
})

/** 覆盖目标半区；网格平铺时落点不对应任何半区，改为覆盖整个分屏组 */
const area = computed(() => {
  if (props.grid) return 'inset-0'
  switch (props.direction) {
    case 'center':
      return 'inset-0'
    case 'left':
      return 'inset-y-0 left-0 right-1/2'
    case 'right':
      return 'inset-y-0 left-1/2 right-0'
    case 'up':
      return 'inset-x-0 top-0 bottom-1/2'
    default:
      return 'inset-x-0 top-1/2 bottom-0'
  }
})
</script>

<template>
  <!-- 投放预览。纯提示，不参与命中测试，否则会挡住底下的方向判定 -->
  <div
    :class="[
      'border-violet/70 bg-violet/15 rounded-pane pointer-events-none absolute z-40 grid place-items-center border border-dashed',
      'transition-[inset] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
      area,
    ]"
    role="status"
    aria-live="polite"
  >
    <span
      class="border-violet/55 bg-panel text-txt shadow-pop flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]"
    >
      <AppIcon
        :name="hint.icon"
        :size="14"
      />
      {{ hint.label }}
    </span>
  </div>
</template>
