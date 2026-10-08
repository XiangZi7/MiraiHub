<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentOperation } from '@/types/agent'
import { formatAgentDuration } from '@/utils/agent-execution'
import AppIcon from '@/components/ui/AppIcon.vue'
import AgentCopyButton from './AgentCopyButton.vue'
import AgentFileDiff from './AgentFileDiff.vue'

const props = defineProps<{ operation: AgentOperation; output?: string }>()
const { t } = useI18n()
const outputPreview = computed(() => {
  if (!props.output) return ''
  try {
    return JSON.stringify(JSON.parse(props.output), null, 2)
  } catch {
    return props.output
  }
})
const icon = computed(
  () =>
    ({
      running: 'lucide:loader-circle',
      completed: 'lucide:check',
      failed: 'lucide:circle-alert',
      unknown: 'lucide:circle-help',
    })[props.operation.status]
)
const label = computed(() =>
  t(
    {
      running: '正在执行',
      completed: '已执行',
      failed: '执行异常',
      unknown: '退出状态未知',
    }[props.operation.status]
  )
)
</script>

<template>
  <details
    class="execution-card"
    :class="operation.status"
    :open="operation.status === 'running' || operation.status === 'failed'"
  >
    <summary class="execution-header">
      <span class="execution-icon"
        ><AppIcon
          :name="icon"
          :size="15"
          :class="operation.status === 'running' && 'animate-spin'"
      /></span>
      <span class="execution-heading">
        <strong>{{ t(operation.label) }}</strong>
        <span class="execution-command">{{
          operation.fileChange?.path || operation.command
        }}</span>
      </span>
      <span class="execution-meta">
        <span>{{ label }}</span>
        <span v-if="operation.durationMs !== undefined">{{
          formatAgentDuration(operation.durationMs)
        }}</span>
      </span>
      <AppIcon
        name="lucide:chevron-down"
        :size="12"
        class="execution-chevron"
      />
    </summary>
    <div class="execution-body">
      <p
        v-if="operation.reason"
        class="execution-reason"
      >
        {{ operation.reason }}
      </p>
      <pre
        v-if="!operation.fileChange"
        class="execution-code"
        >{{ operation.command }}</pre>
      <AgentFileDiff
        v-if="operation.fileChange"
        :change="operation.fileChange"
      />
      <div
        v-if="operation.exitCode !== undefined"
        class="execution-exit"
      >
        {{ t('退出码：{code}', { code: operation.exitCode }) }}
      </div>
      <pre
        v-if="output"
        class="execution-output"
        >{{ outputPreview }}</pre>
      <div class="execution-actions">
        <AgentCopyButton
          :text="
            output ? `${operation.command}\n\n${output}` : operation.command
          "
          :label="t('复制内容')"
        />
      </div>
    </div>
  </details>
</template>

<style scoped>
.execution-card {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-card);
  overflow: hidden;
}
.execution-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  cursor: pointer;
  list-style: none;
}
.execution-header::-webkit-details-marker {
  display: none;
}
.execution-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
}
.running {
  border-color: color-mix(in srgb, var(--agent-color) 40%, var(--color-line));
}
.running .execution-icon {
  color: var(--agent-color);
  background: color-mix(in srgb, var(--agent-color) 12%, transparent);
}
.failed .execution-icon {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
}
.unknown .execution-icon {
  color: var(--color-amber);
  background: color-mix(in srgb, var(--color-amber) 10%, transparent);
}
.execution-heading {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 4px;
}
.execution-heading strong {
  font-size: var(--agent-body-font, 12px);
  font-weight: 500;
}
.execution-command {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: var(--agent-small-font, 10px);
  color: var(--color-txt-3);
}
.execution-meta {
  display: grid;
  gap: 4px;
  flex-shrink: 0;
  text-align: right;
  font-size: var(--agent-small-font, 10px);
  color: var(--color-txt-3);
  font-variant-numeric: tabular-nums;
}
.execution-chevron {
  flex-shrink: 0;
  color: var(--color-txt-4);
}
.execution-card[open] .execution-chevron {
  transform: rotate(180deg);
}
.execution-body {
  padding: 0 12px 10px;
}
.execution-reason {
  margin: 0 0 9px;
  color: var(--color-txt-2);
  font-size: var(--agent-body-font, 12px);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.execution-code,
.execution-output {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow: auto;
  scrollbar-width: thin;
  padding: 10px;
  border-radius: 6px;
  font: var(--agent-small-font, 11px)/1.7 var(--font-mono);
  background: var(--color-terminal);
  margin: 0;
}
.execution-output {
  margin-top: 8px;
}
.execution-exit {
  margin-top: 8px;
  color: var(--color-txt-3);
  font-size: var(--agent-small-font, 10px);
}
.execution-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
  opacity: 0;
  pointer-events: none;
}
.execution-card:hover .execution-actions,
.execution-card:focus-within .execution-actions {
  opacity: 1;
  pointer-events: auto;
}
.execution-header:focus-visible {
  outline: 1px solid var(--agent-color);
  outline-offset: -2px;
  border-radius: 8px;
}
@media (prefers-reduced-motion: reduce) {
  .animate-spin {
    animation: none;
  }
}
</style>
