<script setup lang="ts">
import { computed, shallowRef, toRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSystemStats } from '@/composables/useSystemStats'
import { formatRate, formatUptime, percent, splitKb } from '@/utils/format'
import { copyText } from '@/utils/clipboard'
import { toast } from '@/composables/useToast'

const props = defineProps<{ sessionId: string; active: boolean }>()
const { t } = useI18n()
const detailsId = useId()
const details = useTemplateRef<HTMLElement>('details')
watch([() => props.sessionId, () => props.active], () =>
  details.value?.hidePopover()
)
const detailsPosition = shallowRef({ left: '0px', top: '0px' })
function positionDetails(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  detailsPosition.value = {
    left: `${Math.max(8, Math.min(rect.right - 340, window.innerWidth - 348))}px`,
    top: `${rect.bottom + 8}px`,
  }
}
function usage(used: number, total: number): string {
  const usedSize = splitKb(used)
  const totalSize = splitKb(total)
  return usedSize.unit === totalSize.unit
    ? `${usedSize.value}/${totalSize.value} ${totalSize.unit}`
    : `${usedSize.value} ${usedSize.unit}/${totalSize.value} ${totalSize.unit}`
}
const { stats, loading, error, refresh } = useSystemStats(
  toRef(props, 'sessionId'),
  toRef(props, 'active')
)
const systemInfo = computed(() => {
  const snapshot = stats.value
  if (!snapshot) return ''
  return [
    snapshot.hostname,
    snapshot.os,
    snapshot.kernel,
    snapshot.arch,
    snapshot.cpu.model,
    `${t('Online users')}: ${snapshot.onlineUsers}`,
  ].join('\n')
})
const metrics = computed(() => {
  const snapshot = stats.value
  if (!snapshot) return []
  const { cpu, memory, disk, network } = snapshot
  return [
    {
      id: 'cpu',
      icon: 'lucide:cpu',
      value: `${cpu.usage.toFixed(0)}% (${cpu.cores}C)`,
      title: `CPU · ${t('{value0} 核 · 负载 {value1}', { value0: cpu.cores, value1: cpu.load[0].toFixed(2) })}`,
    },
    {
      id: 'memory',
      icon: 'lucide:memory-stick',
      value: usage(memory.usedKb, memory.totalKb),
      title: `${t('Memory')} · ${percent(memory.usedKb, memory.totalKb)}`,
    },
    {
      id: 'disk',
      icon: 'lucide:hard-drive',
      value: `${usage(disk.usedKb, disk.totalKb)} (${percent(disk.usedKb, disk.totalKb)})`,
      title: t('Disk'),
    },
    {
      id: 'download',
      icon: 'lucide:arrow-down-to-line',
      value: formatRate(network.rxBytesPerSec),
      title: t('下载速率'),
      tone: 'text-success',
    },
    {
      id: 'upload',
      icon: 'lucide:arrow-up-from-line',
      value: formatRate(network.txBytesPerSec),
      title: t('上传速率'),
      tone: 'text-blue',
    },
    {
      id: 'uptime',
      icon: 'lucide:clock',
      value: formatUptime(snapshot.uptimeSecs),
      title: `${t('Uptime')}\n${systemInfo.value}`,
    },
  ]
})
async function copyInfo(): Promise<void> {
  try {
    await copyText(
      [
        systemInfo.value,
        ...metrics.value.map(
          metric => `${metric.title.split('\n')[0]}: ${metric.value}`
        ),
      ].join('\n')
    )
    toast.success(t('服务器信息已复制'))
  } catch (error) {
    toast.error({ title: t('复制服务器信息失败'), description: String(error) })
  }
}
</script>

<template>
  <div class="server-status-bar">
    <div
      v-if="stats && !error"
      class="server-metrics"
      :aria-label="t('服务器指标')"
      tabindex="0"
    >
      <span
        v-for="metric in metrics"
        :key="metric.id"
        class="server-metric"
        :title="metric.title"
        :aria-label="`${metric.title}: ${metric.value}`"
      >
        <AppIcon
          :name="metric.icon"
          :size="13"
          :class="metric.tone"
        />
        <span>{{ metric.value }}</span>
      </span>
    </div>
    <button
      v-if="stats && !error"
      type="button"
      class="metrics-details-trigger"
      :popovertarget="detailsId"
      :title="t('服务器指标')"
      :aria-label="t('服务器指标')"
      @click="positionDetails"
    >
      <AppIcon
        name="lucide:chevron-down"
        :size="12"
      />
    </button>
    <div
      ref="details"
      :id="detailsId"
      popover="auto"
      class="metrics-details"
      :style="detailsPosition"
    >
      <p class="text-txt mb-3 text-xs font-medium">{{ t('服务器指标') }}</p>
      <div
        v-for="metric in metrics"
        :key="metric.id"
        class="metrics-detail-row"
      >
        <AppIcon
          :name="metric.icon"
          :size="13"
          :class="metric.tone"
        />
        <span class="flex-1">{{ metric.title.split('\n')[0] }}</span
        ><span>{{ metric.value }}</span>
      </div>
      <p class="border-line-soft mt-3 border-t pt-3 whitespace-pre-line">
        {{ systemInfo }}
      </p>
      <div class="mt-3 flex gap-3">
        <button
          type="button"
          class="text-txt-2 hover:text-txt cursor-pointer"
          :disabled="loading"
          @click="refresh"
        >
          {{ t('刷新系统信息') }}
        </button>
        <button
          type="button"
          class="text-txt-2 hover:text-txt cursor-pointer"
          @click="copyInfo"
        >
          {{ t('复制信息') }}
        </button>
      </div>
    </div>
    <button
      v-if="error"
      type="button"
      class="metrics-error"
      :title="`${error}\n${t('刷新系统信息')}`"
      @click="refresh"
    >
      <AppIcon
        name="lucide:circle-alert"
        :size="13"
      />{{ t('指标暂不可用') }}
    </button>
    <span
      v-else-if="loading"
      class="metrics-loading"
      role="status"
      >{{ t('正在采集指标…') }}</span
    >
  </div>
</template>

<style scoped>
.server-status-bar {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.server-metrics {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 5px 0;
}
.metrics-details-trigger {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 26px;
  color: var(--color-txt-3);
  cursor: pointer;
}
.metrics-details-trigger:hover {
  color: var(--color-txt);
}
.metrics-details {
  position: fixed;
  margin: 0;
  width: 340px;
  max-width: calc(100vw - 16px);
  max-height: 70vh;
  overflow-y: auto;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-panel);
  /* 浮层玻璃与其余 popover（Toast、菜单）统一：模糊 + 提饱和透出背景 */
  -webkit-backdrop-filter: blur(30px) saturate(175%);
  backdrop-filter: blur(30px) saturate(175%);
  color: var(--color-txt-3);
  box-shadow: 0 12px 32px #0004;
  font-size: 11px;
}
.metrics-detail-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 0;
  font-variant-numeric: tabular-nums;
}
.server-metrics::-webkit-scrollbar {
  display: none;
}
.server-metric {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
  color: var(--color-txt-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.metrics-error,
.metrics-loading {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--color-txt-3);
  font-size: 11px;
  white-space: nowrap;
}
.metrics-error {
  cursor: pointer;
}
.metrics-error:hover {
  color: var(--color-txt);
}
.server-metrics:focus-visible,
.metrics-error:focus-visible {
  outline: 1px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 3px;
}
</style>
