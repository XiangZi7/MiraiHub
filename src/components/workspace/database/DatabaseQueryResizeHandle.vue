<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { onBeforeUnmount, shallowRef } from 'vue'
import { cn } from '@/utils/cn'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    label?: string
    valueText?: string
    min?: number
    max?: number
    step?: number
    defaultValue?: number
    minPaneSize?: number
  }>(),
  {
    label: '',
    min: 15,
    max: 85,
    step: 2,
    defaultValue: 58,
    minPaneSize: 120,
  }
)

const ratio = defineModel<number>({ required: true })
const dragging = shallowRef(false)

let pointerId = -1
let startY = 0
let startRatio = 0
let containerHeight = 0
let container: HTMLElement | null = null
// 拖拽中只改父容器的 CSS 变量，并按帧合并；松手时才写回 v-model 与持久化存储。
let frame = 0
let pendingY = 0
let draftRatio = 0

function effectiveBounds(height: number): { min: number; max: number } {
  if (!height) return { min: props.min, max: props.max }
  const paneRatio = (props.minPaneSize / height) * 100
  const min = Math.max(props.min, paneRatio)
  const max = Math.min(props.max, 100 - paneRatio)
  return min <= max ? { min, max } : { min: 50, max: 50 }
}

function clamp(value: number, height = containerHeight): number {
  const bounds = effectiveBounds(height)
  return Math.min(bounds.max, Math.max(bounds.min, value))
}

function writeSplit(value: number): void {
  container?.style.setProperty('--query-split-top', `${value}fr`)
  container?.style.setProperty('--query-split-bottom', `${100 - value}fr`)
}

function flushFrame(): void {
  frame = 0
  draftRatio = clamp(startRatio + ((pendingY - startY) / containerHeight) * 100)
  writeSplit(draftRatio)
}

function startDragging(event: PointerEvent): void {
  if (event.button !== 0) return
  const handle = event.currentTarget as HTMLElement
  container = handle.parentElement
  containerHeight = container?.clientHeight ?? 0
  pointerId = event.pointerId
  startY = event.clientY
  startRatio = ratio.value
  draftRatio = ratio.value
  dragging.value = true
  handle.setPointerCapture(pointerId)
  document.body.classList.add('app-resizing-rows')
  event.preventDefault()
}

function drag(event: PointerEvent): void {
  if (!dragging.value || event.pointerId !== pointerId || !containerHeight)
    return
  pendingY = event.clientY
  if (!frame) frame = requestAnimationFrame(flushFrame)
}

function stopDragging(event?: PointerEvent): void {
  if (!dragging.value) return
  if (event && event.pointerId !== pointerId) return
  if (frame) {
    cancelAnimationFrame(frame)
    flushFrame()
  }
  dragging.value = false
  pointerId = -1
  ratio.value = draftRatio
  container = null
  document.body.classList.remove('app-resizing-rows')
}

function handleKeydown(event: KeyboardEvent): void {
  let next = ratio.value
  if (event.key === 'ArrowUp') next -= props.step
  else if (event.key === 'ArrowDown') next += props.step
  else if (event.key === 'Home') next = props.min
  else if (event.key === 'End') next = props.max
  else return
  event.preventDefault()
  ratio.value = clamp(
    next,
    (event.currentTarget as HTMLElement).parentElement?.clientHeight ?? 0
  )
}

function reset(event: MouseEvent): void {
  ratio.value = clamp(
    props.defaultValue,
    (event.currentTarget as HTMLElement).parentElement?.clientHeight ?? 0
  )
}

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  document.body.classList.remove('app-resizing-rows')
})
</script>

<template>
  <div
    role="separator"
    tabindex="0"
    aria-orientation="horizontal"
    :aria-label="label || t('调整 SQL 编辑器和查询结果区高度')"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="Math.round(ratio)"
    :aria-valuetext="
      valueText || t('SQL 编辑器占 {value0}%', { value0: Math.round(ratio) })
    "
    class="group relative z-20 min-h-2.5 cursor-row-resize touch-none outline-none"
    :data-dragging="dragging || undefined"
    :title="t('拖动调整高度；双击恢复默认')"
    @dblclick="reset"
    @keydown="handleKeydown"
    @pointerdown="startDragging"
    @pointermove="drag"
    @pointerup="stopDragging"
    @pointercancel="stopDragging"
    @lostpointercapture="stopDragging"
  >
    <span
      :class="
        cn(
          'split-handle-line',
          'group-hover:bg-violet group-focus-visible:bg-violet group-data-dragging:bg-violet group-hover:h-0.5 group-focus-visible:h-0.5 group-data-dragging:h-0.5',
          'group-hover:shadow-[0_0_8px_color-mix(in_oklch,var(--color-violet)_52%,transparent)] group-data-dragging:shadow-[0_0_8px_color-mix(in_oklch,var(--color-violet)_52%,transparent)]'
        )
      "
      aria-hidden="true"
      ><i
        class="border-line-strong bg-panel/86 absolute top-1/2 left-1/2 block h-1 w-[34px] -translate-1/2 rounded-full border opacity-0 transition-opacity group-hover:border-violet group-hover:opacity-100 group-focus-visible:opacity-100 group-data-dragging:border-violet group-data-dragging:opacity-100 motion-reduce:transition-none"
    /></span>
  </div>
</template>
