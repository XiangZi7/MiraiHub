<script setup lang="ts">
import { computed, toRef } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SparkLine from '@/components/ui/SparkLine.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useSystemStats } from '@/composables/useSystemStats'
import { QUICK_ACTIONS } from '@/constants/workspace'
import type { SavedConnection } from '@/types/connection'
import { formatRate, formatUptime, percent, splitKb } from '@/utils/format'

/**
 * 服务器概览。
 * 指标每 5 秒从远端采一次（见 useSystemStats），
 * 曲线画的是本次会话内的采样历史，不是伪造的波形。
 */

const props = defineProps<{
  connection?: SavedConnection
  /** 后端 SSH 会话 id，未连上时为空串 */
  sessionId: string
}>()

const { stats, loading, error, history, ready } = useSystemStats(toRef(props, 'sessionId'))

/** 是否已连上。没连上就没有指标可言，展示引导而不是一排 0 */
const connected = computed(() => Boolean(props.sessionId))

/**
 * 指标卡数据。
 *
 * 每张卡的主值形状不同（CPU 是百分比、内存磁盘是用量/总量、网络是双向速率），
 * 所以在这里统一整形，模板只负责摆放。
 */
const cards = computed(() => {
  const snapshot = stats.value
  if (!snapshot)
    return []

  const { cpu, memory, disk, network } = snapshot
  const mem = splitKb(memory.usedKb)
  const memTotal = splitKb(memory.totalKb)
  const diskUsed = splitKb(disk.usedKb)
  const diskTotal = splitKb(disk.totalKb)

  return [
    {
      id: 'cpu',
      label: 'CPU',
      value: `${cpu.usage.toFixed(0)}%`,
      caption: `${cpu.cores} 核 · 负载 ${cpu.load[0].toFixed(2)}`,
      color: 'var(--color-blue)',
      trend: history.value.cpu,
    },
    {
      id: 'memory',
      label: 'Memory',
      value: mem.value,
      suffix: `${mem.unit} / ${memTotal.value} ${memTotal.unit}`,
      caption: percent(memory.usedKb, memory.totalKb),
      color: 'var(--color-violet)',
      trend: history.value.memory,
    },
    {
      id: 'disk',
      label: 'Disk',
      value: diskUsed.value,
      suffix: `${diskUsed.unit} / ${diskTotal.value} ${diskTotal.unit}`,
      caption: percent(disk.usedKb, disk.totalKb),
      color: 'var(--color-accent)',
      trend: history.value.disk,
    },
    {
      id: 'network',
      label: 'Network',
      down: formatRate(network.rxBytesPerSec),
      up: formatRate(network.txBytesPerSec),
      color: 'var(--color-cyan)',
      trend: history.value.network,
    },
  ]
})

/** 副标题：地址 + 系统版本 */
const subtitle = computed(() => {
  const parts = [
    props.connection ? `${props.connection.host}:${props.connection.port}` : '',
    stats.value?.os ?? '',
  ].filter(Boolean)

  return parts.join(' · ') || '未连接'
})

/** 系统信息列表，连上后才有 */
const facts = computed(() => {
  const snapshot = stats.value
  if (!snapshot)
    return []

  return [
    { label: 'Hostname', value: snapshot.hostname || '—' },
    { label: 'Kernel', value: snapshot.kernel || '—' },
    { label: 'Architecture', value: snapshot.arch || '—' },
    { label: 'Uptime', value: formatUptime(snapshot.uptimeSecs) },
    { label: 'CPU', value: snapshot.cpu.model || '—' },
    { label: 'Online users', value: String(snapshot.onlineUsers) },
  ]
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
    <!-- 服务器概要 -->
    <header class="mb-5 flex items-start gap-4">
      <div
        class="grid size-[74px] shrink-0 place-items-center rounded-2xl border border-violet/25 text-violet"
        style="background: linear-gradient(150deg, color-mix(in oklch, var(--color-violet) 22%, transparent), color-mix(in oklch, var(--color-indigo) 10%, transparent))"
      >
        <AppIcon name="lucide:server" :size="34" />
      </div>

      <div class="min-w-0 flex-1 pt-1">
        <h1 class="truncate text-[19px] font-semibold leading-tight tracking-tight text-txt">
          {{ connection?.name ?? '未选择服务器' }}
        </h1>
        <p
          class="mt-1.5 flex items-center gap-1.5 text-xs"
          :class="connected ? 'text-accent' : 'text-txt-3'"
        >
          <StatusDot :tone="connected ? 'accent' : 'txt-3'" :size="6" :glow="connected" />
          <span>{{ connected ? 'Online' : 'Offline' }}</span>
        </p>
        <p class="mt-1.5 truncate text-xs text-txt-3" :title="subtitle">
          {{ subtitle }}
        </p>
      </div>

      <IconButton icon="lucide:ellipsis" title="更多" />
    </header>

    <!-- 采集失败：给出原因，别让曲线停着不动却不说为什么 -->
    <p
      v-if="error"
      class="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger"
    >
      采集系统信息失败：{{ error }}
    </p>

    <!-- 资源指标 -->
    <div v-if="ready" class="mb-6 grid grid-cols-4 gap-2.5">
      <article
        v-for="card in cards"
        :key="card.id"
        class="card overflow-hidden"
      >
        <div class="px-3 pb-2 pt-2.5">
          <p class="text-[11px] text-txt-3">
            {{ card.label }}
          </p>

          <!-- 网络卡：上下行双行 -->
          <template v-if="card.id === 'network'">
            <p class="mt-1.5 flex items-center gap-1 text-[13px] font-medium text-txt">
              <AppIcon name="lucide:arrow-down" :size="12" class="text-accent" />
              <span class="truncate">{{ card.down }}</span>
            </p>
            <p class="mt-1 flex items-center gap-1 text-[13px] font-medium text-txt">
              <AppIcon name="lucide:arrow-up" :size="12" class="text-cyan" />
              <span class="truncate">{{ card.up }}</span>
            </p>
          </template>

          <!-- 常规卡：主值 + 占比 -->
          <template v-else>
            <p class="mt-1 flex items-baseline gap-1">
              <span class="text-[21px] font-semibold leading-none tracking-tight text-txt">{{ card.value }}</span>
              <span v-if="card.suffix" class="truncate text-[11px] text-txt-3">{{ card.suffix }}</span>
            </p>
            <p class="mt-1.5 truncate text-[11px] text-txt-3" :title="card.caption">
              {{ card.caption }}
            </p>
          </template>
        </div>

        <SparkLine :data="card.trend" :color="card.color" :height="44" />
      </article>
    </div>

    <!-- 首次采集中 -->
    <div v-else-if="loading" class="mb-6 grid grid-cols-4 gap-2.5">
      <div v-for="i in 4" :key="i" class="card h-26 animate-pulse bg-raised/40" />
    </div>

    <!-- 没连上 -->
    <div v-else-if="!connected" class="mb-6 rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <p class="text-xs text-txt-3">
        连上服务器后，这里会显示实时的 CPU、内存、磁盘与网络
      </p>
    </div>

    <!-- 快捷操作 -->
    <section class="mb-6">
      <h2 class="mb-2.5 text-[13px] font-medium text-txt-2">
        Quick Actions
      </h2>
      <div class="grid grid-cols-6 gap-2.5">
        <button
          v-for="action in QUICK_ACTIONS"
          :key="action.id"
          type="button"
          class="card-action flex min-w-0 flex-col items-center justify-center gap-2 px-1 py-3.5"
        >
          <AppIcon :name="action.icon" :size="19" :class="action.tone" />
          <span class="max-w-full truncate text-[11px] text-txt-2">{{ action.label }}</span>
        </button>
      </div>
    </section>

    <!-- 系统信息 -->
    <section v-if="facts.length">
      <h2 class="mb-2.5 text-[13px] font-medium text-txt-2">
        System
      </h2>
      <div class="card divide-y divide-line-soft overflow-hidden">
        <div
          v-for="fact in facts"
          :key="fact.label"
          class="flex items-center gap-3 px-3.5 py-2.5"
        >
          <span class="w-28 shrink-0 text-[11px] text-txt-3">{{ fact.label }}</span>
          <span class="min-w-0 flex-1 truncate text-xs text-txt-2" :title="fact.value">
            {{ fact.value }}
          </span>
        </div>
      </div>
    </section>
  </div>
</template>
