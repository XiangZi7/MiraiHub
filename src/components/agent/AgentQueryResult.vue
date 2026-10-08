<script setup lang="ts">
import { computed, reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentQueryResult } from '@/types/agent'
import {
  chartGeometry,
  numericColumns,
  queryCsv,
} from '@/utils/agent-artifacts'
import AgentCopyButton from './AgentCopyButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
const props = defineProps<{ result: AgentQueryResult }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 当前结果视图
  view: 'line' as 'table' | 'line' | 'bar',
  // 横轴字段序号
  x: 0,
  // 纵轴字段序号，空值自动选择数值列
  y: '',
})
const { view, x, y } = toRefs(state)
const numeric = computed(() => numericColumns(props.result))
const selectedY = computed(() =>
  state.y === ''
    ? (numeric.value.find(index => index !== state.x) ?? numeric.value[0] ?? -1)
    : Number(state.y)
)
const canChart = computed(
  () => props.result.rows.length > 0 && numeric.value.includes(selectedY.value)
)
const geometry = computed(() =>
  chartGeometry(props.result, Number(state.x), selectedY.value)
)
const csv = computed(() => queryCsv(props.result))
const views = computed(() => [
  { value: 'table', label: t('表格'), icon: 'lucide:table-2' },
  {
    value: 'line',
    label: t('折线图'),
    icon: 'lucide:chart-line',
    disabled: !canChart.value,
  },
  {
    value: 'bar',
    label: t('柱状图'),
    icon: 'lucide:chart-column',
    disabled: !canChart.value,
  },
])
const xModel = computed({
  get: () => String(state.x),
  set: (value: string) => (state.x = Number(value)),
})
const xOptions = computed(() =>
  props.result.columns.map((label, index) => ({ value: String(index), label }))
)
const yOptions = computed(() => [
  { value: '', label: t('自动') },
  ...numeric.value.map(index => ({
    value: String(index),
    label: props.result.columns[index] ?? '',
  })),
])
</script>
<template>
  <section
    class="query-result"
    :aria-label="t('查询结果图表')"
  >
    <header>
      <strong>{{ t('查询结果') }}</strong
      ><span
        >{{ result.rows.length }} {{ t('行') }} ·
        {{ result.elapsedMs }} ms</span
      >
    </header>
    <p
      v-if="result.error"
      class="query-error"
    >
      {{ result.error }}
    </p>
    <template v-else>
      <div class="query-controls">
        <AppSelect
          v-model="view"
          class="query-view"
          :label="t('视图')"
          :options="views"
          compact
          hide-label
        />
        <template v-if="canChart && view !== 'table'">
          <div class="query-axis">
            <span aria-hidden="true">X</span>
            <AppSelect
              v-model="xModel"
              class="min-w-0 flex-1"
              :label="t('横轴字段')"
              :options="xOptions"
              compact
              hide-label
            />
          </div>
          <div class="query-axis">
            <span aria-hidden="true">Y</span>
            <AppSelect
              v-model="y"
              class="min-w-0 flex-1"
              :label="t('纵轴字段')"
              :options="yOptions"
              compact
              hide-label
            />
          </div>
        </template>
      </div>
      <svg
        v-if="canChart && view !== 'table'"
        class="query-chart"
        viewBox="0 0 440 220"
        role="img"
        :aria-label="`${result.columns[Number(x)]} / ${result.columns[selectedY]}`"
      >
        <title>{{ result.columns[selectedY] }}</title>
        <line
          x1="44"
          x2="396"
          :y1="geometry.baseline"
          :y2="geometry.baseline"
          class="chart-axis"
        />
        <text
          x="40"
          y="30"
          text-anchor="end"
        >
          {{ geometry.max }}
        </text>
        <text
          x="40"
          y="185"
          text-anchor="end"
        >
          {{ geometry.min }}
        </text>
        <path
          v-if="view === 'line'"
          :d="geometry.path"
          class="chart-line"
        />
        <template
          v-for="(point, index) in geometry.points"
          :key="index"
        >
          <template v-if="point.y !== null">
            <circle
              v-if="view === 'line'"
              :cx="point.x"
              :cy="point.y"
              r="3"
              class="chart-point"
            >
              <title>{{ point.label }}: {{ point.value }}</title>
            </circle>
            <rect
              v-else
              :x="point.x - geometry.barWidth / 2"
              :y="Math.min(point.y, geometry.baseline)"
              :width="geometry.barWidth"
              :height="Math.max(1, Math.abs(point.y - geometry.baseline))"
              rx="2"
              class="chart-point"
            >
              <title>{{ point.label }}: {{ point.value }}</title>
            </rect>
          </template>
        </template>
        <text
          x="44"
          y="208"
        >
          {{ geometry.points[0]?.label.slice(0, 24) }}
        </text>
        <text
          x="396"
          y="208"
          text-anchor="end"
        >
          {{ geometry.points.at(-1)?.label.slice(0, 24) }}
        </text>
      </svg>
      <details :open="view === 'table' || !canChart">
        <summary>{{ t('查看数据表') }}</summary>
        <div
          class="query-table"
          tabindex="0"
        >
          <table>
            <thead>
              <tr>
                <th
                  v-for="(column, index) in result.columns"
                  :key="index"
                >
                  {{ column }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in result.rows"
                :key="index"
              >
                <td
                  v-for="(cell, column) in row"
                  :key="column"
                >
                  {{ cell === null ? 'NULL' : cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <div class="query-footer">
        <p class="query-caption">
          {{
            result.truncated
              ? t('部分查询结果，图表仅包含返回的行。')
              : t('图表基于返回数据，按查询结果顺序展示；NULL 不作为零。')
          }}
        </p>
        <AgentCopyButton
          :text="csv"
          :label="t('复制 CSV')"
        />
      </div>
    </template>
  </section>
</template>
<style scoped>
.query-result {
  --query-accent: var(--agent-color, var(--color-accent));
  border: 1px solid var(--color-line);
  border-radius: 10px;
  margin-top: 10px;
  padding: 10px;
  background: var(--color-card);
  min-width: 0;
}
header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--agent-body-font, 12px);
}
header strong {
  font-weight: 500;
}
header span {
  color: var(--color-txt-3);
  font-size: 11px;
  white-space: nowrap;
}
.query-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
  font-size: 11px;
}
.query-view {
  width: 96px;
  flex: none;
}
.query-axis {
  display: flex;
  flex: 1 1 112px;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--color-txt-3);
}
.query-chart {
  display: block;
  width: 100%;
  height: auto;
  max-height: 220px;
  margin-top: 10px;
  overflow: visible;
}
.query-chart text {
  fill: var(--color-txt-3);
  font-size: 10px;
  font-family: var(--font-mono);
}
.chart-axis {
  stroke: var(--color-line);
}
.chart-line {
  fill: none;
  stroke: var(--query-accent);
  stroke-width: 2;
}
.chart-point {
  fill: var(--query-accent);
}
summary {
  cursor: pointer;
  font-size: 11px;
  padding: 8px 0;
  color: var(--color-txt-2);
}
.query-table {
  overflow: auto;
  max-height: 240px;
  scrollbar-width: thin;
}
table {
  border-collapse: collapse;
  font-size: 11px;
  min-width: 100%;
}
th,
td {
  text-align: left;
  padding: 7px;
  border-bottom: 1px solid var(--color-line);
  white-space: pre;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}
th {
  font-weight: 500;
  color: var(--color-txt-3);
}
.query-caption {
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-txt-3);
  margin: 0;
}
.query-error {
  color: var(--color-danger);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.query-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 6px;
}
.query-table:focus-visible {
  outline: 1px solid var(--query-accent);
}
</style>
