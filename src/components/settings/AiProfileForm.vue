<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AgentProfileDraft } from '@/types/agent'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AiModelField from './AiModelField.vue'

const { t } = useI18n()
defineProps<{ disabled: boolean }>()
const draft = defineModel<AgentProfileDraft>({ required: true })
const formats = [
  { value: 'openai', label: 'OpenAI · Chat Completions' },
  { value: 'anthropic', label: 'Claude · Messages' },
]
</script>
<template>
  <fieldset
    :disabled="disabled"
    class="grid min-w-0 gap-5 border-0 p-0"
    :aria-label="t('模型服务配置')"
  >
    <div class="ai-setting-field">
      <label for="ai-profile-name">{{ t('配置名称') }}</label>
      <input
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
    <div class="ai-setting-field">
      <label for="ai-base-url">{{ t('API 地址') }}</label>
      <input
        id="ai-base-url"
        v-model="draft.baseUrl"
        type="url"
        placeholder="https://api.openai.com/v1"
        autocomplete="off"
        spellcheck="false"
        aria-describedby="ai-base-url-help"
      />
      <p
        id="ai-base-url-help"
        class="ai-field-help"
      >
        {{
          draft.apiFormat === 'anthropic'
            ? t('Claude Messages 格式；例如 https://api.anthropic.com/v1。')
            : t('OpenAI Chat Completions 格式；可连接官网或兼容的中转站。')
        }}
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
    <div class="ai-setting-field">
      <div class="ai-key-label">
        <label for="ai-api-key">API Key</label
        ><span
          v-if="draft.hasApiKey"
          class="text-success"
          >{{ t('已安全保存') }}</span
        >
      </div>
      <input
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
        class="ai-field-help"
      >
        {{ t('Windows 用户级加密存储，不进入聊天或普通设置备份。') }}
      </p>
    </div>
    <label
      v-if="draft.hasApiKey"
      class="text-txt-3 flex items-center gap-2 text-[11px]"
      ><input
        v-model="draft.clearKey"
        type="checkbox"
      />{{ t('保存时清除旧密钥') }}</label
    >
  </fieldset>
</template>
<style scoped>
.ai-setting-field {
  display: grid;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: var(--color-txt-2);
}
.ai-setting-field input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  border: 1px solid var(--color-line);
  background: var(--color-input, #ffffff04);
  padding: 9px 10px;
  border-radius: 6px;
  outline: none;
  font-size: 12px;
  color: var(--color-txt);
}
.ai-setting-field input:focus {
  border-color: var(--color-accent);
}
.ai-field-help {
  font-size: 10px;
  color: var(--color-txt-4);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.ai-key-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ai-key-label span {
  font-size: 10px;
}
</style>
