<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, shallowRef, watch } from 'vue'
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import * as databaseApi from '@/api/database'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { DatabaseSelectionStats } from '@/composables/useDatabaseStatusBar'
import type { DatabaseSession } from '@/types/database'
import { cn } from '@/utils/cn'

/**
 * 数据库视图底部状态栏：连接、环境、当前库、服务器版本、延迟、运行中查询数与网格选区统计。
 * 延迟由周期 ping（SELECT 1）测得，窗口隐藏或未连接时暂停。
 */
const props = defineProps<{
  connectionName: string
  session: DatabaseSession | null
  connected: boolean
  /** 当前标签所在库；为空时回退到会话默认库 */
  database?: string
  runningQueries: number
  selection?: DatabaseSelectionStats | null
  /** 嵌入表格分页栏时省去独立底栏的边框和留白。 */
  embedded?: boolean
}>()

const { t } = useI18n()

/** 探活周期（毫秒） */
const PING_INTERVAL = 15_000

const latency = shallowRef<number | null>(null)
const pingFailed = shallowRef(false)
const visibility = useDocumentVisibility()
let pinging = false

/** 仅为可见且已连接的会话探测延迟，忽略会话切换后的旧响应。 */
async function ping(): Promise<void> {
  const id = props.session?.sessionId
  if (!props.connected || !id || pinging || visibility.value === 'hidden')
    return
  pinging = true
  try {
    const value = await databaseApi.ping(id)
    if (props.session?.sessionId !== id) return
    latency.value = value
    pingFailed.value = false
  } catch {
    if (props.session?.sessionId === id) pingFailed.value = true
  } finally {
    pinging = false
  }
}

const { pause, resume } = useIntervalFn(ping, PING_INTERVAL, {
  immediate: false,
})

// 连接、活动标签或窗口可见性变化时同步暂停和恢复探活。
watch(
  () => [props.connected, props.session?.sessionId, visibility.value] as const,
  ([connected, id, visible]) => {
    if (!connected || !id) {
      pause()
      latency.value = null
      pingFailed.value = false
      return
    }
    if (visible === 'hidden') return pause()
    resume()
    void ping()
  },
  { immediate: true }
)

const environment = computed(() => {
  const value = props.session?.environment
  if (value === 'production')
    return { label: t('生产环境'), class: 'bg-danger/12 text-danger' }
  if (value === 'testing')
    return { label: t('测试环境'), class: 'bg-amber/12 text-amber' }
  if (value === 'development')
    return { label: t('开发环境'), class: 'bg-success/12 text-success' }
  return null
})

const latencyText = computed(() => {
  if (pingFailed.value) return t('无响应')
  return latency.value === null ? '—' : `${latency.value} ms`
})

const latencyClass = computed(() => {
  if (pingFailed.value) return 'text-danger'
  const value = latency.value
  if (value === null) return 'text-txt-4'
  if (value < 80) return 'text-success'
  return value < 300 ? 'text-amber' : 'text-danger'
})

/** 格式化选区合计和平均值，限制小数位以免挤占状态栏。 */
function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
</script>

<template>
  <div
    :class="
      cn(
        'text-txt-3 flex min-w-0 items-center gap-2.5 overflow-hidden text-[10.5px] whitespace-nowrap select-none',
        embedded
          ? 'ml-auto justify-end'
          : 'border-line-soft bg-panel h-8 shrink-0 border-t px-2.5'
      )
    "
    role="status"
    :aria-label="t('数据库状态栏')"
  >
    <span
      class="flex min-w-0 shrink-0 items-center gap-1.5"
      :title="session?.endpoint"
    >
      <span
        :class="
          cn(
            'size-1.5 shrink-0 rounded-full',
            connected ? 'bg-success' : 'bg-txt-4'
          )
        "
        aria-hidden="true"
      />
      <span class="text-txt-2 max-w-40 truncate">{{ connectionName }}</span>
    </span>

    <span
      v-if="environment"
      :class="
        cn(
          'shrink-0 rounded px-1.5 py-px text-[10px] leading-4',
          environment.class
        )
      "
    >
      {{ environment.label }}
    </span>
    <span
      v-if="session?.readOnly"
      class="bg-txt-4/12 text-txt-3 flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[10px] leading-4"
    >
      <AppIcon
        name="lucide:lock"
        :size="9"
      />
      {{ t('只读') }}
    </span>

    <span
      v-if="database || session?.database"
      class="flex min-w-0 items-center gap-1"
      :title="t('当前数据库')"
    >
      <AppIcon
        name="lucide:layers-3"
        :size="11"
        class="text-txt-4 shrink-0"
      />
      <span class="max-w-36 truncate">{{ database || session?.database }}</span>
    </span>

    <span
      v-if="session?.serverVersion"
      class="text-txt-4 max-w-28 truncate font-mono"
      :title="t('服务器版本')"
    >
      {{ session.serverVersion }}
    </span>

    <span
      v-if="!embedded"
      class="min-w-0 flex-1"
    />

    <span
      v-if="selection && selection.cells > 0"
      class="flex shrink-0 items-center gap-2 font-mono"
    >
      <span>{{ t('已选 {count} 个单元格', { count: selection.cells }) }}</span>
      <span v-if="selection.rows">{{
        t('{count} 行', { count: selection.rows })
      }}</span>
      <span v-if="selection.sum !== undefined">
        {{ t('合计') }} {{ formatNumber(selection.sum) }}
      </span>
      <span v-if="selection.average !== undefined">
        {{ t('平均') }} {{ formatNumber(selection.average) }}
      </span>
    </span>
    <slot name="selection" />

    <span
      v-if="runningQueries > 0"
      class="text-accent flex shrink-0 items-center gap-1"
    >
      <AppIcon
        name="lucide:loader-circle"
        :size="11"
        class="motion-safe:animate-spin"
      />
      {{ t('{count} 个查询运行中', { count: runningQueries }) }}
    </span>

    <span
      v-if="connected"
      :class="cn('flex shrink-0 items-center gap-1 font-mono', latencyClass)"
      :title="t('连接延迟（每 15 秒探测一次）')"
    >
      <AppIcon
        name="lucide:activity"
        :size="11"
      />
      {{ latencyText }}
    </span>
  </div>
</template>
