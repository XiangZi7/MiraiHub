<script setup lang="ts">
import { computed, onScopeDispose, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SparkLine from '@/components/ui/SparkLine.vue'
import RedisSlowlogPanel from './RedisSlowlogPanel.vue'
import * as redis from '@/api/redis'
import { formatBytes, formatUptime } from '@/utils/format'
import type { RedisInfoSection } from '@/types/redis'

const props = defineProps<{ sessionId: string; active: boolean }>()
const { t } = useI18n()
/** 图表保留的采样点数。 */
const HISTORY = 60
interface Sample {
  memory: number
  ops: number
  clients: number
  hits: number
  misses: number
}
// 响应式状态
const state = reactive({
  view: 'overview' as 'overview' | 'slowlog',
  sections: [] as RedisInfoSection[],
  loading: false,
  error: '',
  // 自动刷新间隔（秒），0 为关闭
  interval: '5',
  // 原始 INFO 过滤
  filter: '',
  // 最近的采样，用于小图表和区间命中率
  samples: [] as Sample[],
  updatedAt: 0,
})
const { view, sections, loading, error, interval, filter, samples } =
  toRefs(state)
const intervals = computed(() => [
  { value: '0', label: t('不自动刷新') },
  { value: '2', label: '2s' },
  { value: '5', label: '5s' },
  { value: '10', label: '10s' },
  { value: '30', label: '30s' },
])
const values = computed(
  () => new Map(state.sections.flatMap(section => section.entries))
)
function num(key: string) {
  const value = Number(values.value.get(key))
  return Number.isFinite(value) ? value : 0
}
const hitRate = computed(() => {
  const hits = num('keyspace_hits')
  const total = hits + num('keyspace_misses')
  return total ? (hits / total) * 100 : null
})
/** 相邻采样之间的命中率；无访问的区间沿用上一点。 */
const hitRateSeries = computed(() => {
  const series: number[] = []
  for (let i = 1; i < state.samples.length; i++) {
    const prev = state.samples[i - 1]!
    const cur = state.samples[i]!
    const hits = cur.hits - prev.hits
    const total = hits + cur.misses - prev.misses
    series.push(total > 0 ? (hits / total) * 100 : (series.at(-1) ?? 100))
  }
  return series
})
const keyspace = computed(() =>
  (
    state.sections.find(section => section.name === 'Keyspace')?.entries ?? []
  ).map(([db, raw]) => {
    const fields = Object.fromEntries(
      raw.split(',').map(pair => pair.split('=') as [string, string])
    )
    return {
      db,
      keys: Number(fields.keys ?? 0),
      expires: Number(fields.expires ?? 0),
      avgTtl: Number(fields.avg_ttl ?? 0),
    }
  })
)
const cards = computed(() => {
  const maxmemory = num('maxmemory')
  return [
    {
      label: t('已用内存'),
      value: formatBytes(num('used_memory')),
      hint:
        t('峰值 {value}', { value: formatBytes(num('used_memory_peak')) }) +
        (maxmemory ? ' · ' + t('上限 {value}', { value: formatBytes(maxmemory) }) : ''),
      series: state.samples.map(sample => sample.memory / 1048576),
      color: 'var(--color-accent)',
    },
    {
      label: t('客户端'),
      value: String(num('connected_clients')),
      hint: t('阻塞 {count}', { count: num('blocked_clients') }),
      series: state.samples.map(sample => sample.clients),
      color: 'var(--color-success)',
    },
    {
      label: t('每秒操作数'),
      value: String(num('instantaneous_ops_per_sec')),
      hint:
        t('入 {value}', { value: num('instantaneous_input_kbps').toFixed(1) + ' KB/s' }) +
        ' · ' +
        t('出 {value}', { value: num('instantaneous_output_kbps').toFixed(1) + ' KB/s' }),
      series: state.samples.map(sample => sample.ops),
      color: 'var(--color-amber)',
    },
    {
      label: t('命中率'),
      value: hitRate.value == null ? '—' : hitRate.value.toFixed(1) + '%',
      hint: t('命中 {hits} / 未命中 {misses}', {
        hits: num('keyspace_hits'),
        misses: num('keyspace_misses'),
      }),
      series: hitRateSeries.value,
      color: 'var(--color-pink)',
    },
  ]
})
const server = computed(() =>
  [
    ['Redis', values.value.get('redis_version')],
    [t('模式'), values.value.get('redis_mode')],
    [t('角色'), values.value.get('role')],
    [t('运行时长'), formatUptime(num('uptime_in_seconds'))],
    [t('淘汰策略'), values.value.get('maxmemory_policy')],
    [t('碎片率'), values.value.get('mem_fragmentation_ratio')],
    [t('已淘汰键'), values.value.get('evicted_keys')],
    [t('已过期键'), values.value.get('expired_keys')],
  ].filter((entry): entry is [string, string] => !!entry[1])
)
const filtered = computed(() => {
  const query = state.filter.trim().toLowerCase()
  return state.sections
    .map(section => ({
      name: section.name,
      entries: query
        ? section.entries.filter(([key, value]) =>
            (key + ':' + value).toLowerCase().includes(query)
          )
        : section.entries,
    }))
    .filter(section => section.entries.length)
})
async function refresh() {
  if (state.loading || !props.sessionId) return
  state.loading = true
  try {
    state.sections = await redis.serverInfo(props.sessionId)
    state.error = ''
    state.updatedAt = Date.now()
    state.samples = [
      ...state.samples,
      {
        memory: num('used_memory'),
        ops: num('instantaneous_ops_per_sec'),
        clients: num('connected_clients'),
        hits: num('keyspace_hits'),
        misses: num('keyspace_misses'),
      },
    ].slice(-HISTORY)
  } catch (err) {
    state.error = redis.errorMessage(err)
  } finally {
    state.loading = false
  }
}
let timer: ReturnType<typeof setInterval> | undefined
function schedule() {
  clearInterval(timer)
  timer = undefined
  const seconds = Number(state.interval)
  // 面板不可见时暂停轮询，避免占用会话连接。
  if (props.active && state.view === 'overview' && seconds > 0)
    timer = setInterval(refresh, seconds * 1000)
}
watch(
  () => props.sessionId,
  () => {
    state.samples = []
    state.sections = []
  }
)
watch(
  () => [props.active, props.sessionId, state.view] as const,
  ([active]) => {
    if (active && state.view === 'overview') void refresh()
    schedule()
  },
  { immediate: true }
)
watch(interval, schedule)
onScopeDispose(() => clearInterval(timer))
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    :aria-label="t('服务器状态')"
  >
    <header
      class="border-line-soft flex h-9 shrink-0 items-center gap-2 border-b px-2 text-[11px]"
    >
      <div
        class="flex items-center gap-0.5"
        role="tablist"
      >
        <button
          v-for="item in [
            { id: 'overview', label: t('概览') },
            { id: 'slowlog', label: t('慢日志') },
          ] as const"
          :key="item.id"
          type="button"
          role="tab"
          :aria-selected="view === item.id"
          class="rounded px-2.5 py-1 motion-safe:transition-colors"
          :class="
            view === item.id
              ? 'bg-raised text-txt'
              : 'text-txt-3 hover:text-txt-2'
          "
          @click="view = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <template v-if="view === 'overview'">
        <span
          v-if="state.updatedAt"
          class="text-txt-4 ml-auto text-[10px]"
          >{{ new Date(state.updatedAt).toLocaleTimeString() }}</span
        >
        <AppSelect
          v-model="interval"
          class="w-28 shrink-0"
          :class="!state.updatedAt && 'ml-auto'"
          :label="t('自动刷新')"
          :options="intervals"
          compact
          hide-label
        />
        <IconButton
          icon="lucide:refresh-cw"
          :size="13"
          :class="loading && '[&_svg]:motion-safe:animate-spin'"
          :title="t('刷新')"
          :aria-label="t('刷新')"
          :disabled="loading"
          @click="refresh"
        />
      </template>
    </header>
    <RedisSlowlogPanel
      v-if="view === 'slowlog'"
      :session-id="sessionId"
    />
    <div
      v-else
      class="scroll-thin min-h-0 flex-1 overflow-auto p-3"
    >
      <p
        v-if="error"
        class="text-danger mb-3 text-[11px]"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        <article
          v-for="card in cards"
          :key="card.label"
          class="border-line-soft bg-panel rounded-lg border px-3 pt-2.5 pb-1.5"
        >
          <div class="text-txt-3 text-[10px]">{{ card.label }}</div>
          <div class="text-txt mt-0.5 font-mono text-base tabular-nums">
            {{ card.value }}
          </div>
          <div
            class="text-txt-4 truncate text-[10px]"
            :title="card.hint"
          >
            {{ card.hint }}
          </div>
          <SparkLine
            class="mt-1.5"
            :data="card.series.length > 1 ? card.series : [0, 0]"
            :color="card.color"
            :height="28"
          />
        </article>
      </div>
      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        <div class="border-line-soft rounded-lg border">
          <h3
            class="border-line-soft text-txt-3 border-b px-3 py-1.5 text-[11px]"
          >
            {{ t('服务器') }}
          </h3>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 py-2 text-[11px]">
            <template
              v-for="[label, value] in server"
              :key="label"
            >
              <dt class="text-txt-4">{{ label }}</dt>
              <dd class="text-txt-2 truncate font-mono">{{ value }}</dd>
            </template>
          </dl>
        </div>
        <div class="border-line-soft rounded-lg border">
          <h3
            class="border-line-soft text-txt-3 border-b px-3 py-1.5 text-[11px]"
          >
            Keyspace
          </h3>
          <table class="w-full border-collapse text-[11px]">
            <thead class="text-txt-4">
              <tr class="text-left">
                <th class="px-3 py-1 font-normal">DB</th>
                <th class="px-3 py-1 text-right font-normal">
                  {{ t('键数') }}
                </th>
                <th class="px-3 py-1 text-right font-normal">
                  {{ t('有过期时间') }}
                </th>
                <th class="px-3 py-1 text-right font-normal">
                  {{ t('平均 TTL') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in keyspace"
                :key="row.db"
                class="border-line-soft text-txt-2 border-t font-mono tabular-nums"
              >
                <td class="px-3 py-1">{{ row.db }}</td>
                <td class="px-3 py-1 text-right">{{ row.keys }}</td>
                <td class="px-3 py-1 text-right">{{ row.expires }}</td>
                <td class="px-3 py-1 text-right">
                  {{ row.avgTtl ? Math.round(row.avgTtl / 1000) + 's' : '—' }}
                </td>
              </tr>
              <tr v-if="!keyspace.length">
                <td
                  colspan="4"
                  class="text-txt-4 px-3 py-2 text-center"
                >
                  {{ t('没有键') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="border-line-soft mt-3 rounded-lg border">
        <div
          class="border-line-soft flex items-center gap-2 border-b px-3 py-1.5"
        >
          <h3 class="text-txt-3 text-[11px]">{{ t('全部指标') }}</h3>
          <AppInput
            v-model="filter"
            size="sm"
            monospace
            class="ml-auto w-48"
            :aria-label="t('过滤指标')"
            :placeholder="t('过滤指标')"
            spellcheck="false"
          />
        </div>
        <div
          v-for="section in filtered"
          :key="section.name"
          class="border-line-soft border-b last:border-b-0"
        >
          <h4 class="text-txt-3 flex items-center gap-1 px-3 pt-2 text-[10px]">
            <AppIcon
              name="lucide:hash"
              :size="10"
            />{{ section.name || 'INFO' }}
          </h4>
          <dl
            class="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-4 px-3 py-1.5 font-mono text-[11px]"
          >
            <template
              v-for="[key, value] in section.entries"
              :key="key"
            >
              <dt
                class="text-txt-4 truncate"
                :title="key"
              >
                {{ key }}
              </dt>
              <dd class="text-txt-2 break-all">{{ value }}</dd>
            </template>
          </dl>
        </div>
      </div>
    </div>
  </section>
</template>
