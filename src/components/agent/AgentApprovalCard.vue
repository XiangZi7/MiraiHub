<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, toRefs, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { AgentApproval } from '@/types/agent'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AgentCopyButton from './AgentCopyButton.vue'
import AgentFileDiff from './AgentFileDiff.vue'

const { t } = useI18n()

const props = defineProps<{
  approval: AgentApproval
  target: string
  busy: boolean
  canApplySql?: boolean
}>()
const emit = defineEmits<{
  decide: [approve: boolean, remember?: boolean]
  applySql: [sql: string]
}>()
// 每一条新审批都必须重新核对，不继承上一条的确认状态。
const state = reactive({ reviewed: false, criticalReviewed: false, time: Date.now() })
const { reviewed, criticalReviewed } = toRefs(state)
watch(
  () => props.approval.id,
  () => {
    state.reviewed = false
    state.criticalReviewed = false
    state.time = Date.now()
  }
)
useIntervalFn(() => {
  state.time = Date.now()
}, 1000)
const seconds = computed(() =>
  Math.max(0, Math.ceil((props.approval.expiresAt - state.time) / 1000))
)
const riskLabel = computed(() => ({ low: '低风险', medium: '中风险', high: '高风险', critical: '极高风险' })[props.approval.risk ?? 'high'])
const riskTone = computed(() => ({ low: 'text-success', medium: 'text-info', high: 'text-warning', critical: 'text-danger' })[props.approval.risk ?? 'high'])
const expired = computed(() => seconds.value === 0)
</script>

<template>
  <section
    class="approval"
    :aria-label="t('操作审批')"
  >
    <div class="flex items-center gap-2 font-medium" :class="riskTone">
      <span class="rounded border border-current px-1.5 text-[10px]">{{ t(riskLabel) }}</span>
      <AppIcon
        name="lucide:shield-alert"
        :size="16"
      />{{ expired ? t('审批已过期') : t('需要你的审批')
      }}<span class="ml-auto text-[10px] font-normal"
        >{{ Math.floor(seconds / 60) }}:{{
          String(seconds % 60).padStart(2, '0')
        }}</span
      >
    </div>
    <div
      class="text-txt-3 mt-3 flex items-center justify-between gap-2 text-[11px]"
    >
      <span>{{ t('执行目标（已锁定）') }}</span>
      <AgentCopyButton
        :text="target"
        :label="t('复制目标')"
      />
    </div>
    <p class="text-txt mt-1 font-mono text-[12px] break-all">{{ target }}</p>
    <div
      class="text-txt-3 mt-3 flex items-center justify-between gap-2 text-[11px]"
    >
      <span>{{ t(approval.label) }} · {{ t('完整内容') }}</span>
      <button
        v-if="canApplySql && approval.label === '执行 SQL'"
        type="button"
        class="text-accent hover:bg-hover cursor-pointer rounded px-2 py-1 text-xs"
        @click="emit('applySql', approval.command)"
      >
        {{ t('agent.applySql') }}
      </button>
      <AgentCopyButton
        :text="approval.command"
        :label="t('复制命令')"
      />
    </div>
    <pre
      v-if="!approval.fileChange"
      class="command"
      dir="ltr"
      >{{ approval.command }}</pre>
    <AgentFileDiff
      v-else
      :change="approval.fileChange"
    />
    <div class="text-txt-3 flex items-center justify-between gap-2 text-[11px]">
      <span>{{ t('AI 提议的原因') }}</span>
      <AgentCopyButton
        :text="approval.reason"
        :label="t('复制说明')"
      />
    </div>
    <p
      class="text-txt-2 mt-1 text-[12px] leading-relaxed break-words whitespace-pre-wrap"
    >
      {{ approval.reason }}
    </p>
    <p class="text-txt-3 mt-3 text-[11px] leading-relaxed">
      <span v-if="approval.preview" class="text-warning mb-2 block">{{ approval.preview.estimatedRows == null ? t('优化器无法估算影响范围，请核对完整 SQL') : t('优化器预估处理 {count} 行（实际影响行数以执行结果为准）', {count: approval.preview.estimatedRows}) }}</span>
      {{
        t(
          '仅批准这一次操作；结果会发给已配置的模型。操作可能立即生效，停止任务不会自动回滚。'
        )
      }}
    </p>
    <label
      class="text-txt-2 my-3 flex cursor-pointer items-start gap-2 text-[11px]"
      ><input
        v-model="reviewed"
        type="checkbox"
        class="accent-amber mt-0.5"
        :disabled="busy || expired"
      />
      {{ t('我已核对目标、完整命令及其影响') }}
    </label>
    <label v-if="approval.risk === 'critical'" class="text-danger my-3 flex items-start gap-2 text-[11px]"><input v-model="criticalReviewed" type="checkbox" :disabled="busy || expired" />{{ t('我理解此操作可能造成不可恢复的数据丢失或服务中断') }}</label>
    <div class="flex flex-wrap gap-2">
      <AppButton
        size="sm"
        :disabled="busy"
        @click="emit('decide', false)"
      >
        {{ t('拒绝并停止') }} </AppButton
      ><AppButton
        size="sm"
        variant="danger"
        :disabled="busy || expired || !reviewed || (approval.risk === 'critical' && !criticalReviewed)"
        @click="emit('decide', true)"
      >
        {{ t('批准本次执行') }}
      </AppButton>
      <AppButton v-if="approval.canRemember && approval.risk !== 'critical'" size="sm" :disabled="busy || expired || !reviewed" @click="emit('decide', true, true)">{{ t('本会话允许相同操作') }}</AppButton>
    </div>
  </section>
</template>
<style scoped>
.approval {
  user-select: text;
  border: 1px solid
    color-mix(in srgb, var(--color-amber) 40%, var(--color-line));
  background: color-mix(in srgb, var(--color-amber) 5%, var(--color-panel));
  border-radius: 10px;
  padding: 14px;
  color: color-mix(in srgb, var(--color-amber) 70%, var(--color-txt));
}
.command {
  margin: 8px 0 12px;
  padding: 12px;
  max-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in oklch, var(--color-violet) 45%, transparent)
    transparent;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--color-terminal);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  color: var(--color-txt);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  unicode-bidi: plaintext;
}
</style>
