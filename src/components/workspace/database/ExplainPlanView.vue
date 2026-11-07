<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, inject, nextTick, reactive, useTemplateRef, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AgentMarkdown from '@/components/agent/AgentMarkdown.vue'
import * as agent from '@/api/agent'
import {
  EXPLAIN_AGENT_TARGET,
  indexPlanNodes,
  maxPlanCost,
  mentionedPlanNodes,
  serializePlan,
  type PlanNode,
} from '@/utils/explain-plan'

const { t, locale } = useI18n()

const props = defineProps<{
  plan: PlanNode
  /** 递归时传入整棵树的最大代价，保持占比条同一刻度 */
  maxCost?: number
  depth?: number
  /** 根节点传入原始 SQL，用于 AI 解读 */
  sql?: string
  /** 递归时由根节点下发：节点编号、AI 提及的节点与当前聚焦节点 */
  ids?: Map<PlanNode, string>
  mentioned?: Set<string>
  activeId?: string
}>()

const isRoot = computed(() => props.depth === undefined)
const scale = computed(() => props.maxCost ?? maxPlanCost(props.plan))
const ratio = computed(() =>
  scale.value && props.plan.cost ? Math.max(4, (props.plan.cost / scale.value) * 100) : 0
)

const target = inject(EXPLAIN_AGENT_TARGET, undefined)
const rootEl = useTemplateRef<HTMLElement>('root')
const ownIds = computed(() => (isRoot.value ? indexPlanNodes(props.plan) : undefined))
const nodeIds = computed(() => props.ids ?? ownIds.value ?? new Map<PlanNode, string>())
const nodeId = computed(() => nodeIds.value.get(props.plan) ?? '')

const ai = reactive({ loading: false, text: '', error: '', active: '', token: 0 })
const aiMentioned = computed(() => new Set(mentionedPlanNodes(ai.text)))
const mentionSet = computed(() => props.mentioned ?? aiMentioned.value)
const focused = computed(() => props.activeId ?? ai.active)
const highlighted = computed(() => !!nodeId.value && mentionSet.value.has(nodeId.value))
const canExplain = computed(
  () => isRoot.value && !!props.sql?.trim() && !!target?.value.sessionId
)
const labels = computed(() => {
  const out = new Map<string, string>()
  for (const [node, id] of nodeIds.value)
    out.set(id, node.target ? `${node.label} · ${node.target}` : node.label)
  return out
})

// 计划或 SQL 变化后旧解读不再对应当前节点编号，直接作废并丢弃迟到的响应。
watch(
  () => [props.plan, props.sql] as const,
  () => {
    ai.token++
    Object.assign(ai, { loading: false, text: '', error: '', active: '' })
  }
)

async function explain(): Promise<void> {
  if (!canExplain.value || !target) return
  const token = ++ai.token
  Object.assign(ai, { loading: true, text: '', error: '', active: '' })
  try {
    const text = await agent.explainPlan(
      target.value,
      props.sql ?? '',
      serializePlan(props.plan, nodeIds.value),
      locale.value.startsWith('zh') ? 'Simplified Chinese' : 'English'
    )
    if (token === ai.token) ai.text = text
  } catch (error) {
    if (token === ai.token) ai.error = agent.errorMessage(error)
  } finally {
    if (token === ai.token) ai.loading = false
  }
}

async function focusNode(id: string): Promise<void> {
  ai.active = ai.active === id ? '' : id
  await nextTick()
  rootEl.value
    ?.querySelector(`[data-plan-node="${id}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
</script>

<template>
  <div
    ref="root"
    :class="depth ? 'border-line-soft ml-3 border-l pl-3' : ''"
  >
    <div
      v-if="canExplain"
      class="mb-2 flex flex-col gap-2"
    >
      <div class="flex items-center gap-2">
        <AppButton
          size="sm"
          :disabled="ai.loading"
          @click="explain"
        >
          <AppIcon
            :name="ai.loading ? 'lucide:loader-circle' : 'lucide:sparkles'"
            :size="13"
            :class="ai.loading ? 'motion-safe:animate-spin' : ''"
          />
          {{ ai.text || ai.error ? t('重新解读') : t('AI 解读') }}
        </AppButton>
        <span class="text-txt-4 text-agent-small truncate">
          {{ t('发送 SQL、执行计划与相关表索引给当前 AI 配置') }}
        </span>
      </div>
      <Transition
        name="fade"
        appear
      >
      <div
        v-if="ai.loading || ai.text || ai.error"
        class="border-line-soft bg-panel/60 text-agent-body rounded-lg border p-3"
      >
        <p
          v-if="ai.loading"
          class="text-txt-3 flex items-center gap-2"
        >
          <AppIcon
            name="lucide:loader-circle"
            :size="13"
            class="motion-safe:animate-spin"
          />
          {{ t('AI 正在解读执行计划…') }}
        </p>
        <p
          v-else-if="ai.error"
          class="text-danger flex items-start gap-2 break-all"
        >
          <AppIcon
            name="lucide:circle-alert"
            :size="13"
            class="mt-0.5 shrink-0"
          />
          {{ ai.error }}
        </p>
        <template v-else>
          <div
            v-if="aiMentioned.size"
            class="mb-2 flex flex-wrap items-center gap-1.5"
          >
            <span class="text-txt-4 text-agent-small">{{ t('相关节点') }}</span>
            <button
              v-for="id in aiMentioned"
              :key="id"
              type="button"
              :class="[
                'rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] transition-colors motion-reduce:transition-none',
                ai.active === id
                  ? 'border-amber bg-amber/15 text-amber'
                  : 'border-line-soft text-txt-3 hover:bg-hover',
              ]"
              :title="labels.get(id)"
              @click="focusNode(id)"
            >
              {{ id }}
            </button>
          </div>
          <AgentMarkdown :content="ai.text" />
        </template>
      </div>
      </Transition>
    </div>
    <div
      :data-plan-node="nodeId"
      :class="[
        'group flex min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 transition-colors motion-reduce:transition-none',
        focused && focused === nodeId
          ? 'bg-amber/15 ring-amber/60 ring-1'
          : highlighted
            ? 'bg-amber/8 hover:bg-amber/12'
            : 'hover:bg-hover/60',
      ]"
    >
      <div class="flex min-w-0 items-center gap-2 text-[11.5px]">
        <AppIcon
          :name="plan.warning ? 'lucide:triangle-alert' : 'lucide:git-commit-horizontal'"
          :size="13"
          :class="plan.warning ? 'text-amber shrink-0' : 'text-txt-4 shrink-0'"
        />
        <span
          v-if="nodeId && mentionSet.size"
          :class="['shrink-0 font-mono text-[10px]', highlighted ? 'text-amber' : 'text-txt-4']"
          >{{ nodeId }}</span
        >
        <span class="text-txt font-medium">{{ plan.label }}</span>
        <span
          v-if="plan.target"
          class="text-accent truncate font-mono"
          >{{ plan.target }}</span
        >
        <span class="flex-1" />
        <span
          v-if="plan.rows !== undefined"
          class="text-txt-3 shrink-0 font-mono text-[10.5px]"
          >{{ t('约 {count} 行', { count: plan.rows }) }}</span
        >
        <span
          v-if="plan.cost !== undefined"
          class="text-txt-3 w-20 shrink-0 text-right font-mono text-[10.5px]"
          >cost {{ plan.cost.toFixed(1) }}</span
        >
      </div>
      <div
        v-if="ratio"
        class="bg-line-soft h-1 overflow-hidden rounded-full"
      >
        <div
          :class="['h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', plan.warning ? 'bg-amber' : 'bg-accent']"
          :style="{ width: `${ratio}%` }"
        />
      </div>
      <p
        v-if="plan.detail"
        class="text-txt-4 truncate font-mono text-[10.5px]"
        :title="plan.detail"
      >
        {{ plan.detail }}
      </p>
    </div>
    <ExplainPlanView
      v-for="(child, index) in plan.children"
      :key="index"
      :plan="child"
      :max-cost="scale"
      :depth="(depth ?? 0) + 1"
      :ids="nodeIds"
      :mentioned="mentionSet"
      :active-id="focused"
    />
  </div>
</template>
