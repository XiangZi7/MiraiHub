<script setup lang="ts">
import {
  computed,
  nextTick,
  reactive,
  toRefs,
  toRef,
  useTemplateRef,
  watch,
} from 'vue'
import type { AgentTarget } from '@/types/agent'
import { useAiAgent } from '@/composables/useAiAgent'
import { copyText } from '@/utils/clipboard'
import { openSettingsWindow } from '@/utils/window'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AgentApprovalCard from './AgentApprovalCard.vue'

const props = withDefaults(
  defineProps<{
    target: AgentTarget
    title?: string
    active?: boolean
    split?: boolean
  }>(),
  { active: true, split: false }
)
const emit = defineEmits<{ split: []; close: [] }>()
const { run, busy, error, awaitingApproval, send, decide, stop, clear } =
  useAiAgent(toRef(props, 'target'), toRef(props, 'active'))
// 输入与显示状态；敏感会话不会持久化。
const state = reactive({ prompt: '', copied: false })
const { prompt, copied } = toRefs(state)
const scroll = useTemplateRef<HTMLElement>('scroll')
const isDatabase = computed(() => props.target.kind === 'database')
const suggestions = computed(() =>
  isDatabase.value
    ? [
        '查看表结构',
        '分析数据库结构并给出优化建议',
        '帮我编写查询',
        '检查索引并说明改进方案',
      ]
    : [
        '检查系统状态',
        '查看磁盘使用情况',
        '查看运行中的进程',
        '检查网络状态',
        '分析服务器问题',
        '更新系统软件包',
      ]
)
const canSend = computed(() =>
  Boolean(
    props.target.sessionId &&
    props.active &&
    state.prompt.trim() &&
    !busy.value &&
    !awaitingApproval.value
  )
)
const statusLabel = computed(
  () =>
    ({
      running: '正在处理',
      approval: '等待审批',
      completed: '本轮完成',
      cancelled: '已停止',
      failed: '任务未完成',
    })[run.value?.status ?? 'completed']
)
async function submit(): Promise<void> {
  if (!canSend.value) return
  const text = state.prompt
  state.prompt = ''
  if (!(await send(text)) && !state.prompt) state.prompt = text
}
function suggest(text: string): void {
  state.prompt = text
}
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    event.stopPropagation()
    void submit()
  }
}
async function copyConversation(): Promise<void> {
  if (!run.value) return
  try {
    await copyText(
      [
        `目标：${run.value.target}`,
        ...run.value.entries.map(
          entry =>
            `${entry.role}: ${entry.text}${entry.detail ? `\n${entry.detail}` : ''}`
        ),
      ].join('\n\n')
    )
    state.copied = true
  } catch {
    state.copied = false
  }
}
watch(
  () => run.value?.entries.length,
  async () => {
    state.copied = false
    await nextTick()
    scroll.value?.scrollTo({
      top: scroll.value.scrollHeight,
      behavior: 'auto',
    })
  }
)
watch(
  () => run.value?.approval?.id,
  async () => {
    await nextTick()
    scroll.value?.scrollTo({
      top: scroll.value.scrollHeight,
      behavior: 'auto',
    })
  }
)
</script>

<template>
  <section
    class="agent-panel"
    :class="isDatabase && 'database-agent'"
    aria-label="AI Agent"
  >
    <header class="agent-header">
      <span
        class="status-dot"
        :class="target.sessionId && 'online'"
      /><span
        class="text-txt-2 max-w-44 truncate text-[11px]"
        :title="title"
        >{{ title || (isDatabase ? 'Database' : 'Server') }}</span
      >
      <span class="agent-tab">AI Agent <span class="beta">BETA</span></span>
      <div class="flex-1" />
      <IconButton
        icon="lucide:columns-2"
        :size="14"
        :title="split ? '退出 AI 分屏' : '在旁边分屏显示'"
        :class="split && 'text-accent'"
        @click="emit('split')"
      />
      <IconButton
        :icon="copied ? 'lucide:check' : 'lucide:copy'"
        :size="14"
        title="复制对话与操作记录"
        :disabled="!run"
        @click="copyConversation"
      />
      <IconButton
        icon="lucide:trash-2"
        :size="14"
        title="停止并清空对话"
        :disabled="!run && !busy"
        @click="clear"
      />
      <IconButton
        icon="lucide:x"
        :size="14"
        title="关闭 AI Agent"
        @click="emit('close')"
      />
    </header>
    <div
      ref="scroll"
      class="agent-scroll"
    >
      <div class="agent-intro">
        <div class="bot-avatar">
          <AppIcon
            name="lucide:bot"
            :size="25"
          />
        </div>
        <div>
          <h2>AI Agent ({{ isDatabase ? 'Database' : 'Terminal' }})</h2>
          <p>
            协助{{
              isDatabase ? '查询、分析和管理数据库' : '诊断问题和管理服务器'
            }}
          </p>
        </div>
      </div>
      <template v-if="!run">
        <div class="welcome">
          <p>告诉我你想完成什么，我可以帮你：</p>
          <ul>
            <li
              v-for="item in isDatabase
                ? [
                    '查看表与字段结构',
                    '编写和分析 SQL 查询',
                    '定位数据库问题',
                    '提出索引及性能优化建议',
                  ]
                : [
                    '检查系统、磁盘和网络状态',
                    '分析命令输出与运行问题',
                    '制定修复步骤',
                    '执行经你批准的命令',
                  ]"
              :key="item"
            >
              <AppIcon
                name="lucide:check"
                :size="13"
              />{{ item }}
            </li>
          </ul>
          <p>内置只读工具自动运行，其他操作逐次审批。</p>
        </div>
        <div class="suggestions">
          <button
            v-for="item in suggestions"
            :key="item"
            type="button"
            @click="suggest(item)"
          >
            {{ item }} <span>↗</span>
          </button>
        </div>
      </template>
      <div
        v-else
        class="messages"
        aria-live="polite"
      >
        <div class="provider">{{ run.model }} · {{ run.provider }}</div>
        <article
          v-for="(entry, index) in run.entries"
          :key="`${run.id}-${index}`"
          class="message"
          :class="entry.role"
        >
          <template v-if="entry.role === 'user' || entry.role === 'assistant'"
            ><span class="message-role">{{
              entry.role === 'user' ? '你' : 'AI Agent'
            }}</span>
            <p>{{ entry.text }}</p></template
          >
          <details
            v-else
            :open="entry.role === 'error'"
          >
            <summary>
              <AppIcon
                :name="
                  entry.role === 'error'
                    ? 'lucide:circle-alert'
                    : entry.role === 'audit'
                      ? 'lucide:shield-check'
                      : 'lucide:terminal'
                "
                :size="13"
              />{{ entry.text }}
            </summary>
            <pre v-if="entry.detail">{{ entry.detail }}</pre>
          </details>
        </article>
        <AgentApprovalCard
          v-if="run.approval"
          :approval="run.approval"
          :target="run.target"
          :busy="busy"
          @decide="decide"
        />
        <div class="text-txt-3 flex items-center gap-2 text-[11px]">
          <AppIcon
            v-if="busy"
            name="lucide:loader-circle"
            :size="13"
            class="animate-spin"
          />{{ statusLabel }}
        </div>
        <p
          v-if="run.status === 'cancelled'"
          class="text-txt-3 text-[11px] leading-relaxed"
        >
          已停止后续步骤。正在执行的操作可能已生效，请核对远端状态。
        </p>
      </div>
      <p
        v-if="error"
        role="alert"
        class="border-danger/30 bg-danger/5 text-danger mt-3 rounded-lg border p-3 text-[12px]"
      >
        {{ error }}
      </p>
      <div
        v-if="!target.sessionId"
        class="border-line text-txt-3 mt-4 rounded-lg border p-3 text-[12px]"
      >
        请先连接{{ isDatabase ? '数据库' : 'SSH 服务器' }}。
      </div>
    </div>
    <footer class="agent-footer">
      <p class="data-notice">
        <AppIcon
          name="lucide:shield-check"
          :size="12"
        />消息与工具结果会发送到你配置的模型服务；请勿输入密码或密钥。<button
          type="button"
          @click="openSettingsWindow"
        >
          AI 设置
        </button>
      </p>
      <form
        class="composer"
        @submit.prevent="submit"
      >
        <textarea
          v-model="prompt"
          :placeholder="
            awaitingApproval
              ? '请先审批或拒绝上方操作…'
              : isDatabase
                ? '询问数据库，或描述要完成的操作…'
                : '描述问题，或让我帮你执行任务…'
          "
          rows="2"
          maxlength="8000"
          aria-label="发送给 AI 的消息"
          :disabled="!target.sessionId || awaitingApproval"
          @keydown="keydown"
        /><IconButton
          v-if="busy"
          icon="lucide:square"
          :size="16"
          title="停止后续操作"
          @click="stop"
        /><button
          v-else
          type="submit"
          aria-label="发送消息"
          title="发送 (Enter)，换行 (Shift+Enter)"
          :disabled="!canSend"
          class="send-button"
        >
          <AppIcon
            name="lucide:send"
            :size="17"
          />
        </button>
      </form>
      <p class="footer-hint">
        <AppIcon
          name="lucide:lock-keyhole"
          :size="11"
        />增删改及自定义命令必须审批 · 不提供全部放行
      </p>
      <AppButton
        v-if="run?.status === 'failed' || run?.status === 'cancelled'"
        variant="ghost"
        size="sm"
        class="mt-1"
        @click="clear"
        >开始新对话</AppButton
      >
    </footer>
  </section>
</template>

<style scoped>
.agent-panel {
  --agent-color: #b08bfa;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background:
    linear-gradient(135deg, #ac82fb06, transparent 48%), var(--color-panel);
  color: var(--color-txt);
  font-size: 12px;
}
.database-agent {
  --agent-color: #74d696;
}
.agent-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  padding: 0 10px;
  min-height: 41px;
  border-bottom: 1px solid var(--color-line-soft);
  flex-wrap: wrap;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 100%;
  background: var(--color-txt-4);
  flex-shrink: 0;
}
.online {
  background: #68d88b;
  box-shadow: 0 0 8px #68d88b44;
}
.agent-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  align-self: stretch;
  border-bottom: 2px solid var(--agent-color);
  padding: 10px 3px;
  font-size: 11px;
  white-space: nowrap;
}
.beta {
  font-size: 8px;
  letter-spacing: 0.4px;
  background: #598fcf22;
  color: #8abbf7;
  border-radius: 3px;
  padding: 1px 3px;
}
.agent-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px 18px;
  scrollbar-gutter: stable;
}
.agent-intro {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}
.bot-avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--agent-color);
  background: color-mix(in srgb, var(--agent-color) 16%, transparent);
  box-shadow: inset 0 0 16px
    color-mix(in srgb, var(--agent-color) 12%, transparent);
}
.agent-intro h2 {
  font-size: 13px;
  font-weight: 600;
}
.agent-intro p {
  font-size: 11px;
  color: var(--color-txt-3);
  margin-top: 5px;
  line-height: 1.6;
}
.welcome {
  max-width: 520px;
  background: linear-gradient(120deg, #ffffff06, #ffffff02);
  border: 1px solid #ffffff04;
  border-radius: 8px;
  padding: 16px;
  color: var(--color-txt-2);
  line-height: 1.8;
}
.welcome ul {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin: 18px 0;
}
.welcome li {
  display: flex;
  gap: 8px;
  align-items: center;
}
.welcome li svg {
  color: var(--agent-color);
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 22px;
}
.suggestions button {
  border: 1px solid var(--color-line-soft);
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 10.5px;
  color: var(--color-txt-2);
  background: #ffffff03;
  text-align: left;
  cursor: pointer;
}
.suggestions button:hover {
  border-color: var(--agent-color);
  color: var(--color-txt);
}
.suggestions span {
  color: var(--color-txt-4);
}
.messages {
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.provider {
  font-size: 10px;
  color: var(--color-txt-4);
  overflow-wrap: anywhere;
}
.message {
  min-width: 0;
}
.message-role {
  font-size: 10px;
  color: var(--agent-color);
}
.message p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
  margin-top: 5px;
}
.message.user {
  margin-left: 20px;
  padding: 10px 12px;
  background: #ffffff05;
  border-radius: 8px;
}
.message summary {
  display: flex;
  gap: 7px;
  align-items: center;
  cursor: pointer;
  list-style: none;
  color: var(--color-txt-3);
  font-size: 11px;
}
.message summary:hover {
  color: var(--color-txt);
}
.message pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
  background: #0004;
  border-radius: 6px;
  padding: 10px;
  font-size: 11px;
  margin-top: 8px;
}
.message.error {
  color: var(--color-danger);
}
.message.error summary {
  color: var(--color-danger);
}
.agent-footer {
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--color-line-soft);
}
.data-notice {
  font-size: 10px;
  color: var(--color-txt-4);
  line-height: 1.6;
  margin-bottom: 9px;
}
.data-notice svg {
  display: inline;
  vertical-align: middle;
  margin-right: 4px;
}
.data-notice button {
  color: var(--agent-color);
  margin-left: 5px;
  cursor: pointer;
}
.composer {
  display: flex;
  align-items: center;
  border: 1px solid var(--color-line);
  background: #ffffff04;
  border-radius: 7px;
  padding: 8px 10px;
  gap: 8px;
}
.composer:focus-within {
  border-color: var(--agent-color);
}
.composer textarea {
  resize: vertical;
  min-height: 36px;
  max-height: 130px;
  flex: 1;
  min-width: 0;
  outline: none;
  font-size: 12px;
  line-height: 1.6;
  background: transparent;
  color: var(--color-txt);
}
.composer textarea::placeholder {
  color: var(--color-txt-4);
}
.send-button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  color: var(--agent-color);
  cursor: pointer;
}
.send-button:disabled {
  opacity: 0.3;
  cursor: default;
}
.send-button:not(:disabled):hover {
  background: #ffffff0b;
}
.footer-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 9.5px;
  color: var(--color-txt-4);
  margin-top: 9px;
  flex-wrap: wrap;
}
</style>
