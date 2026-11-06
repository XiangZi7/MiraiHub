<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type {
  AgentApiFormat,
  AgentPricing,
  AgentProfileDraft,
} from '@/types/agent'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AiModelField from './AiModelField.vue'
import AiCapacityFields from './AiCapacityFields.vue'

const { t } = useI18n()
defineProps<{ disabled: boolean }>()
const draft = defineModel<AgentProfileDraft>({ required: true })
const formats = [
  { value: 'openai', label: 'OpenAI · Chat Completions' },
  { value: 'responses', label: 'OpenAI · Responses' },
  { value: 'anthropic', label: 'Claude · Messages' },
]
const formatHelp: Record<AgentApiFormat, string> = {
  openai: 'OpenAI Chat Completions 格式；可连接官网或兼容的中转站。',
  responses:
    'OpenAI Responses 格式；适用于使用 /responses 接口的模型或中转站。',
  anthropic: 'Claude Messages 格式；例如 https://api.anthropic.com/v1。',
}
const pricingFields = ['input', 'output', 'cached'] as const
/**
 * AppInput 的模型声明为 string，但 type="number" 时 Vue 的 v-model 会回传数字（清空时为 ''），
 * 与原生 v-model.number 一致。这里原样透传，避免 String() 往返改写正在输入的 "0.0"。
 */
function priceInput(value: number | null): string {
  return value as unknown as string
}
function setPrice(field: keyof AgentPricing, value: string): void {
  if (draft.value.pricing)
    draft.value.pricing[field] = value as unknown as number | null
}
/** 清空或非法输入在提交（change）时归一为 null，表示不估算费用。 */
function normalizePrice(field: keyof AgentPricing): void {
  const pricing = draft.value.pricing
  if (pricing)
    pricing[field] = typeof pricing[field] === 'number' ? pricing[field] : null
}
</script>
<template>
  <fieldset
    :disabled="disabled"
    class="grid min-w-0 gap-5 border-0 p-0"
    :aria-label="t('模型服务配置')"
  >
    <div class="text-txt-2 grid min-w-0 gap-2 text-xs">
      <label for="ai-profile-name">{{ t('配置名称') }}</label>
      <AppInput
        id="ai-profile-name"
        v-model="draft.name"
        :placeholder="t('例如：Claude 官网、OpenAI 中转站')"
        maxlength="80"
      />
    </div>
    <AppSelect
      v-model="draft.apiFormat"
      :label="t('API 格式')"
      :options="formats"
      :disabled="disabled"
    />
    <AppSwitch
      v-model="draft.enabled"
      :label="t('启用此配置')"
      :description="t('使用你配置的模型服务；发送消息后才会读取目标数据')"
    />
    <div class="text-txt-2 grid min-w-0 gap-2 text-xs">
      <label for="ai-base-url">{{ t('API 地址') }}</label>
      <!-- 原 type="url" 会裁掉首尾空白，这里用 .trim 保持一致。 -->
      <AppInput
        id="ai-base-url"
        v-model.trim="draft.baseUrl"
        inputmode="url"
        placeholder="https://api.openai.com/v1"
        autocomplete="off"
        spellcheck="false"
        aria-describedby="ai-base-url-help"
      />
      <p
        id="ai-base-url-help"
        class="text-txt-4 text-[10px] leading-[1.6] wrap-anywhere"
      >
        {{ t(formatHelp[draft.apiFormat]) }}
        {{ t('基础地址可按服务商要求修改。') }}
      </p>
    </div>
    <AiModelField
      v-model="draft.model"
      :profile-id="draft.id"
      :api-format="draft.apiFormat"
      :base-url="draft.baseUrl"
      :api-key="draft.apiKey"
      :clear-key="draft.clearKey"
      :disabled="disabled"
    />
    <div class="text-txt-2 grid min-w-0 gap-2 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <label for="ai-api-key">API Key</label
        ><span
          v-if="draft.hasApiKey"
          class="text-success text-[10px]"
          >{{ t('已安全保存') }}</span
        >
      </div>
      <AppInput
        id="ai-api-key"
        v-model="draft.apiKey"
        type="password"
        :placeholder="
          draft.hasApiKey
            ? t('留空保留已保存密钥')
            : t('输入密钥；本地免鉴权服务可留空')
        "
        autocomplete="new-password"
        spellcheck="false"
        maxlength="8192"
        :disabled="draft.clearKey"
        aria-describedby="ai-key-help"
      />
      <p
        id="ai-key-help"
        class="text-txt-4 text-[10px] leading-[1.6] wrap-anywhere"
      >
        {{ t('Windows 用户级加密存储，不进入聊天或普通设置备份。') }}
      </p>
    </div>
    <AppCheckbox
      v-if="draft.hasApiKey"
      v-model="draft.clearKey"
      :label="t('保存时清除旧密钥')"
      :disabled="disabled"
    />
    <AiCapacityFields
      v-model="draft.limits"
      :disabled="disabled"
    />
    <div
      v-if="draft.pricing"
      class="grid gap-3"
    >
      <p class="text-txt-2 text-xs">
        {{ t('每百万 Token 单价（USD，留空不估算费用）') }}
      </p>
      <label
        v-for="field in pricingFields"
        :key="field"
        class="text-txt-3 grid grid-cols-2 items-center gap-2 text-xs"
        >{{
          t(
            { input: '输入单价', output: '输出单价', cached: '缓存读取单价' }[
              field
            ]
          )
        }}<AppInput
          :model-value="priceInput(draft.pricing[field])"
          type="number"
          min="0"
          max="1000000"
          step="any"
          @update:model-value="setPrice(field, $event)"
          @change="normalizePrice(field)"
      /></label>
    </div>
  </fieldset>
</template>
