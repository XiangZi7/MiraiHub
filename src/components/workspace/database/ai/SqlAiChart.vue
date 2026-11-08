<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DatabaseStatementResult } from '@/types/database'
import type { SqlAiChartSpec } from '@/utils/sql-ai'

const props = defineProps<{
  spec: SqlAiChartSpec
  statement: DatabaseStatementResult
}>()

const { t } = useI18n()
const WIDTH = 560
const HEIGHT = 200
const LEFT = 44
const BOTTOM = 22
const TOP = 8
const PLOT_WIDTH = WIDTH - LEFT - 4
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM
// 经校验的分类色板，按系列固定顺序分配，颜色跟随系列而非排名。
// 具体色值在 figure 上按明暗分别定义：浅色面板上青、黄两色加深，保证对背景 >= 3:1。
const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
]

const data = computed(() => {
  const names = props.statement.columns.map(column => column.name)
  const xIndex = names.indexOf(props.spec.x)
  const rows = props.statement.rows.slice(
    0,
    props.spec.type === 'bar' ? 30 : 200
  )
  const series = props.spec.y.map((name, order) => {
    const index = names.indexOf(name)
    return {
      name,
      color: COLORS[order]!,
      values: rows.map(row => {
        const raw = row[index]
        const value = raw === null || raw === undefined ? NaN : Number(raw)
        return Number.isFinite(value) ? value : null
      }),
    }
  })
  return {
    labels: rows.map(row => row[xIndex] ?? 'NULL'),
    series: series.filter(item => item.values.some(value => value !== null)),
  }
})
const range = computed(() => {
  const values = data.value.series.flatMap(item =>
    item.values.filter((value): value is number => value !== null)
  )
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  return { min, max: max === min ? min + 1 : max }
})
const step = computed(() => PLOT_WIDTH / Math.max(1, data.value.labels.length))
const ticks = computed(() => {
  const { min, max } = range.value
  return [min, (min + max) / 2, max]
})
const barWidth = computed(() =>
  Math.max(
    1,
    Math.min(28, (step.value - 4) / Math.max(1, data.value.series.length) - 2)
  )
)
const hovered = shallowRef<number | null>(null)
const readout = computed(() => {
  const index = hovered.value
  if (index === null) return ''
  const values = data.value.series.map(
    item => `${item.name}: ${item.values[index] ?? 'NULL'}`
  )
  return `${data.value.labels[index]} · ${values.join(' · ')}`
})
const lastIndex = computed(() => data.value.labels.length - 1)

/** 把数值映射成 SVG 纵坐标。 */
function yOf(value: number): number {
  const { min, max } = range.value
  return TOP + PLOT_HEIGHT * (1 - (value - min) / (max - min))
}

/** 第 index 个类目的中心横坐标。 */
function xOf(index: number): number {
  return LEFT + step.value * (index + 0.5)
}

/** 第 order 个系列在第 index 个类目上的柱子左边。 */
function barX(index: number, order: number): number {
  const group = (barWidth.value + 2) * data.value.series.length
  return xOf(index) - group / 2 + order * (barWidth.value + 2)
}

/** 生成折线路径；空值处断开，不伪造连续趋势。 */
function linePath(values: Array<number | null>): string {
  let path = ''
  let open = false
  values.forEach((value, index) => {
    if (value === null) {
      open = false
      return
    }
    path += `${open ? 'L' : 'M'}${xOf(index)} ${yOf(value)}`
    open = true
  })
  return path
}

/** 紧凑显示坐标轴刻度。 */
function format(value: number): string {
  return Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}
</script>

<template>
  <figure
    v-if="data.series.length && data.labels.length"
    class="m-0 flex flex-col gap-1 [--chart-1:#3987e5] [--chart-2:#d95926] [--chart-3:#199e70] [--chart-4:#c98500] [html[data-skin-scheme=light]_&]:[--chart-1:#2a78d6] [html[data-skin-scheme=light]_&]:[--chart-3:#17946a] [html[data-skin-scheme=light]_&]:[--chart-4:#a87400]"
  >
    <figcaption class="text-txt-2 text-[11px] font-medium">
      {{ spec.title || t('推荐图表') }}
    </figcaption>
    <div
      v-if="data.series.length > 1"
      class="text-txt-3 flex flex-wrap gap-3 text-[10px]"
    >
      <span
        v-for="item in data.series"
        :key="item.name"
        class="flex items-center gap-1"
      >
        <i
          class="size-2 rounded-full"
          :style="{ background: item.color }"
        />{{ item.name }}
      </span>
    </div>
    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      class="w-full"
      role="img"
      :aria-label="spec.title || t('推荐图表')"
      @pointerleave="hovered = null"
    >
      <g
        v-for="tick in ticks"
        :key="tick"
      >
        <line
          :x1="LEFT"
          :x2="WIDTH - 4"
          :y1="yOf(tick)"
          :y2="yOf(tick)"
          class="stroke-line-soft"
        />
        <text
          :x="LEFT - 6"
          :y="yOf(tick) + 3"
          text-anchor="end"
          class="fill-txt-4 text-[9px]"
        >
          {{ format(tick) }}
        </text>
      </g>
      <template v-if="spec.type === 'bar'">
        <template
          v-for="(item, order) in data.series"
          :key="item.name"
        >
          <template
            v-for="(value, index) in item.values"
            :key="index"
          >
            <rect
              v-if="value !== null"
              :x="barX(index, order)"
              :y="Math.min(yOf(value), yOf(0))"
              :width="barWidth"
              :height="Math.max(1, Math.abs(yOf(value) - yOf(0)))"
              rx="2"
              :style="{ fill: item.color }"
              :opacity="hovered === null || hovered === index ? 1 : 0.55"
            />
          </template>
        </template>
      </template>
      <template v-else>
        <line
          v-if="hovered !== null"
          :x1="xOf(hovered)"
          :x2="xOf(hovered)"
          :y1="TOP"
          :y2="TOP + PLOT_HEIGHT"
          class="stroke-line-strong"
        />
        <path
          v-for="item in data.series"
          :key="item.name"
          :d="linePath(item.values)"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          :style="{ stroke: item.color }"
        />
      </template>
      <text
        :x="LEFT"
        :y="HEIGHT - 6"
        class="fill-txt-4 text-[9px]"
      >
        {{ data.labels[0]?.slice(0, 24) }}
      </text>
      <text
        v-if="lastIndex > 0"
        :x="WIDTH - 4"
        :y="HEIGHT - 6"
        text-anchor="end"
        class="fill-txt-4 text-[9px]"
      >
        {{ data.labels[lastIndex]?.slice(0, 24) }}
      </text>
      <rect
        v-for="(_, index) in data.labels"
        :key="index"
        :x="LEFT + step * index"
        :y="TOP"
        :width="step"
        :height="PLOT_HEIGHT"
        fill="transparent"
        @pointerenter="hovered = index"
      />
    </svg>
    <p
      class="text-txt-3 h-4 truncate font-mono text-[10px]"
      aria-live="polite"
    >
      {{ readout }}
    </p>
  </figure>
</template>
