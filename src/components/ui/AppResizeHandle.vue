<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{
  /** 被调整的面板位于分隔条哪一侧 */
  paneSide: 'left' | 'right'
  min: number
  max: number
  label: string
  step?: number
  overlay?: boolean
}>(), {
  step: 8,
  overlay: false,
})

const width = defineModel<number>({ required: true })
const dragging = ref(false)

let pointerId = -1
let startX = 0
let startWidth = 0

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, value))
}

function widthFromHorizontalDelta(deltaX: number): number {
  return startWidth + deltaX * (props.paneSide === 'left' ? 1 : -1)
}

function startDragging(event: PointerEvent): void {
  if (event.button !== 0)
    return

  const handle = event.currentTarget as HTMLElement
  pointerId = event.pointerId
  startX = event.clientX
  startWidth = width.value
  dragging.value = true
  handle.setPointerCapture(pointerId)
  document.body.classList.add('app-resizing-columns')
  event.preventDefault()
}

function drag(event: PointerEvent): void {
  if (!dragging.value || event.pointerId !== pointerId)
    return

  width.value = clamp(widthFromHorizontalDelta(event.clientX - startX))
}

function stopDragging(event?: PointerEvent): void {
  if (event && event.pointerId !== pointerId)
    return

  dragging.value = false
  pointerId = -1
  document.body.classList.remove('app-resizing-columns')
}

function handleKeydown(event: KeyboardEvent): void {
  let nextWidth = width.value
  const direction = props.paneSide === 'left' ? 1 : -1

  if (event.key === 'ArrowLeft')
    nextWidth -= props.step * direction
  else if (event.key === 'ArrowRight')
    nextWidth += props.step * direction
  else if (event.key === 'Home')
    nextWidth = props.min
  else if (event.key === 'End')
    nextWidth = props.max
  else
    return

  event.preventDefault()
  width.value = clamp(nextWidth)
}

onBeforeUnmount(() => {
  document.body.classList.remove('app-resizing-columns')
})
</script>

<template>
  <div
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="Math.round(width)"
    :class="['app-resize-handle', { 'app-resize-handle-overlay': overlay, 'is-dragging': dragging }]"
    @keydown="handleKeydown"
    @pointerdown="startDragging"
    @pointermove="drag"
    @pointerup="stopDragging"
    @pointercancel="stopDragging"
    @lostpointercapture="stopDragging"
  >
    <span aria-hidden="true" />
  </div>
</template>

<style scoped>
.app-resize-handle {
  position: relative;
  z-index: 20;
  width: 10px;
  flex: 0 0 10px;
  align-self: stretch;
  cursor: col-resize;
  touch-action: none;
  outline: none;
}

.app-resize-handle-overlay {
  width: 8px;
  flex-basis: 8px;
  margin-right: -4px;
  margin-left: -4px;
}

.app-resize-handle span {
  position: absolute;
  inset-block: 0;
  left: 50%;
  width: 1px;
  background: transparent;
  transform: translateX(-50%);
  transition:
    width 120ms ease,
    background-color 120ms ease,
    box-shadow 120ms ease;
}

.app-resize-handle:hover span,
.app-resize-handle:focus-visible span,
.app-resize-handle.is-dragging span {
  width: 2px;
  background: var(--color-violet);
  box-shadow: 0 0 8px color-mix(in oklab, var(--color-violet) 52%, transparent);
}

:global(body.app-resizing-columns),
:global(body.app-resizing-columns *) {
  cursor: col-resize !important;
  user-select: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .app-resize-handle span {
    transition: none;
  }
}
</style>
