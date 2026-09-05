<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, toRefs } from "vue";
import * as api from "@/api/agent";
import AppButton from "@/components/ui/AppButton.vue";
import AppSwitch from "@/components/ui/AppSwitch.vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import { IS_TAURI } from "@/utils/window";

// 密钥仅存在于此输入框，保存后立即清空；不会回填已存储的密钥。
const state = reactive({
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
  hasApiKey: false,
  clearKey: false,
  busy: false,
  loading: true,
  error: "",
  message: "",
});
const {
  enabled,
  baseUrl,
  model,
  apiKey,
  hasApiKey,
  clearKey,
  busy,
  loading,
  error,
  message,
} = toRefs(state);
onMounted(async () => {
  try {
    if (IS_TAURI) Object.assign(state, await api.getConfig());
  } catch (error) {
    state.error = api.errorMessage(error);
  } finally {
    state.loading = false;
  }
});
onBeforeUnmount(() => {
  state.apiKey = "";
});
async function save(test = false): Promise<void> {
  if (state.busy || state.loading) return;
  state.busy = true;
  state.error = "";
  state.message = "";
  try {
    const config = await api.saveConfig(
      {
        enabled: state.enabled,
        baseUrl: state.baseUrl,
        model: state.model,
        apiKey: state.apiKey,
      },
      state.clearKey,
    );
    Object.assign(state, config);
    state.apiKey = "";
    state.clearKey = false;
    state.message = "AI 设置已保存，之前的运行与待审批操作已停止。";
    if (test) state.message = await api.testConfig();
  } catch (error) {
    state.error = api.errorMessage(error);
  } finally {
    state.busy = false;
  }
}
defineExpose({ save });
</script>

<template>
  <section class="ai-settings">
    <div class="flex items-center gap-2">
      <AppIcon name="lucide:bot" :size="21" class="text-accent" />
      <h2>AI Agent</h2>
      <span class="beta">BETA</span>
    </div>
    <p class="subtitle">在 SSH 终端与数据库旁协作，所有增删改操作逐次审批。</p>
    <p v-if="!IS_TAURI" class="notice">
      浏览器仅预览界面。请在桌面程序中配置和使用 AI。
    </p>
    <fieldset :disabled="loading || busy" class="space-y-5">
      <AppSwitch
        v-model="enabled"
        label="启用 AI Agent"
        description="使用你配置的模型服务；发送消息后才会读取目标数据"
      />
      <label class="field"
        >API 地址<input
          v-model="baseUrl"
          type="url"
          placeholder="https://api.openai.com/v1"
          autocomplete="off"
          spellcheck="false"
        /><span
          >兼容 OpenAI Chat Completions 与工具调用；填写基础地址，例如以 /v1
          结尾。</span
        ></label
      >
      <label class="field"
        >模型名称<input
          v-model="model"
          type="text"
          placeholder="输入服务商提供、支持工具调用的模型 ID"
          autocomplete="off"
          spellcheck="false"
          maxlength="200"
      /></label>
      <label class="field"
        >API Key <span v-if="hasApiKey" class="text-success">已安全保存</span
        ><input
          v-model="apiKey"
          type="password"
          :placeholder="
            hasApiKey ? '留空保留已保存密钥' : '输入密钥；本地免鉴权服务可留空'
          "
          autocomplete="new-password"
          spellcheck="false"
          maxlength="8192"
          :disabled="clearKey"
        /><span>Windows 用户级加密存储，不进入聊天或普通设置备份。</span></label
      >
      <label
        v-if="hasApiKey"
        class="flex items-center gap-2 text-[11px] text-txt-3"
        ><input v-model="clearKey" type="checkbox" />保存时清除旧密钥</label
      >
    </fieldset>
    <div class="security-rules">
      <h3><AppIcon name="lucide:shield-check" :size="14" />固定安全规则</h3>
      <ul>
        <li>服务器状态探针、数据库结构读取可自动执行。</li>
        <li>任意自定义 Shell、SQL 均需审批；无“全部允许”。</li>
        <li>审批锁定目标和原文，5 分钟过期，只执行一次。</li>
        <li>切换连接、关闭面板或停止任务会撤销待审批操作。</li>
        <li>对话仅保留在当前应用内存，清空后不再保留。</li>
      </ul>
      <p>
        你输入的消息及工具结果会发送给此模型服务。请确认服务可信，不要输入密码、密钥或不应外传的数据。只读放行不等于数据不会离开本机。
      </p>
    </div>
    <p
      v-if="error"
      role="alert"
      class="text-[12px] leading-relaxed text-danger"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
      class="text-[12px] leading-relaxed text-success"
    >
      {{ message }}
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <AppButton
        variant="primary"
        :disabled="busy || loading || !IS_TAURI"
        @click="save(false)"
        >保存 AI 设置</AppButton
      ><AppButton
        :disabled="busy || loading || !IS_TAURI || !enabled"
        @click="save(true)"
        >{{ busy ? "处理中…" : "保存并测试连接" }}</AppButton
      >
    </div>
    <p class="text-[10px] text-txt-4">
      测试仅发送一条固定测试消息，不读取服务器或数据库。服务商可能按其标准计费。
    </p>
  </section>
</template>
<style scoped>
.ai-settings {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 18px;
  overflow: auto;
  padding: 24px 26px;
}
.ai-settings h2 {
  font-size: 19px;
  font-weight: 600;
}
.subtitle {
  font-size: 12px;
  color: var(--color-txt-3);
  line-height: 1.6;
}
.beta {
  font-size: 8px;
  padding: 2px 4px;
  border-radius: 3px;
  background: #6f93da22;
  color: #a1baff;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: var(--color-txt-2);
}
.field input {
  width: 100%;
  border: 1px solid var(--color-line);
  background: var(--color-input, #ffffff04);
  padding: 9px 10px;
  border-radius: 6px;
  outline: none;
  font-size: 12px;
  color: var(--color-txt);
}
.field input:focus {
  border-color: var(--color-accent);
}
.field span {
  font-size: 10px;
  color: var(--color-txt-4);
  line-height: 1.6;
}
.security-rules {
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 14px;
  font-size: 11px;
  line-height: 1.8;
  color: var(--color-txt-3);
}
.security-rules h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-txt-2);
  margin-bottom: 8px;
  font-weight: 500;
}
.security-rules ul {
  list-style: disc;
  padding-left: 18px;
}
.security-rules p {
  border-top: 1px solid var(--color-line-soft);
  margin-top: 10px;
  padding-top: 10px;
}
.notice {
  font-size: 11px;
  color: var(--color-txt-3);
  border: 1px solid var(--color-line);
  padding: 10px;
  border-radius: 6px;
}
@container settings (max-width:560px) {
  .ai-settings {
    padding: 16px 12px;
  }
}
</style>
