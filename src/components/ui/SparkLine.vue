<script setup lang="ts">
import { computed, useId } from 'vue'
import { sparklineGeometry } from '@/utils/sparkline'

const props = withDefaults(
  defineProps<{
    data: number[]
    color?: string
    height?: number
  }>(),
  { color: 'var(--color-accent)', height: 34 }
)
const gradientId = useId()
const geometry = computed(() => sparklineGeometry(props.data))
</script>

<template>
  <svg
    class="sparkline"
    :style="{ height: `${height}px`, color }"
    viewBox="0 0 300 100"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
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
