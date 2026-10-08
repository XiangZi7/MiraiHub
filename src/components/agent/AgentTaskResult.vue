<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentEntry, AgentRun } from '@/types/agent'
import {
  formatAgentDuration,
  summarizeAgentTurn,
} from '@/utils/agent-execution'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  entries: AgentEntry[]
  status: AgentRun['status']
}>()
const { t } = useI18n()
const result = computed(() => summarizeAgentTurn(props.entries, props.status))
function metricLabel(name: string) {
  const prefix = '磁盘使用率 '
  return name.startsWith(prefix)
    ? t('磁盘使用率 {mount}', { mount: name.slice(prefix.length) })
    : t(name)
}
const title = computed(() =>
  t(
    props.status === 'cancelled'
      ? '本轮已停止'
      : result.value.needsAttention
        ? '本轮执行记录 · 请核对结果'
        : '本轮执行完成'
  )
)
</script>

<template>
  <section
    v-if="result.finished && result.operations.length"
    class="task-result"
    :class="(result.needsAttention || status === 'cancelled') && 'attention'"
    :aria-label="t('任务结果')"
  >
    <div class="result-heading">
      <AppIcon
        :name="
          result.needsAttention || status === 'cancelled'
            ? 'lucide:clipboard-list'
            : 'lucide:clipboard-check'
        "
        :size="18"
      /><strong>{{ title }}</strong>
    </div>
    <div class="result-metrics">
      <div>
        <strong>{{ result.operations.length }}</strong
        ><span>{{ t('实际操作') }}</span>
      </div>
      <div>
        <strong>{{ result.completed }}</strong
        ><span>{{ t('正常完成') }}</span>
      </div>
      <div>
        <strong>{{ formatAgentDuration(result.durationMs) }}</strong
        ><span>{{ t('工具耗时') }}</span>
      </div>
    </div>
    <p
      v-if="result.failed || result.unknown"
      class="result-notice"
    >
      {{
        t('{failed} 项异常，{unknown} 项退出状态未知', {
          failed: result.failed,
          unknown: result.unknown,
        })
      }}
    </p>
    <div
      v-if="result.metricComparisons.length"
      class="result-comparisons"
    >
      <p>{{ t('重复检查的指标变化') }}</p>
      <div
        v-for="change in result.metricComparisons"
        :key="`${change.command}-${change.name}`"
        class="result-change metric-change"
        :title="change.command"
      >
        <code>{{ metricLabel(change.name) }}</code
        ><span
          >{{ change.before }} {{ change.unit }}
          <AppIcon
            name="lucide:arrow-right"
            :size="12"
          />
          {{ change.after }} {{ change.unit }}</span
        >
      </div>
    </div>
    <div
      v-if="result.comparisons.length"
      class="result-comparisons"
    >
      <p>{{ t('重复检查的退出码变化') }}</p>
      <div
        v-for="change in result.comparisons"
        :key="change.command"
        class="result-change"
      >
        <code>{{ change.command }}</code>
        <span
          >{{ change.before }}
          <AppIcon
            name="lucide:arrow-right"
            :size="12"
          />
          {{ change.after }}</span
        >
      </div>
    </div>
    <p class="result-caption">
      {{ t('以上为实际工具执行记录，问题是否解决请以验证结果为准。') }}
    </p>
  </section>
</template>

<style scoped>
.task-result {
  padding: 15px;
  border: 1px solid
    color-mix(in srgb, var(--color-success) 25%, var(--color-line));
  border-radius: 12px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-success) 7%, transparent),
      transparent 75%
    ),
    var(--color-card);
}
.attention {
  border-color: var(--color-line);
  background: var(--color-card);
}
.result-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-success);
  font-size: var(--agent-body-font, 12px);
}
.attention .result-heading {
  color: var(--color-txt-2);
}
.result-heading strong {
  font-weight: 500;
}
.result-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr;
  margin-top: 16px;
  gap: 8px;
}
.result-metrics div {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.result-metrics strong {
  color: var(--color-txt);
  font-size: 19px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.result-metrics span,
.result-notice,
.result-caption,
.result-comparisons {
  font-size: var(--agent-small-font, 10px);
  color: var(--color-txt-3);
}
.result-notice {
  margin: 12px 0 0;
}
.result-caption {
  margin: 13px 0 0;
  line-height: 1.7;
}
.result-comparisons {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--color-line-soft);
}
.result-comparisons p {
  margin: 0 0 8px;
}
.result-change {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
}
.result-change code {
  min-width: 0;
  overflow-wrap: anywhere;
}
.result-change span {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  color: var(--color-txt-2);
}
.metric-change {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}
.metric-change span {
  white-space: normal;
  overflow-wrap: anywhere;
  flex-wrap: wrap;
}
</style>
