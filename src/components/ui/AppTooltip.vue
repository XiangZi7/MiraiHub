<script setup lang="ts">
import { toRefs, useId, useTemplateRef } from 'vue'
import { useAppTooltip } from '@/composables/useAppTooltip'
import AppMenuSurface from './AppMenuSurface.vue'

const tooltipId = `tooltip-${useId()}`
const bubble = useTemplateRef<HTMLElement>('bubble')
const { state, enter, leave } = useAppTooltip(bubble, tooltipId)
const { content, details, open, positioned, side, style } = toRefs(state)
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
      <AppMenuSurface />
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
}
.app-tooltip-content {
  max-height: min(240px, calc((100vh - 32px) / var(--preview-zoom, 1)));
  overflow-wrap: anywhere;
}
.app-tooltip::before {
  position: absolute;
  left: var(--tooltip-arrow-x);
  width: 7px;
  height: 7px;
  content: '';
  background: color-mix(in oklch, var(--color-panel) 94%, var(--color-canvas));
  border: 1px solid var(--color-line-strong);
  transform: translateX(-50%) rotate(45deg);
}
.app-tooltip--bottom::before {
  top: -4px;
  border-right: 0;
  border-bottom: 0;
}
.app-tooltip--top::before {
  bottom: -4px;
  border-top: 0;
  border-left: 0;
}
</style>
