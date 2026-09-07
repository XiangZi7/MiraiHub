<script setup lang="ts">
import { ref } from 'vue'
import { useAgentSettings } from '@/composables/useAgentSettings'
import { AGENT_PROVIDER_PRESETS } from '@/constants/agent-providers'
import AppButton from '@/components/ui/AppButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AiProfileForm from './AiProfileForm.vue'
import { IS_TAURI } from '@/utils/window'
const {
  selectedId,
  preset,
  draft,
  options,
  loading,
  busy,
  error,
  message,
  add,
  save,
  remove,
} = useAgentSettings()
defineExpose({ save })
const deleting = ref(false)
function confirmDelete(): void {
  deleting.value = false
  void remove()
}
</script>

<template>
  <section
    class="ai-settings"
    aria-labelledby="ai-settings-title"
  >
    <div
      class="ai-settings-scroll scroll-thin"
      role="region"
      aria-label="AI 配置内容"
      tabindex="0"
    >
      <div class="ai-settings-content">
        <header class="ai-settings-heading">
          <AppIcon
            name="lucide:bot"
            :size="21"
            class="text-accent"
          />
          <h2 id="ai-settings-title">AI Agent</h2>
          <span class="beta">BETA</span>
        </header>
        <p class="subtitle">
          在 SSH 终端与数据库旁协作，所有增删改操作逐次审批。
        </p>
        <p
          v-if="!IS_TAURI"
          class="notice"
        >
          浏览器仅预览界面。请在桌面程序中配置和使用 AI。
        </p>
        <fieldset
          :disabled="loading || busy"
          class="grid min-w-0 gap-3 border-0 p-0"
          aria-label="配置管理"
        >
          <AppSelect
            v-model="selectedId"
            label="已保存的配置"
            :options="options"
            :disabled="loading || busy"
            searchable
          />
          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <AppSelect
                v-model="preset"
                label="添加配置"
                :options="AGENT_PROVIDER_PRESETS"
                :disabled="loading || busy"
              />
            </div>
            <AppButton
              :disabled="loading || busy"
              @click="add"
              ><AppIcon
                name="lucide:plus"
                :size="13"
              />添加</AppButton
            >
          </div>
          <p class="ai-field-help">
            同一服务可添加多份官网或中转站配置，分别保存地址、密钥和模型。
          </p>
        </fieldset>
        <AiProfileForm
          v-if="draft"
          :key="selectedId"
          :model-value="draft"
          :disabled="loading || busy || !IS_TAURI"
        />
        <div class="security-rules">
          <h3>
            <AppIcon
              name="lucide:shield-check"
              :size="14"
            />固定安全规则
          </h3>
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
      </div>
    </div>
    <footer class="ai-settings-footer">
      <p
        v-if="error"
        role="alert"
        class="ai-settings-feedback scroll-thin text-danger"
      >
        {{ error }}
      </p>
      <p
        v-if="message"
        role="status"
        class="ai-settings-feedback scroll-thin text-success"
      >
        {{ message }}
      </p>
      <div class="ai-settings-actions">
        <AppButton
          variant="primary"
          :disabled="busy || loading || !IS_TAURI"
          @click="save(false)"
          >保存并使用</AppButton
        >
        <AppButton
          :disabled="busy || loading || !IS_TAURI || !draft?.enabled"
          @click="save(true)"
          >{{ busy ? '处理中…' : '保存并测试连接' }}</AppButton
        >
        <AppButton
          :disabled="busy || loading || !draft || !IS_TAURI"
          variant="ghost"
          @click="deleting = true"
          >删除当前配置</AppButton
        >
      </div>
      <p class="ai-field-help">
        切换配置会停止并清空旧对话。测试仅发送固定测试消息，不读取服务器或数据库。服务商可能按其标准计费。
      </p>
    </footer>
    <AppConfirmDialog
      :open="deleting"
      title="删除 AI 配置"
      :description="`删除「${draft?.name ?? ''}」及其保存的密钥？`"
      confirm-label="删除配置"
      danger
      @close="deleting = false"
      @confirm="confirmDelete"
    />
  </section>
</template>

<style scoped>
.ai-settings {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.ai-settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
  scroll-padding-block: 20px;
  outline: none;
}
.ai-settings-scroll:focus-visible {
  box-shadow: inset 0 0 0 1px var(--color-line-strong);
}
/* Content grows naturally inside the bounded scroller; field groups never shrink to a fixed row. */
.ai-settings-content {
  display: grid;
  gap: 18px;
  min-width: 0;
  padding: 24px 20px 24px 26px;
  overflow-wrap: anywhere;
}
.ai-settings-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-settings-heading h2 {
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
.ai-field-help {
  font-size: 10px;
  color: var(--color-txt-4);
  line-height: 1.6;
  overflow-wrap: anywhere;
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
.ai-settings-footer {
  display: grid;
  flex: none;
  gap: 8px;
  min-width: 0;
  padding: 12px 20px;
  border-top: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-panel) 65%, transparent);
}
.ai-settings-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ai-settings-feedback {
  max-height: 64px;
  overflow-y: auto;
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
@container settings (max-width: 560px) {
  .ai-settings-content {
    padding: 16px 10px 20px 14px;
  }
  .ai-settings-footer {
    padding: 10px 12px;
  }
  .ai-settings-actions {
    gap: 6px;
  }
  .ai-settings-actions :deep(button) {
    padding-inline: 8px;
    font-size: 11px;
  }
}
</style>
