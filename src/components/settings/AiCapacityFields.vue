<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentLimits } from '@/types/agent'
import {
  AGENT_CAPACITY_PRESETS,
  AGENT_LIMIT_RANGES,
  agentCapacityPreset,
} from '@/constants/agent-limits'
import AppSelect from '@/components/ui/AppSelect.vue'

const { t } = useI18n()
defineProps<{ disabled: boolean }>()
const limits = defineModel<AgentLimits>({ required: true })
const state = reactive({ custom: false })
const fields = [
  { key: 'maxSteps', label: '每轮模型请求次数' },
  { key: 'maxContextKb', label: '上下文容量（KB）' },
  { key: 'maxMessages', label: '历史消息数（含工具结果）' },
] satisfies { key: keyof AgentLimits; label: string }[]
const preset = computed({
  get: () => (state.custom ? 'custom' : agentCapacityPreset(limits.value)),
  set: (value: string) => {
    state.custom = value === 'custom'
    const selected = AGENT_CAPACITY_PRESETS.find(item => item.value === value)
    if (selected) limits.value = { ...selected.limits }
  },
})
const options = computed(() => [
  ...AGENT_CAPACITY_PRESETS.map(item => ({
    value: item.value,
    label: t(item.label),
    description: t('ai.capacitySummary', {
      steps: item.limits.maxSteps,
      kb: item.limits.maxContextKb,
      messages: item.limits.maxMessages,
    }),
  })),
  {
    value: 'custom',
    label: t('自定义'),
    description: t('分别调整请求次数、上下文容量和历史消息数'),
  },
])
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
          >{{ t(field.label) }}</label
        >
        <template v-if="preset === 'custom'">
          <input
            :id="`ai-capacity-${field.key}`"
            v-model.number="limits[field.key]"
            type="number"
            step="1"
            :min="AGENT_LIMIT_RANGES[field.key].min"
            :max="AGENT_LIMIT_RANGES[field.key].max"
            :disabled="disabled"
            required
            :aria-describedby="`ai-capacity-range-${field.key}`"
          />
          <span
            :id="`ai-capacity-range-${field.key}`"
            class="capacity-help"
            >{{ AGENT_LIMIT_RANGES[field.key].min }}–{{
              AGENT_LIMIT_RANGES[field.key].max
            }}</span
          >
        </template>
        <strong v-else>{{ limits[field.key] }}</strong>
      </div>
    </div>
    <p class="capacity-help">
      {{
        t(
          '上下文按本地消息大小计算，非 Token 数；实际仍受模型服务限制。调大容量可能增加耗时和用量。'
        )
      }}
    </p>
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
.capacity-field input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 6px 8px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-input, #ffffff04);
  color: var(--color-txt);
  font-size: 12px;
  outline: none;
}
.capacity-field input:focus {
  border-color: var(--color-accent);
}
.capacity-field input:invalid {
  border-color: var(--color-danger);
}
.capacity-help {
  color: var(--color-txt-4);
  font-size: 10px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
