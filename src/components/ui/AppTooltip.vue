<script setup lang="ts">
import { toRefs, useId, useTemplateRef } from 'vue'
import { useAppTooltip } from '@/composables/useAppTooltip'
import AppMenuSurface from '@/components/ui/AppMenuSurface.vue'

const tooltipId = `tooltip-${useId()}`
const bubble = useTemplateRef<HTMLElement>('bubble')
const { state, enter, leave } = useAppTooltip(bubble, tooltipId)
const { content, details, open, positioned, side, style, shape } = toRefs(state)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      :id="tooltipId"
      ref="bubble"
      role="tooltip"
      class="app-tooltip border-line-strong text-txt shadow-pop fixed z-300 rounded-lg border font-sans text-[11px] leading-5 font-normal"
      :class="[`app-tooltip--${side}`, !positioned && 'invisible']"
      :style="style"
      @pointerenter="enter"
      @pointerleave="leave"
    >
      <!-- 公共玻璃底与描边共享完整路径，包含四个圆角和上下尖角。 -->
      <AppMenuSurface />
      <svg
        v-if="shape.path"
        class="app-tooltip-outline"
        :width="shape.width"
        :height="shape.height"
        :viewBox="`0 0 ${shape.width} ${shape.height}`"
        aria-hidden="true"
        focusable="false"
      >
        <path :d="shape.path" />
      </svg>
      <dl
        v-if="details.length"
        class="scroll-thin app-tooltip-content grid grid-cols-[auto_minmax(0,1fr)] overflow-auto p-1"
      >
        <template
          v-for="row in details"
          :key="row.label"
        >
          <dt class="bg-panel text-txt-3 px-2 py-1 text-right">
            {{ row.label }}
          </dt>
          <dd
            class="text-blue min-w-0 px-2 py-1 font-mono break-words whitespace-pre-wrap"
          >
            {{ row.value || '—' }}
          </dd>
        </template>
      </dl>
      <div
        v-else
        class="scroll-thin app-tooltip-content overflow-auto px-2.5 py-1.5 whitespace-pre-wrap"
      >
        {{ content }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.app-tooltip {
  isolation: isolate;
  width: max-content;
  max-width: min(320px, calc(100vw - 16px));
  border-radius: var(--tooltip-radius, 6px);
}
.app-tooltip-content {
  max-height: min(240px, calc((100vh - 32px) / var(--preview-zoom, 1)));
  overflow-wrap: anywhere;
}
.app-tooltip-outline {
  display: none;
  position: absolute;
  left: var(--tooltip-outline-left, -1px);
  top: var(--tooltip-outline-top, -1px);
  overflow: visible;
  pointer-events: none;
  fill: none;
  stroke: var(--color-line-strong);
  stroke-width: 1px;
  stroke-linejoin: round;
}
@supports (clip-path: path('M0 0 H1 V1 Z')) {
  /* 背景与 SVG 共用闭合轮廓，四角弧线和尖角连续，不再拼接直线或旋转方块。 */
  .app-tooltip {
    border-color: transparent;
    box-shadow: var(--shadow-pop-drop);
    --menu-surface-overflow: visible;
    --menu-surface-inset: var(--tooltip-shape-inset);
    --menu-surface-clip: var(--tooltip-shape-clip);
  }
  .app-tooltip-outline {
    display: block;
  }
}
</style>
