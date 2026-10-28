<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentEntry, AgentProgress } from '@/types/agent'
import { buildAgentTranscript } from '@/utils/agent-execution'
import { bytesToSize } from '@/utils/agent-attachments'
import AppIcon from '@/components/ui/AppIcon.vue'
import AgentMarkdown from './AgentMarkdown.vue'
import AgentCopyButton from './AgentCopyButton.vue'
import AgentActivityGroup from './AgentActivityGroup.vue'

const props = defineProps<{
  entries: AgentEntry[]
  busy: boolean
  awaitingApproval: boolean
  progress: AgentProgress | null
}>()
const { t } = useI18n()
const turns = computed(() =>
  buildAgentTranscript(props.entries, props.busy || props.awaitingApproval)
)
</script>

<template>
  <div
    data-agent-transcript
    class="flex min-w-0 flex-col gap-6"
    :aria-label="t('agent.transcript')"
  >
    <section
      v-for="(turn, index) in turns"
      :key="turn.key"
      class="flex min-w-0 flex-col gap-3"
    >
      <article
        v-if="turn.user"
        class="group/bubble bg-agent-user text-agent-body text-agent-user-text relative w-fit max-w-[88%] min-w-0 self-end rounded-[17px] px-3 py-2.5 leading-[1.55] @min-[25rem]/agent:max-w-[70%] @min-[25rem]/agent:px-4 @min-[25rem]/agent:py-[11px]"
        :aria-label="t('你的消息')"
      >
        <div
          v-if="turn.user.attachments?.length"
          class="mb-[7px] flex flex-wrap gap-1.5"
        >
          <span
            v-for="(file, fileIndex) in turn.user.attachments"
            :key="fileIndex"
            class="border-line-strong flex max-w-full min-w-0 items-center gap-[5px] rounded-md border px-[7px] py-1 text-[11px]"
            :title="file.name"
          >
            <AppIcon
              :name="file.mimeType ? 'lucide:image' : 'lucide:file-text'"
              :size="13"
              class="shrink-0"
            />
            <span class="min-w-0 truncate">{{ file.name }}</span
            ><small class="shrink-0">{{ bytesToSize(file.size) }}</small>
          </span>
        </div>
        <p class="m-0 leading-[1.25] wrap-anywhere whitespace-pre-wrap">
          {{ turn.user.text }}
        </p>
        <div
          class="bg-agent-answer pointer-events-none absolute right-[7px] -bottom-[17px] z-1 rounded-[5px] opacity-0 transition-opacity duration-150 group-focus-within/bubble:pointer-events-auto group-focus-within/bubble:opacity-100 group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100 motion-reduce:transition-none"
        >
          <AgentCopyButton
            :text="turn.user.text"
            :label="t('复制内容')"
          />
        </div>
      </article>
      <AgentActivityGroup
        v-if="
          turn.activity.length ||
          (index === turns.length - 1 && (busy || awaitingApproval))
        "
        :entries="turn.activity"
        :progress="index === turns.length - 1 ? progress : null"
        :busy="index === turns.length - 1 && busy"
      />
      <article
        v-for="(reply, replyIndex) in turn.replies"
        :key="replyIndex"
        data-agent-assistant
        class="group/bubble bg-agent-answer text-agent-body text-txt relative w-fit max-w-[96%] min-w-0 self-start rounded-[17px] px-3 py-2.5 leading-[1.55] @min-[25rem]/agent:max-w-[70%] @min-[25rem]/agent:px-4 @min-[25rem]/agent:py-[11px]"
        :aria-label="t('agent.assistantMessage')"
      >
        <AgentMarkdown
          :content="reply.text"
          class="[&_.markdown-body]:text-agent-body [&_.markdown-body_:not(pre)>code]:text-violet [&_.markdown-body]:leading-[1.3] [&_.markdown-body_:not(pre)>code]:bg-transparent [&_.markdown-body_:not(pre)>code]:p-0 [&_.markdown-body_:not(pre)>code]:text-[12.5px] [&_.markdown-body_li]:my-0 [&_.markdown-body_li]:pl-0 [&_.markdown-body_ol]:mt-1 [&_.markdown-body_ol]:mb-0 [&_.markdown-body_ol]:pl-4 [&_.markdown-body_p]:mb-1 [&_.markdown-body_ul]:mt-1 [&_.markdown-body_ul]:mb-0 [&_.markdown-body_ul]:pl-4"
        />
        <div
          class="bg-agent-answer pointer-events-none absolute right-[7px] -bottom-[17px] z-1 rounded-[5px] opacity-0 transition-opacity duration-150 group-focus-within/bubble:pointer-events-auto group-focus-within/bubble:opacity-100 group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100 motion-reduce:transition-none"
        >
          <AgentCopyButton
            :text="reply.text"
            :label="t('复制内容')"
          />
        </div>
      </article>
    </section>
  </div>
</template>
