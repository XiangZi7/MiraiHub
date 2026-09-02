<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { init, use, type ECharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { rgba } from '@/utils/color'

// 按需注册，避免把整个 echarts 打进产物
use([LineChart, GridComponent, CanvasRenderer])

const props = withDefaults(defineProps<{
  /** 数据点，值域任意，由 ECharts 自行归一化 */
  data: number[]
  /** 线条与渐变颜色，接受任意 CSS 颜色（含 var()） */
  color?: string
  /** 图表高度 */
  height?: number
}>(), {
  color: 'var(--color-accent)',
  height: 34,
})

const el = useTemplateRef<HTMLDivElement>('el')
// 图表实例不需要深层响应式，用 shallowRef 免去 ECharts 内部对象被代理的开销
const chart = shallowRef<ECharts>()

function render(): void {
  if (!chart.value)
    return

  chart.value.setOption({
    animation: false,
    // 铺满容器，只在顶部留一点，避免线条顶到卡片文字
    grid: { left: 0, right: 0, top: 3, bottom: 0 },
    xAxis: { type: 'category', show: false, boundaryGap: false },
    yAxis: {
      type: 'value',
      show: false,
      // 上下各留 25% 余量，曲线才不会贴边被裁
      min: (v: { min: number, max: number }) => v.min - (v.max - v.min) * 0.25,
      max: (v: { min: number, max: number }) => v.max + (v.max - v.min) * 0.25,
    },
    series: [{
      type: 'line',
      data: props.data,
      smooth: 0.35,
      symbol: 'none',
      lineStyle: { width: 1.6, color: rgba(props.color, 1) },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: rgba(props.color, 0.32) },
            { offset: 1, color: rgba(props.color, 0) },
          ],
        },
      },
    }],
  })
}

onMounted(() => {
  if (!el.value)
    return

  chart.value = init(el.value, undefined, { renderer: 'canvas' })
  render()
})

// 卡片宽度随窗口变化，图表要跟着重算
useResizeObserver(el, () => chart.value?.resize())

watch(() => [props.data, props.color], render, { deep: true })

onBeforeUnmount(() => {
  chart.value?.dispose()
  chart.value = undefined
})
</script>

<template>
  <div ref="el" class="w-full" :style="{ height: `${height}px` }" />
</template>
