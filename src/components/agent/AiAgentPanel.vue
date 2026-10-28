<script setup lang="ts">
import { toast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'

import {
  computed,
  nextTick,
  reactive,
  toRefs,
  toRef,
  useTemplateRef,
  watch,
} from 'vue'
import type { AgentContextRequest, AgentTarget } from '@/types/agent'
import { useAiAgent } from '@/composables/useAiAgent'
import { useAgentProfiles } from '@/composables/useAgentProfiles'
import { useAgentDraft } from '@/composables/useAgentDraft'
import AgentComposer from './AgentComposer.vue'
import { copyText } from '@/utils/clipboard'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AgentApprovalCard from './AgentApprovalCard.vue'
import AgentTranscript from './AgentTranscript.vue'
import AgentConversationMenu from './AgentConversationMenu.vue'
import AgentRetryStatus from './AgentRetryStatus.vue'
import {
  useAgentErrorToasts,
  notifyAgentError,
} from '@/composables/useAgentErrorToasts'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    target: AgentTarget
    title?: string
    active?: boolean
    split?: boolean
    embedded?: boolean
    contextRequest?: AgentContextRequest | null
  }>(),
  { active: true, split: false }
)
const emit = defineEmits<{
  split: []
  close: []
  contextConsumed: [id: string]
}>()
const profiles = useAgentProfiles(() => {
  draft.clearAttachments()
  void changeProfile()
})
const {
  run,
  busy,
  progress,
  error,
  awaitingApproval,
  approvalMode,
  setApprovalMode,
  conversations,
  historyLoading,
  historyError,
  historyMutating,
  switchingConversation,
  selectConversation,
  removeConversation,
  renameConversation,
  refreshHistory,
  send,
  decide,
  stop,
  clear,
  changeProfile,
} = useAiAgent(
  toRef(props, 'target'),
  toRef(props, 'active'),
  profiles.activeId
)
const {
  activeId,
  active: activeProfile,
  options: profileOptions,
  loading: profilesLoading,
  switching,
  error: profileError,
} = profiles
// 响应式状态
const state = reactive({
  // 对话复制状态
  copied: false,
  // 演示视图放大正文并突出执行过程，仅影响当前面板
  presentation: false,
  // 保留用户阅读位置，工具输出或折叠内容变化时仅在靠近底部时跟随。
  following: true,
  lastScrollTop: 0,
  lastScrollHeight: 0,
})
const { copied, presentation, following } = toRefs(state)
const draft = useAgentDraft((text, attachments) =>
  send(text, attachments, approvalMode.value)
)
const { prompt, attachments, reading, readingProgress, attachmentError } = draft
const scroll = useTemplateRef<HTMLElement>('scroll')
const content = useTemplateRef<HTMLElement>('content')
const composer = useTemplateRef<InstanceType<typeof AgentComposer>>('composer')
const isRedis = computed(() => props.target.kind === 'redis')
const isDatabase = computed(() => props.target.kind !== 'ssh')
const suggestions = computed(() =>
  isRedis.value
    ? [
        t('扫描当前 Redis 数据库的键'),
        t('检查 Redis 键的类型和 TTL'),
        t('帮我编写 Redis 命令'),
        t('分析 Redis 内存使用情况'),
      ]
    : isDatabase.value
      ? [
          t('查看表结构'),
          t('分析数据库结构并给出优化建议'),
          t('帮我编写查询'),
          t('检查索引并说明改进方案'),
        ]
      : [
          t('检查系统状态'),
          t('查看磁盘使用情况'),
          t('查看运行中的进程'),
          t('检查网络状态'),
          t('分析服务器问题'),
          t('更新系统软件包'),
        ]
)
const canSend = computed(() =>
  Boolean(
    props.target.sessionId &&
    props.active &&
    activeProfile.value?.enabled &&
    !profilesLoading.value &&
    !switching.value &&
    !historyLoading.value &&
    !historyMutating.value &&
    !switchingConversation.value &&
    (prompt.value.trim() || attachments.value.length) &&
    !reading.value &&
    !busy.value &&
    !awaitingApproval.value
  )
)
const usage = computed(() => {
  const value = progress.value?.usage ?? run.value?.usage
  const contextLimitBytes =
    (activeProfile.value?.limits?.maxContextKb ?? 0) * 1000
  return value
    ? {
        ...value,
        contextLimitBytes: value.contextLimitBytes || contextLimitBytes,
      }
    : {
        rounds:
          run.value?.entries.filter(entry => entry.role === 'user').length ?? 0,
        steps: 0,
        totalTokens: run.value ? null : 0,
        tokensPerSecond: null,
        cacheHitRate: null,
        reportedRequests: 0,
        cacheReportedRequests: 0,
        lastInputTokens: null,
        contextBytes: 0,
        contextLimitBytes,
      }
})
useAgentErrorToasts(error, () => run.value?.saveError)
watch(
  () => run.value?.status,
  status => {
    if (status === 'truncated') toast.warning(t('agent.truncatedHelp'))
  }
)
watch(run, (current, previous) => {
  if (!current?.id || current.conversationId !== previous?.conversationId)
    return
  for (const entry of current.entries.slice(previous.entries.length))
    if (entry.role === 'error' && !entry.operation) notifyAgentError(entry.text)
})
const statusLabel = computed(
  () =>
    (busy.value && progress.value
      ? {
          thinking: t('模型正在思考'),
          answering: t('正在生成回复'),
          tool: t('正在准备工具调用'),
          retrying: t('ai.retryWaiting'),
          executing: t('正在执行工具'),
        }[progress.value.phase]
      : undefined) ??
    {
      running: t('正在处理'),
      approval: t('等待审批'),
      completed: t('本轮完成'),
      cancelled: t('已停止'),
      failed: t('任务未完成'),
      truncated: t('agent.truncated'),
    }[run.value?.status ?? 'completed']
)
async function submit(): Promise<void> {
  if (!canSend.value) return
  await draft.submit()
}
function newConversation(): void {
  draft.reset()
  void clear()
}
function switchConversation(id: string): void {
  if (run.value?.conversationId === id) return
  draft.reset()
  void selectConversation(id)
}
function suggest(text: string): void {
  draft.prompt.value = text
}
watch(
  () => JSON.stringify(props.target),
  () => {
    draft.reset()
  }
)
watch(
  () => props.contextRequest?.id,
  async () => {
    const request = props.contextRequest
    if (
      !request ||
      request.target.kind !== props.target.kind ||
      request.target.sessionId !== props.target.sessionId ||
      request.target.database !== props.target.database
    )
      return
    if (draft.addContext(request)) {
      emit('contextConsumed', request.id)
      await nextTick()
      composer.value?.focus()
    }
  },
  { immediate: true }
)
async function copyConversation(): Promise<void> {
  if (!run.value) return
  try {
    await copyText(
      [
        t('目标：{value0}', { value0: run.value.target }),
        ...run.value.entries.map(
          entry =>
            `${entry.role}: ${entry.text}${entry.attachments?.length ? `\n${t('agent.attachments', { names: entry.attachments.map(file => file.name).join(', ') })}` : ''}${entry.detail ? `\n${entry.detail}` : ''}`
        ),
      ].join('\n\n')
    )
    state.copied = true
  } catch {
    state.copied = false
  }
}
function onScroll(): void {
  const element = scroll.value
  if (!element) return
  const nearBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight < 80
  // Output growth and browser scroll anchoring also emit scroll events. Only
  // scrolling upward in a stable layout opts out of following new output.
  if (nearBottom) state.following = true
  else if (
    element.scrollHeight === state.lastScrollHeight &&
    element.scrollTop < state.lastScrollTop - 1
  )
    state.following = false
  state.lastScrollTop = element.scrollTop
  state.lastScrollHeight = element.scrollHeight
}
function scrollToBottom(force = false): void {
  if (force) state.following = true
  const element = scroll.value
  const selection = typeof window !== 'undefined' ? window.getSelection() : null
  if (
    !element ||
    !state.following ||
    (selection?.toString() && element.contains(selection.anchorNode))
  )
    return
  element.scrollTo({ top: element.scrollHeight, behavior: 'auto' })
  state.lastScrollTop = element.scrollTop
  state.lastScrollHeight = element.scrollHeight
}
useResizeObserver(content, () => scrollToBottom())
watch(
  () => [
    run.value?.conversationId,
    run.value?.entries.filter(entry => entry.role === 'user').length,
  ],
  async () => {
    state.copied = false
    await nextTick()
    scrollToBottom(true)
  }
)
watch(
  () => progress.value?.text,
  () => {
    state.copied = false
  }
)
</script>

<template>
  <section
    data-agent-panel
    class="bg-panel text-agent-body text-txt [html[data-skin-scheme=light]_&]:bg-canvas @container/agent flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_75%_0%,color-mix(in_srgb,var(--color-accent)_7%,transparent),transparent_65%)] [--agent-body-font:var(--text-agent-body)] [--agent-color:var(--color-accent)] [--agent-small-font:var(--text-agent-small)] [html[data-skin-scheme=light]_&]:bg-none"
    :class="[
      embedded ? 'rounded-none border-0' : 'border-line rounded-[10px] border',
      presentation &&
        '[--text-agent-body:15px] [--text-agent-small:13px] [&_.markdown-body_code]:text-sm',
    ]"
    aria-label="AI Agent"
  >
    <header
      class="border-line-soft flex min-h-[41px] shrink-0 items-center gap-1.5 border-b px-3"
    >
      <span
        class="size-1.5 shrink-0 rounded-full"
        :class="target.sessionId ? 'bg-agent-mint' : 'bg-txt-4'"
      /><span
        class="text-txt-2 max-w-44 truncate text-[11px]"
        :title="title"
        >{{ title || (isDatabase ? t('Database') : t('Server')) }}</span
      >
      <span
        v-if="!embedded"
        class="text-txt-2 px-[5px] py-2.5 text-[11px] font-medium whitespace-nowrap"
        >AI Agent</span
      >
      <div class="flex-1" />
      <IconButton
        icon="lucide:scan-eye"
        :size="14"
        :title="presentation ? t('退出演示视图') : t('演示视图：放大文字')"
        :aria-pressed="presentation"
        :class="presentation && 'text-accent'"
        @click="presentation = !presentation"
      />
      <IconButton
        v-if="!embedded"
        icon="lucide:columns-2"
        :size="14"
        :title="split ? t('退出 AI 分屏') : t('在旁边分屏显示')"
        :class="split && 'text-accent'"
        @click="emit('split')"
      />
      <IconButton
        :icon="copied ? 'lucide:check' : 'lucide:copy'"
        :size="14"
        :title="t('复制对话与操作记录')"
        :disabled="!run"
        @click="copyConversation"
      />
      <IconButton
        icon="lucide:square-pen"
        :size="14"
        :title="t('开始新对话')"
        :aria-label="t('开始新对话')"
        :disabled="
          switchingConversation ||
          historyLoading ||
          historyMutating ||
          !target.sessionId
        "
        @click="newConversation"
      />
      <AgentConversationMenu
        :conversations="conversations"
        :active-id="run?.conversationId ?? ''"
        :loading="historyLoading"
        :mutating="historyMutating"
        :disabled="switchingConversation || !target.sessionId"
        :error="historyError"
        :context-key="JSON.stringify(target)"
        @select="switchConversation"
        @remove="removeConversation"
        @rename="renameConversation"
        @refresh="refreshHistory()"
      />
      <IconButton
        v-if="!embedded"
        icon="lucide:x"
        :size="14"
        :title="t('关闭 AI Agent')"
        @click="emit('close')"
      />
    </header>
    <div class="relative flex min-h-0 flex-1">
      <div
        ref="scroll"
        data-agent-scroll
        class="scroll-thin min-h-0 w-full [scrollbar-gutter:stable] overflow-auto pt-4.5 pr-3.25 pb-4 pl-4 select-text @min-[25rem]/agent:pt-6 @min-[25rem]/agent:pr-6 @min-[25rem]/agent:pl-[27px]"
        @scroll.passive="onScroll"
      >
        <div
          ref="content"
          data-agent-content
          class="min-w-0"
        >
          <p
            v-if="historyLoading || switchingConversation"
            class="text-txt-3 mb-3 text-[11px]"
            role="status"
          >
            {{ t('正在加载聊天记录…') }}
          </p>
          <div
            v-if="!run"
            class="[&_p]:text-txt-3 mt-5 mb-[22px] flex items-center gap-3 [&_h2]:text-[13px] [&_h2]:font-semibold [&_p]:mt-1.5 [&_p]:text-[11px] [&_p]:leading-[1.6]"
          >
            <div
              class="border-line bg-agent-mint/7 text-agent-mint grid size-10.5 shrink-0 place-items-center rounded-xl border"
            >
              <AppIcon
                name="lucide:bot"
                :size="25"
              />
            </div>
            <div>
              <h2>
                AI Agent ({{
                  isRedis
                    ? 'Redis'
                    : isDatabase
                      ? t('Database')
                      : t('Terminal')
                }})
              </h2>
              <p>
                {{
                  isDatabase
                    ? t('协助查询、分析和管理数据库')
                    : t('协助诊断问题和管理服务器')
                }}
              </p>
            </div>
          </div>
          <template v-if="!run">
            <div
              class="text-txt-2 [&>p]:text-txt-3 [&_svg]:text-agent-mint max-w-[520px] py-3 leading-[1.7] [&_li]:flex [&_li]:items-center [&_li]:gap-2.5 [&_ul]:my-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-3"
            >
              <p>{{ t('告诉我你想完成什么，我可以帮你：') }}</p>
              <ul>
                <li
                  v-for="item in isRedis
                    ? [
                        t('扫描键并查看内容'),
                        t('检查键类型与过期时间'),
                        t('编写和执行 Redis 命令'),
                        t('分析 Redis 状态与内存使用'),
                      ]
                    : isDatabase
                      ? [
                          t('查看表与字段结构'),
                          t('编写和分析 SQL 查询'),
                          t('定位数据库问题'),
                          t('提出索引及性能优化建议'),
                        ]
                      : [
                          t('检查系统、磁盘和网络状态'),
                          t('分析命令输出与运行问题'),
                          t('制定修复步骤'),
                          t('执行服务器维护命令'),
                        ]"
                  :key="item"
                >
                  <AppIcon
                    name="lucide:check"
                    :size="13"
                  />{{ item }}
                </li>
              </ul>
            </div>
            <div
              class="mt-4.5 grid grid-cols-1 gap-2 @min-[25rem]/agent:grid-cols-2"
            >
              <button
                class="border-line bg-txt/3 text-txt-2 hover:bg-hover hover:text-txt focus-visible:outline-accent flex cursor-pointer items-center justify-between gap-[7px] rounded-[9px] border p-3 text-left text-xs transition-colors duration-150 focus-visible:outline focus-visible:outline-1 motion-reduce:transition-none"
                v-for="item in suggestions"
                :key="item"
                type="button"
                @click="suggest(item)"
              >
                {{ item }} <span class="text-txt-3">↗</span>
              </button>
            </div>
          </template>
          <div
            v-else
            class="flex flex-col gap-[3px] [&_.approval]:my-3"
            aria-live="polite"
          >
            <AgentTranscript
              :key="run.conversationId"
              :entries="run.entries"
              :busy="busy"
              :awaiting-approval="awaitingApproval"
              :progress="progress"
              :status="run.status"
              :status-label="statusLabel"
            />

            <AgentApprovalCard
              v-if="run.id && run.approval"
              :approval="run.approval"
              :target="run.target"
              :busy="busy"
              @decide="decide"
            />
            <AgentRetryStatus
              v-if="busy && progress?.phase === 'retrying' && progress.retry"
              :retry="progress.retry"
            />

            <p
              v-if="run.status === 'cancelled'"
              class="text-txt-3 text-[11px] leading-relaxed"
            >
              {{
                t('已停止后续步骤。正在执行的操作可能已生效，请核对远端状态。')
              }}
            </p>
          </div>
          <div
            v-if="!target.sessionId"
            class="border-line text-txt-3 mt-4 rounded-lg border p-3 text-[12px]"
          >
            {{
              isDatabase ? t('请先连接数据库。') : t('请先连接 SSH 服务器。')
            }}
          </div>
        </div>
      </div>
      <button
        v-if="!following && run"
        type="button"
        class="border-line-strong bg-raised text-txt-2 hover:bg-hover hover:text-txt focus-visible:outline-accent absolute right-5 bottom-3.5 grid size-8 cursor-pointer place-items-center rounded-full border shadow-[0_3px_12px_#0003] focus-visible:outline-2 focus-visible:outline-offset-3"
        :title="t('agent.scrollToBottom')"
        :aria-label="t('agent.scrollToBottom')"
        @click="scrollToBottom(true)"
      >
        <AppIcon
          name="lucide:arrow-down"
          :size="16"
        />
      </button>
    </div>
    <AgentComposer
      ref="composer"
      :usage="usage"
      v-model="prompt"
      :approval-mode="approvalMode"
      @update:approval-mode="setApprovalMode"
      :disabled="
        !target.sessionId ||
        !active ||
        awaitingApproval ||
        switchingConversation ||
        historyLoading ||
        historyMutating ||
        switching
      "
      :permission-disabled="
        !target.sessionId ||
        !active ||
        switchingConversation ||
        historyLoading ||
        historyMutating ||
        switching
      "
      :busy="busy"
      :can-send="canSend"
      :awaiting-approval="awaitingApproval"
      :is-database="isDatabase"
      :is-redis="isRedis"
      :attachments="attachments"
      :reading="reading"
      :reading-progress="readingProgress"
      :attachment-error="attachmentError"
      :active-id="activeId"
      :profile-options="profileOptions"
      :profile-disabled="
        profilesLoading || switching || switchingConversation || historyMutating
      "
      :profile-error="profileError"
      @submit="submit"
      @stop="stop"
      @select-profile="profiles.select"
      @attach="draft.addFiles"
      @remove-attachment="draft.removeFile"
      @cancel-reading="draft.cancelReading"
    />
  </section>
</template>
