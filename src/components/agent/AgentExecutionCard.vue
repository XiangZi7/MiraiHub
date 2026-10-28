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
      completed: props.operation.fileChange
        ? 'lucide:file-pen-line'
        : 'lucide:terminal',
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
    data-agent-operation
    class="group/operation min-w-0"
    :data-status="operation.status"
    :open="operation.status === 'failed'"
  >
    <summary
      class="focus-visible:outline-accent flex min-h-[22px] cursor-pointer list-none items-center gap-2.5 focus-visible:rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-3 [&::-webkit-details-marker]:hidden"
      :title="`${t(operation.label)} · ${label} · ${operation.command}`"
    >
      <span
        class="text-agent-mint group-data-[status=failed]/operation:text-danger group-data-[status=unknown]/operation:text-amber grid w-4 shrink-0 place-items-center"
        ><AppIcon
          :name="icon"
          :size="15"
          :class="
            operation.status === 'running' &&
            'animate-spin motion-reduce:animate-none'
          "
      /></span>
      <span
        class="flex max-w-[min(100%,480px)] min-w-0 items-baseline gap-[7px] @max-[31.25rem]/agent:flex-1"
      >
        <strong
          v-if="operation.fileChange"
          class="text-agent-body text-txt-2 shrink-0 font-semibold"
          >{{
            operation.status === 'completed'
              ? t('agent.fileEdited')
              : t(operation.label)
          }}:</strong
        >
        <span
          class="text-txt-2 min-w-0 truncate"
          :class="
            operation.fileChange
              ? 'text-agent-body font-sans font-semibold'
              : 'border-line bg-terminal rounded-md border px-[7px] py-px font-mono text-[11px] leading-normal font-medium @max-[31.25rem]/agent:text-[11px]'
          "
          >{{ operation.fileChange?.path || operation.command }}</span
        >
      </span>
      <span
        class="text-txt-3 ml-auto flex shrink-0 items-center gap-[7px] text-[10px] tabular-nums opacity-0 group-focus-within/operation:opacity-100 group-hover/operation:opacity-100 group-data-[status=failed]/operation:opacity-100 @max-[31.25rem]/agent:hidden"
      >
        <span>{{ label }}</span
        ><span v-if="operation.durationMs !== undefined">{{
          formatAgentDuration(operation.durationMs)
        }}</span>
      </span>
      <AppIcon
        name="lucide:chevron-down"
        :size="12"
        class="text-txt-3 shrink-0 opacity-0 group-open/operation:rotate-180 group-open/operation:opacity-100 group-focus-within/operation:opacity-100 group-hover/operation:opacity-100 @max-[31.25rem]/agent:ml-auto"
      />
    </summary>
    <div
      class="border-line bg-canvas/12 mt-2 mb-0.5 ml-[26px] rounded-lg border p-[11px] @max-[31.25rem]/agent:ml-0"
    >
      <p
        v-if="operation.reason"
        class="text-agent-body text-txt-2 mt-0 mb-[9px] leading-[1.6] wrap-anywhere"
      >
        {{ operation.reason }}
      </p>
      <pre
        v-if="!operation.fileChange"
        class="scroll-thin bg-terminal m-0 max-h-[260px] overflow-auto rounded-md p-2.5 font-mono text-[11px] leading-[1.7] wrap-anywhere whitespace-pre-wrap"
        >{{ operation.command }}</pre>
      <AgentFileDiff
        v-if="operation.fileChange"
        :change="operation.fileChange"
      />
      <div
        v-if="operation.exitCode !== undefined"
        class="text-txt-3 mt-2 text-[11px]"
      >
        {{ t('退出码：{code}', { code: operation.exitCode }) }}
      </div>
      <pre
        v-if="output"
        class="scroll-thin bg-terminal mt-2 mb-0 max-h-[260px] overflow-auto rounded-md p-2.5 font-mono text-[11px] leading-[1.7] wrap-anywhere whitespace-pre-wrap"
        >{{ outputPreview }}</pre>
      <div class="mt-1.5 flex justify-end">
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
