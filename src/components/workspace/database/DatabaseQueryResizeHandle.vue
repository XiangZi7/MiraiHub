<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from "vue";

const props = withDefaults(defineProps<{
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  minPaneSize?: number;
}>(), {
  label: "调整 SQL 编辑器和查询结果区高度",
  min: 15,
  max: 85,
  step: 2,
  defaultValue: 58,
  minPaneSize: 120,
});

const ratio = defineModel<number>({ required: true });
const dragging = shallowRef(false);

let pointerId = -1;
let startY = 0;
let startRatio = 0;
let containerHeight = 0;

function effectiveBounds(height: number): { min: number; max: number } {
  if (!height) return { min: props.min, max: props.max };
  const paneRatio = props.minPaneSize / height * 100;
  const min = Math.max(props.min, paneRatio);
  const max = Math.min(props.max, 100 - paneRatio);
  return min <= max ? { min, max } : { min: 50, max: 50 };
}

function clamp(value: number, height = containerHeight): number {
  const bounds = effectiveBounds(height);
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

function startDragging(event: PointerEvent): void {
  if (event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  containerHeight = handle.parentElement?.clientHeight ?? 0;
  pointerId = event.pointerId;
  startY = event.clientY;
  startRatio = ratio.value;
  dragging.value = true;
  handle.setPointerCapture(pointerId);
  document.body.classList.add("app-resizing-rows");
  event.preventDefault();
}

function drag(event: PointerEvent): void {
  if (!dragging.value || event.pointerId !== pointerId || !containerHeight) return;
  ratio.value = clamp(startRatio + (event.clientY - startY) / containerHeight * 100);
}

function stopDragging(event?: PointerEvent): void {
  if (event && event.pointerId !== pointerId) return;
  dragging.value = false;
  pointerId = -1;
  document.body.classList.remove("app-resizing-rows");
}

function handleKeydown(event: KeyboardEvent): void {
  let next = ratio.value;
  if (event.key === "ArrowUp") next -= props.step;
  else if (event.key === "ArrowDown") next += props.step;
  else if (event.key === "Home") next = props.min;
  else if (event.key === "End") next = props.max;
  else return;
  event.preventDefault();
  ratio.value = clamp(next, (event.currentTarget as HTMLElement).parentElement?.clientHeight ?? 0);
}

function reset(event: MouseEvent): void {
  ratio.value = clamp(props.defaultValue, (event.currentTarget as HTMLElement).parentElement?.clientHeight ?? 0);
}

onBeforeUnmount(() => {
  document.body.classList.remove("app-resizing-rows");
});
</script>

<template>
  <div
    role="separator"
    tabindex="0"
    aria-orientation="horizontal"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="Math.round(ratio)"
    :aria-valuetext="`SQL 编辑器占 ${Math.round(ratio)}%`"
    :class="['query-resize-handle', dragging && 'is-dragging']"
    title="拖动调整高度；双击恢复默认"
    @dblclick="reset"
    @keydown="handleKeydown"
    @pointerdown="startDragging"
    @pointermove="drag"
    @pointerup="stopDragging"
    @pointercancel="stopDragging"
    @lostpointercapture="stopDragging"
  >
    <span class="query-resize-line" aria-hidden="true"><i /></span>
  </div>
</template>

<style scoped>
.query-resize-handle { position: relative; z-index: 20; min-height: 10px; cursor: row-resize; touch-action: none; outline: none; }
.query-resize-line { position: absolute; top: 50%; right: 0; left: 0; height: 1px; background: var(--color-line); transform: translateY(-50%); transition: height 120ms ease, background-color 120ms ease, box-shadow 120ms ease; }
.query-resize-line i { position: absolute; top: 50%; left: 50%; display: block; width: 34px; height: 4px; border: 1px solid var(--color-line-strong); border-radius: 999px; background: color-mix(in oklch, var(--color-panel) 86%, transparent); opacity: 0; transform: translate(-50%, -50%); transition: opacity 120ms ease, border-color 120ms ease; }
.query-resize-handle:hover .query-resize-line,
.query-resize-handle:focus-visible .query-resize-line,
.query-resize-handle.is-dragging .query-resize-line { height: 2px; background: var(--color-violet); box-shadow: 0 0 8px color-mix(in oklch, var(--color-violet) 52%, transparent); }
.query-resize-handle:hover .query-resize-line i,
.query-resize-handle:focus-visible .query-resize-line i,
.query-resize-handle.is-dragging .query-resize-line i { border-color: color-mix(in oklch, var(--color-violet) 62%, white 10%); opacity: 1; }
:global(body.app-resizing-rows),
:global(body.app-resizing-rows *) { cursor: row-resize !important; user-select: none !important; }
@media (prefers-reduced-motion: reduce) { .query-resize-line, .query-resize-line i { transition: none; } }
</style>
