<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentEntry, AgentProgress } from '@/types/agent'
import { translateNativeMessage } from '@/i18n/native'
import AppIcon from '@/components/ui/AppIcon.vue'
import AgentMarkdown from './AgentMarkdown.vue'
import AgentCopyButton from './AgentCopyButton.vue'
import AgentExecutionCard from './AgentExecutionCard.vue'
import AgentQueryResult from './AgentQueryResult.vue'

const props = defineProps<{
  entries: AgentEntry[]
  progress: AgentProgress | null
  busy: boolean
}>()
const { t } = useI18n()
const tools = computed(
  () =>
    props.entries.filter(entry => entry.operation).length +
    (props.progress?.operation &&
    !props.entries.some(
      entry => entry.operation?.id === props.progress?.operation?.id
    )
      ? 1
      : 0)
)
const messages = computed(
  () =>
    props.entries.filter(entry => entry.role === 'assistant').length +
    (props.progress?.text ? 1 : 0)
)
const liveOperation = computed(() =>
  props.progress?.operation &&
  !props.entries.some(
    entry => entry.operation?.id === props.progress?.operation?.id
  )
    ? props.progress.operation
    : null
)
const preparing = computed(
  () => props.busy && !props.progress?.text && !liveOperation.value
)
</script>

<template>
  <details
    data-agent-activity
    class="group/activity min-w-0"
    open
  >
    <summary
      data-agent-activity-summary
      class="border-agent-line text-agent-small text-txt-2 focus-visible:outline-blue flex min-h-7 cursor-pointer list-none items-center gap-2.5 border-l-2 pl-3.5 font-semibold focus-visible:rounded-[3px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-3 [&::-webkit-details-marker]:hidden"
    >
      <AppIcon
        name="lucide:chevron-up"
        :size="13"
        class="text-txt-3 shrink-0 rotate-180 group-open/activity:rotate-0"
      />
      <span>{{ t('agent.activitySummary', { tools, messages }) }}</span>
      <span
        v-if="busy"
        class="bg-agent-mint size-[5px] rounded-full"
        aria-hidden="true"
      />
    </summary>
    <div class="flex flex-col gap-[7px] pt-[9px]">
      <div
        v-for="(entry, index) in entries"
        :key="index"
        class="border-agent-line relative min-w-0 border-l-2 py-0.5 pl-3.5"
      >
        <template v-if="entry.operation">
          <AgentExecutionCard
            :operation="entry.operation"
            :output="entry.detail"
          />
          <AgentQueryResult
            v-for="(result, resultIndex) in entry.operation.results ?? []"
            :key="resultIndex"
            :result="result"
          />
        </template>
        <template v-else-if="entry.role === 'assistant'">
          <AppIcon
            name="lucide:brain"
            :size="16"
            class="text-agent-mint absolute top-[5px] left-3.5 shrink-0"
          />
          <div class="group/thought text-txt-2 relative min-w-0">
            <AgentMarkdown
              :content="entry.text"
              class="[&_.markdown-body]:text-agent-body [&_.markdown-body_strong]:text-txt [&_.markdown-body]:leading-[1.35] [&_.markdown-body_p]:mt-0 [&_.markdown-body_p]:mb-1 [&_.markdown-body_strong]:font-semibold [&_.markdown-body>:first-child]:min-h-[22px] [&_.markdown-body>:first-child]:pl-[26px] [&_.markdown-body>:last-child]:mb-0"
            />
            <AgentCopyButton
              :text="entry.text"
              :label="t('复制内容')"
              class="pointer-events-none absolute right-0 -bottom-3 opacity-0 group-focus-within/thought:pointer-events-auto group-focus-within/thought:opacity-100 group-hover/thought:pointer-events-auto group-hover/thought:opacity-100"
            />
          </div>
        </template>
        <details
          v-else
          :open="entry.role === 'error'"
        >
          <summary
            class="text-agent-small hover:text-txt focus-visible:outline-blue flex cursor-pointer list-none items-start gap-2.5 leading-normal focus-visible:rounded-[3px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-3 [&::-webkit-details-marker]:hidden"
            :class="entry.role === 'error' ? 'text-danger' : 'text-txt-3'"
          >
            <AppIcon
              :name="
                entry.role === 'error'
                  ? 'lucide:circle-alert'
                  : entry.role === 'audit'
                    ? 'lucide:shield-check'
                    : 'lucide:terminal'
              "
              :size="15"
              class="mt-0.5 shrink-0"
              :class="
                entry.role === 'error' ? 'text-danger' : 'text-agent-mint'
              "
            />
            <span>{{ translateNativeMessage(entry.text) }}</span>
          </summary>
          <pre
            v-if="entry.detail"
            class="scroll-thin bg-terminal mt-2 mb-1.5 ml-[26px] max-h-60 overflow-auto rounded-md p-2.5 font-mono text-[11px] leading-[1.6] wrap-anywhere whitespace-pre-wrap"
            >{{
              entry.role === 'error'
                ? translateNativeMessage(entry.detail)
                : entry.detail
            }}</pre>
          <AgentCopyButton
            :text="
              entry.detail ? `${entry.text}\n\n${entry.detail}` : entry.text
            "
            :label="t('复制内容')"
          />
        </details>
      </div>
      <div
        v-if="progress?.text"
        class="border-agent-line relative min-w-0 border-l-2 py-0.5 pl-3.5"
        aria-busy="true"
      >
        <AppIcon
          name="lucide:brain"
          :size="16"
          class="text-agent-mint absolute top-[5px] left-3.5 shrink-0"
        />
        <AgentMarkdown
          :content="progress.text"
          class="text-txt-2 [&_.markdown-body]:text-agent-body [&_.markdown-body_strong]:text-txt min-w-0 [&_.markdown-body]:leading-[1.35] [&_.markdown-body_p]:mt-0 [&_.markdown-body_p]:mb-1 [&_.markdown-body_strong]:font-semibold [&_.markdown-body>:first-child]:min-h-[22px] [&_.markdown-body>:first-child]:pl-[26px] [&_.markdown-body>:last-child]:mb-0"
        />
      </div>
      <div
        v-if="liveOperation"
        class="border-agent-line relative min-w-0 border-l-2 py-0.5 pl-3.5"
      >
        <AgentExecutionCard :operation="liveOperation" />
      </div>
      <div
        v-if="preparing"
        class="border-agent-line text-agent-body text-txt-3 relative flex min-w-0 items-center gap-2.5 border-l-2 py-0.5 pl-3.5"
        role="status"
      >
        <AppIcon
          :name="
            progress?.phase === 'tool' ? 'lucide:terminal' : 'lucide:brain'
          "
          :size="16"
          class="text-agent-mint mt-0.5 shrink-0"
        />
        <span>{{
          progress?.phase === 'tool'
            ? t('正在准备工具调用')
            : progress?.phase === 'retrying'
              ? t('ai.retryWaiting')
              : t('模型正在思考')
        }}</span>
        <span
          class="inline-flex gap-[3px] self-center"
          aria-hidden="true"
          ><i
            class="bg-agent-mint size-[3px] animate-pulse rounded-full [animation-duration:1.4s] motion-reduce:animate-none motion-reduce:opacity-70" /><i
            class="bg-agent-mint size-[3px] animate-pulse rounded-full [animation-delay:160ms] [animation-duration:1.4s] motion-reduce:animate-none motion-reduce:opacity-70" /><i
            class="bg-agent-mint size-[3px] animate-pulse rounded-full [animation-delay:320ms] [animation-duration:1.4s] motion-reduce:animate-none motion-reduce:opacity-70"
        /></span>
      </div>
    </div>
  </details>
</template>
