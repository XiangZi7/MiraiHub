<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, onBeforeUnmount, shallowRef } from 'vue'
import type { SplitOrientation } from '@/composables/useSplitPanes'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    /** 跟随所属分屏组：纵向排列时是一条横着拖的分隔条，反之亦然 */
    orientation: SplitOrientation
    /** 分隔条前一个面板的当前占比。既用于无障碍播报，也是拖拽的起始值 */
    valueNow: number
    label?: string
    step?: number
  }>(),
  { label: '', step: 2 }
)

const emit = defineEmits<{
  /** 分隔条前一个面板的目标占比 */
  resize: [leadingRatio: number]
  /** 双击：恢复均分 */
  reset: []
}>()

const dragging = shallowRef(false)
/** 纵向排列 = 面板上下堆叠 = 分隔条沿垂直轴移动 */
const alongBlockAxis = computed(() => props.orientation === 'vertical')

let pointerId = -1
let origin = 0
let startRatio = 0
let containerSize = 0

/**
 * 可供面板按占比分配的尺寸。
 *
 * 要扣掉同级分隔条自身占的那几像素 —— 它们是 flex-none，不参与占比分配。
 * 直接用容器净高换算的话，拖得越远指针与分隔条的偏移累积得越明显。
 */
function measure(handle: HTMLElement): number {
  const parent = handle.parentElement
  if (!parent) return 0

  const vertical = alongBlockAxis.value
  const total = vertical ? parent.clientHeight : parent.clientWidth
  let occupied = 0
  for (const sibling of parent.querySelectorAll<HTMLElement>(
    ':scope > [role="separator"]'
  ))
    occupied += vertical ? sibling.offsetHeight : sibling.offsetWidth

  return Math.max(0, total - occupied)
}

function startDragging(event: PointerEvent): void {
  if (event.button !== 0) return

  const handle = event.currentTarget as HTMLElement
  containerSize = measure(handle)
  if (!containerSize) return

  pointerId = event.pointerId
  origin = alongBlockAxis.value ? event.clientY : event.clientX
  startRatio = props.valueNow
  dragging.value = true
  handle.setPointerCapture(pointerId)
  document.body.classList.add(
    alongBlockAxis.value ? 'app-resizing-rows' : 'app-resizing-columns'
  )
  event.preventDefault()
}

function drag(event: PointerEvent): void {
  if (!dragging.value || event.pointerId !== pointerId || !containerSize) return

  const current = alongBlockAxis.value ? event.clientY : event.clientX
  emit('resize', startRatio + ((current - origin) / containerSize) * 100)
}

function stopDragging(event?: PointerEvent): void {
  if (event && event.pointerId !== pointerId) return

  dragging.value = false
  pointerId = -1
  document.body.classList.remove('app-resizing-rows', 'app-resizing-columns')
}

function handleKeydown(event: KeyboardEvent): void {
  const back = alongBlockAxis.value ? 'ArrowUp' : 'ArrowLeft'
  const forward = alongBlockAxis.value ? 'ArrowDown' : 'ArrowRight'

  if (event.key === back) emit('resize', props.valueNow - props.step)
  else if (event.key === forward) emit('resize', props.valueNow + props.step)
  // 传越界值即可：布局引擎会夹到允许的下/上限，这里不必重复算边界
  else if (event.key === 'Home') emit('resize', 0)
  else if (event.key === 'End') emit('resize', 100)
  else return

  event.preventDefault()
}

onBeforeUnmount(() => {
  document.body.classList.remove('app-resizing-rows', 'app-resizing-columns')
})
</script>

<template>
  <div
    role="separator"
    tabindex="0"
    :aria-orientation="alongBlockAxis ? 'horizontal' : 'vertical'"
    :aria-label="label || t('调整分屏比例')"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="Math.round(valueNow)"
    :aria-valuetext="
      t('前一个面板占 {value0}%', { value0: Math.round(valueNow) })
    "
    :class="[
      'split-divider relative z-20 flex-none touch-none outline-none',
      alongBlockAxis
        ? 'is-block min-h-2.5 cursor-row-resize'
        : 'is-inline w-2.5 cursor-col-resize self-stretch',
      dragging && 'is-dragging',
    ]"
    :title="t('拖动调整分屏比例；双击均分')"
    @dblclick="emit('reset')"
    @keydown="handleKeydown"
    @pointerdown="startDragging"
    @pointermove="drag"
    @pointerup="stopDragging"
    @pointercancel="stopDragging"
    @lostpointercapture="stopDragging"
  >
    <span
      class="split-divider-line"
      aria-hidden="true"
      ><i
    /></span>
  </div>
</template>

<style scoped>
/* 线宽、发光与握把三者随 hover / focus / 拖拽联动，写成 utility 要堆十来个
   group-* 任意值，这里用 CSS 更直观 —— 与同目录的 AppResizeHandle 保持一致。 */
.split-divider-line {
  position: absolute;
  background: var(--color-line);
  transition:
    width 120ms ease,
    height 120ms ease,
    background-color 120ms ease,
    box-shadow 120ms ease;
}

.is-block .split-divider-line {
  top: 50%;
  right: 0;
  left: 0;
  height: 1px;
  transform: translateY(-50%);
}

.is-inline .split-divider-line {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
}

/* 居中握把：静止时隐身，让分屏看起来只有一条细线 */
.split-divider-line i {
  position: absolute;
  top: 50%;
  left: 50%;
  display: block;
  border: 1px solid var(--color-line-strong);
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-panel) 86%, transparent);
  opacity: 0;
  transform: translate(-50%, -50%);
  transition:
    opacity 120ms ease,
    border-color 120ms ease;
}

.is-block .split-divider-line i {
  width: 34px;
  height: 4px;
}

.is-inline .split-divider-line i {
  width: 4px;
  height: 34px;
}

.split-divider:hover .split-divider-line,
.split-divider:focus-visible .split-divider-line,
.split-divider.is-dragging .split-divider-line {
  background: var(--color-violet);
  box-shadow: 0 0 8px color-mix(in oklch, var(--color-violet) 52%, transparent);
}

.is-block:hover .split-divider-line,
.is-block:focus-visible .split-divider-line,
.is-block.is-dragging .split-divider-line {
  height: 2px;
}

.is-inline:hover .split-divider-line,
.is-inline:focus-visible .split-divider-line,
.is-inline.is-dragging .split-divider-line {
  width: 2px;
}

.split-divider:hover .split-divider-line i,
.split-divider:focus-visible .split-divider-line i,
.split-divider.is-dragging .split-divider-line i {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 10%);
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .split-divider-line,
  .split-divider-line i {
    transition: none;
  }
}
</style>
