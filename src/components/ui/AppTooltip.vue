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
@supports (clip-path: shape(from 0 0, hline to 100%, close)) {
  /* 小尖角与气泡主体由同一个玻璃底绘制，箭头单独补描边。 */
  .app-tooltip {
    --pointer-x: clamp(12px, var(--tooltip-arrow-x, 12px), calc(100% - 12px));
    --pointer-left: calc(var(--pointer-x) - 5px);
    --pointer-right: calc(var(--pointer-x) + 5px);
    --surface-top: 0px;
    --surface-bottom: 100%;
    --menu-surface-overflow: visible;
    --menu-surface-clip: shape(
      from 7px var(--surface-top),
      hline to var(--pointer-left),
      line to var(--pointer-x) 0px,
      line to var(--pointer-right) var(--surface-top),
      hline to calc(100% - 7px),
      curve to 100% calc(var(--surface-top) + 7px) with 100% var(--surface-top),
      vline to calc(var(--surface-bottom) - 7px),
      curve to calc(100% - 7px) var(--surface-bottom) with 100%
        var(--surface-bottom),
      hline to var(--pointer-right),
      line to var(--pointer-x) 100%,
      line to var(--pointer-left) var(--surface-bottom),
      hline to 7px,
      curve to 0px calc(var(--surface-bottom) - 7px) with 0px
        var(--surface-bottom),
      vline to calc(var(--surface-top) + 7px),
      curve to 7px var(--surface-top) with 0px var(--surface-top),
      close
    );
  }

  .app-tooltip--bottom {
    --surface-top: 6px;
    --menu-surface-inset: -6px 0 0;
    border-top-color: transparent;
  }

  .app-tooltip--top {
    --surface-bottom: calc(100% - 6px);
    --menu-surface-inset: 0 0 -6px;
    border-bottom-color: transparent;
  }

  .app-tooltip::before,
  .app-tooltip::after {
    position: absolute;
    pointer-events: none;
    content: '';
  }

  .app-tooltip::before {
    left: var(--pointer-x);
    width: 8px;
    height: 8px;
    border: solid var(--color-line-strong);
    transform: translateX(-50%) rotate(45deg);
  }

  .app-tooltip::after {
    inset-inline: 0;
    height: 1px;
    background: linear-gradient(
      to right,
      transparent 0 6px,
      var(--color-line-strong) 6px var(--pointer-left),
      transparent var(--pointer-left) var(--pointer-right),
      var(--color-line-strong) var(--pointer-right) calc(100% - 6px),
      transparent calc(100% - 6px)
    );
  }

  .app-tooltip--bottom::before {
    top: -5px;
    border-width: 1px 0 0 1px;
  }

  .app-tooltip--top::before {
    bottom: -5px;
    border-width: 0 1px 1px 0;
  }

  .app-tooltip--bottom::after {
    top: -1px;
  }

  .app-tooltip--top::after {
    bottom: -1px;
  }
}
</style>
