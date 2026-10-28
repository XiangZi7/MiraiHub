<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentUsage } from '@/types/agent'
import { bytesToSize } from '@/utils/agent-attachments'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ usage?: AgentUsage }>()
const { t } = useI18n()
const tokenContext = computed(
  () =>
    (props.usage?.contextWindowTokens ?? 0) > 0 &&
    props.usage?.estimatedContextTokens != null
)
const percent = computed(() =>
  props.usage && props.usage.contextLimitBytes > 0
    ? Math.min(
        100,
        Math.max(
          0,
          (tokenContext.value
            ? props.usage.estimatedContextTokens! /
              props.usage.contextWindowTokens!
            : props.usage.contextBytes / props.usage.contextLimitBytes) * 100
        )
      )
    : null
)
const compact = (value: number | null | undefined) =>
  value == null
    ? '—'
    : Intl.NumberFormat('en', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(value)
const contextTitle = computed(() =>
  props.usage
    ? t(
        tokenContext.value
          ? 'agent.tokenContextDescription'
          : 'agent.contextDescription',
        {
          used: tokenContext.value
            ? compact(props.usage.estimatedContextTokens)
            : bytesToSize(props.usage.contextBytes),
          limit: tokenContext.value
            ? compact(props.usage.contextWindowTokens)
            : bytesToSize(props.usage.contextLimitBytes),
          tokens: compact(props.usage.lastInputTokens),
        }
      )
    : t('agent.usageUnavailable')
)
</script>

<template>
  <div
    data-agent-usage
    class="text-txt-3 mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[10px] leading-5 tabular-nums"
  >
    <span
      class="inline-flex items-center gap-1"
      :title="t('agent.speedDescription')"
    >
      <AppIcon
        name="lucide:gauge"
        :size="12"
      />
      {{
        t('agent.roundsSteps', {
          rounds: usage?.rounds ?? 0,
          steps: usage?.steps ?? 0,
        })
      }}
      ·
      {{
        usage?.tokensPerSecond == null ? '—' : Math.round(usage.tokensPerSecond)
      }}
      tok/s
    </span>
    <span
      class="inline-flex items-center gap-1"
      :title="
        t('agent.tokenDescription', {
          reports: usage?.reportedRequests ?? 0,
          steps: usage?.steps ?? 0,
        })
      "
    >
      <AppIcon
        name="lucide:database"
        :size="12"
      />
      {{ compact(usage?.totalTokens) }} tok ·
      {{
        t('agent.cacheHit', {
          value:
            usage?.cacheHitRate == null
              ? '—'
              : `${Math.round(usage.cacheHitRate)}%`,
        })
      }}
    </span>
    <span
      class="ml-auto inline-flex items-center gap-1"
      :title="contextTitle"
    >
      <svg
        data-agent-context
        class="text-accent size-4 shrink-0 -rotate-90"
        viewBox="0 0 24 24"
        role="progressbar"
        :aria-label="t('agent.contextUsage')"
        :aria-valuenow="percent == null ? undefined : Math.round(percent)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuetext="contextTitle"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          class="stroke-txt/15"
          stroke-width="2.5"
        />
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          pathLength="100"
          :stroke-dasharray="`${percent ?? 0} 100`"
        />
      </svg>
      {{ percent == null ? '—' : `${Math.round(percent)}%` }}
    </span>
  </div>
</template>
