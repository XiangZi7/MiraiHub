<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue'
import { sparklineGeometry } from '@/utils/sparkline'

const props = withDefaults(
  defineProps<{
    data: number[]
    color?: string
    height?: number
  }>(),
  { color: 'var(--color-accent)', height: 34 }
)
const hoverIndex = shallowRef(-1)
const hoverValue = computed(() => props.data[hoverIndex.value])
/** 悬停时定位最接近的采样点，数值取自真实历史数据。 */
function hover(event: PointerEvent): void {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  hoverIndex.value = Math.max(
    0,
    Math.min(
      props.data.length - 1,
      Math.round(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) *
          (props.data.length - 1)
      )
    )
  )
}
const gradientId = useId()
const geometry = computed(() => sparklineGeometry(props.data))
</script>

<template>
  <svg
    class="sparkline"
    :style="{ height: `${height}px`, color }"
    viewBox="0 0 300 100"
    preserveAspectRatio="none"
    role="img"
    :aria-label="data.length ? String(data.at(-1)) : undefined"
    @pointermove="hover"
    @pointerleave="hoverIndex = -1"
  >
    <text
      v-if="hoverValue != null"
      x="150"
      y="24"
      text-anchor="middle"
      fill="currentColor"
      font-size="22"
    >
      {{ hoverValue.toFixed(1) }}
    </text>
    <defs>
      <linearGradient
        :id="gradientId"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0%"
          stop-color="currentColor"
          stop-opacity="0.3"
        />
        <stop
          offset="100%"
          stop-color="currentColor"
          stop-opacity="0"
        />
      </linearGradient>
    </defs>
    <path
      :d="geometry.area"
      :fill="`url(#${gradientId})`"
    />
    <path
      :d="geometry.line"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<style scoped>
.sparkline {
  display: block;
  width: 100%;
  overflow: hidden;
}
</style>
