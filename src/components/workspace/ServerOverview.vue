<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SparkLine from '@/components/ui/SparkLine.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { ACTIVITIES, METRIC_CARDS, QUICK_ACTIONS } from '@/constants/workspace'
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
        <h1 class="text-[19px] font-semibold leading-tight tracking-tight text-txt">
          Production Server
        </h1>
        <p class="mt-1.5 flex items-center gap-1.5 text-xs text-accent">
          <StatusDot :size="6" />
          <span>Online</span>
        </p>
        <p class="mt-1.5 text-xs text-txt-3">
          192.168.1.100 · Ubuntu 22.04.3 LTS
        </p>
      </div>

      <IconButton icon="lucide:ellipsis" title="更多" />
    </header>

    <!-- 资源指标 -->
    <div class="mb-6 grid grid-cols-4 gap-2.5">
      <article
        v-for="card in METRIC_CARDS"
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
              <span>{{ card.down }}</span>
            </p>
            <p class="mt-1 flex items-center gap-1 text-[13px] font-medium text-txt">
              <AppIcon name="lucide:arrow-up" :size="12" class="text-cyan" />
              <span>{{ card.up }}</span>
            </p>
          </template>

          <!-- 常规卡：主值 + 占比 -->
          <template v-else>
            <p class="mt-1 flex items-baseline gap-1">
              <span class="text-[21px] font-semibold leading-none tracking-tight text-txt">{{ card.value }}</span>
              <span v-if="card.suffix" class="text-[11px] text-txt-3">{{ card.suffix }}</span>
            </p>
            <p class="mt-1.5 text-[11px] text-txt-3">
              {{ card.caption }}
            </p>
          </template>
        </div>

        <SparkLine :data="card.trend" :color="card.color" :height="44" />
      </article>
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

    <!-- 最近活动 -->
    <section>
      <h2 class="mb-2.5 text-[13px] font-medium text-txt-2">
        Recent Activity
      </h2>
      <div class="card divide-y divide-line-soft overflow-hidden">
        <div
          v-for="item in ACTIVITIES"
          :key="item.id"
          class="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-raised"
        >
          <StatusDot :tone="item.tone" :size="9" />
          <span class="flex-1 truncate text-xs text-txt-2">{{ item.text }}</span>
          <span class="shrink-0 text-[11px] text-txt-4">{{ item.time }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
