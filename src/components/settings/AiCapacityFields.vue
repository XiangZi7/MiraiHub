<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentLimits } from '@/types/agent'
import {
  AGENT_CAPACITY_PRESETS,
  AGENT_LIMIT_RANGES,
  agentCapacityPreset,
  formatAgentContextSize,
} from '@/constants/agent-limits'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

const { t } = useI18n()
defineProps<{ disabled: boolean }>()
const limits = defineModel<AgentLimits>({ required: true })
// 响应式状态
const state = reactive({
  // 显式选择自定义后，输入值即使与预设相同也保持可编辑。
  custom: false,
})
const fields = [
  { key: 'maxSteps', label: '每轮模型请求次数' },
  { key: 'maxContextKb', label: '本地上下文容量' },
  { key: 'maxMessages', label: '历史消息数（含工具结果）' },
] satisfies { key: keyof AgentLimits; label: string }[]
const preset = computed({
  get: () => (state.custom ? 'custom' : agentCapacityPreset(limits.value)),
  set: (value: string) => {
    state.custom = value === 'custom'
    const selected = AGENT_CAPACITY_PRESETS.find(item => item.value === value)
    if (selected) limits.value = { ...limits.value, ...selected.limits }
  },
})
const options = computed(() => [
  ...AGENT_CAPACITY_PRESETS.map(item => ({
    value: item.value,
    label: t(item.label),
    description: t('ai.capacitySummary', {
      steps: item.limits.maxSteps,
      capacity: formatAgentContextSize(item.limits.maxContextKb),
      messages: item.limits.maxMessages,
    }),
  })),
  {
    value: 'custom',
    label: t('自定义'),
    description: t('分别调整请求次数、上下文容量和历史消息数'),
  },
])
/**
 * AppInput 的模型声明为 string，但 type="number" 时 Vue 的 v-model 会回传数字（清空时为 ''），
 * 与原生 v-model.number 一致。这里原样透传并就地写回，避免 String() 往返改写正在输入的值。
 */
function limitInput(key: keyof AgentLimits): string {
  return limits.value[key] as unknown as string
}
function setLimit(key: keyof AgentLimits, value: string): void {
  limits.value[key] = value as unknown as number
}
</script>

<template>
  <section
    class="ai-capacity"
    aria-labelledby="ai-capacity-title"
  >
    <h3 id="ai-capacity-title">{{ t('任务容量') }}</h3>
    <p class="capacity-help">
      {{
        t('每份 AI 配置独立保存，SSH 与数据库共用。复杂任务可选择增强或深度。')
      }}
    </p>
    <AppSelect
      v-model="preset"
      :label="t('容量预设')"
      :options="options"
      :disabled="disabled"
    />
    <div class="capacity-values">
      <div
        v-for="field in fields"
        :key="field.key"
        class="capacity-field"
      >
        <label
          :for="preset === 'custom' ? `ai-capacity-${field.key}` : undefined"
          >{{
            t(
              field.key === 'maxContextKb' && preset === 'custom'
                ? '本地上下文容量（KB）'
                : field.label
            )
          }}</label
        >
        <template v-if="preset === 'custom'">
          <AppInput
            :id="`ai-capacity-${field.key}`"
            :model-value="limitInput(field.key)"
            type="number"
            class="invalid:border-danger"
            step="1"
            :min="AGENT_LIMIT_RANGES[field.key].min"
            :max="AGENT_LIMIT_RANGES[field.key].max"
            :disabled="disabled"
            required
            :aria-describedby="`ai-capacity-range-${field.key}`"
            @update:model-value="setLimit(field.key, $event)"
          />
          <span
            :id="`ai-capacity-range-${field.key}`"
            class="capacity-help"
            >{{
              field.key === 'maxContextKb'
                ? t('ai.contextCapacityRange', {
                    capacity: formatAgentContextSize(limits.maxContextKb),
                    min: AGENT_LIMIT_RANGES.maxContextKb.min,
                    max: AGENT_LIMIT_RANGES.maxContextKb.max,
                  })
                : `${AGENT_LIMIT_RANGES[field.key].min}–${AGENT_LIMIT_RANGES[field.key].max}`
            }}</span
          >
        </template>
        <strong v-else>{{
          field.key === 'maxContextKb'
            ? formatAgentContextSize(limits.maxContextKb)
            : limits[field.key]
        }}</strong>
      </div>
    </div>
    <p class="capacity-help">
      {{
        t(
          '这是本地消息容量，不会扩大模型的上下文窗口；达到约 85% 时自动压缩。模型服务仍有独立的 Token 限制，调大容量可能增加耗时和用量。'
        )
      }}
    </p>
    <div class="grid min-w-0 gap-2">
      <label
        for="ai-context-window"
        class="text-txt-3 text-[11px]"
        >{{ t('agent.modelWindow') }}</label
      >
      <AppInput
        id="ai-context-window"
        :model-value="limitInput('contextWindowTokens')"
        type="number"
        step="1"
        min="16384"
        max="2000000"
        :disabled="disabled"
        required
        aria-describedby="ai-model-budget-help"
        @update:model-value="setLimit('contextWindowTokens', $event)"
      />
      <label
        for="ai-output-tokens"
        class="text-txt-3 text-[11px]"
        >{{ t('agent.outputLimit') }}</label
      >
      <AppInput
        id="ai-output-tokens"
        :model-value="limitInput('maxOutputTokens')"
        type="number"
        step="1"
        min="256"
        max="131072"
        :disabled="disabled"
        required
        aria-describedby="ai-model-budget-help"
        @update:model-value="setLimit('maxOutputTokens', $event)"
      />
      <p
        id="ai-model-budget-help"
        class="text-txt-4 text-[11px] leading-relaxed"
      >
        {{ t('agent.modelBudgetHelp') }}
      </p>
    </div>
    <div class="capacity-field">
      <label for="ai-max-retries">{{ t('ai.maxRetries') }}</label>
      <AppInput
        id="ai-max-retries"
        :model-value="limitInput('maxRetries')"
        type="number"
        class="invalid:border-danger"
        step="1"
        :min="AGENT_LIMIT_RANGES.maxRetries.min"
        :max="AGENT_LIMIT_RANGES.maxRetries.max"
        :disabled="disabled"
        required
        aria-describedby="ai-retries-help"
        @update:model-value="setLimit('maxRetries', $event)"
      />
      <p
        id="ai-retries-help"
        class="capacity-help"
      >
        {{ t('ai.retryHelp') }}
      </p>
    </div>
    <p class="capacity-help">{{ t('保存后生效；可从聊天记录继续原会话。') }}</p>
  </section>
</template>

<style scoped>
.ai-capacity {
  display: grid;
  gap: 12px;
  min-width: 0;
  border-top: 1px solid var(--color-line-soft);
  padding-top: 18px;
}
.ai-capacity h3 {
  color: var(--color-txt-2);
  font-size: 13px;
  font-weight: 500;
}
.capacity-values {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 135px), 1fr));
  gap: 12px;
  padding: 12px;
  background: var(--color-input, #ffffff04);
  border: 1px solid var(--color-line);
  border-radius: 8px;
}
.capacity-field {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}
.capacity-field label {
  color: var(--color-txt-3);
  font-size: 11px;
  line-height: 1.5;
}
.capacity-field strong {
  color: var(--color-txt);
  font-size: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.capacity-help {
  color: var(--color-txt-4);
  font-size: 10px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
