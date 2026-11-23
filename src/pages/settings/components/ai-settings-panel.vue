<script setup lang="ts">
import { translateNativeMessage } from '@/i18n/native'
import { useI18n } from 'vue-i18n'
import { ref } from 'vue'
import { useAgentSettings } from '@/composables/useAgentSettings'
import { AGENT_PROVIDER_PRESETS } from '@/constants/agent-providers'
import AppButton from '@/components/ui/AppButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AiProfileForm from '@/pages/settings/components/ai-profile-form.vue'
import McpServersPanel from '@/pages/settings/components/mcp-servers-panel.vue'
import AgentPromptsDialog from '@/components/agent/agent-prompts-dialog.vue'
import { IS_TAURI } from '@/utils/window'
import { translateLabel } from '@/i18n'

const { t } = useI18n()
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
const managingPrompts = ref(false)
/** 确认删除当前 AI 配置，关闭确认框后执行删除。 */
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
      :aria-label="t('AI 配置内容')"
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
          {{ t('在 SSH 终端与数据库旁协作，可在输入框中选择操作审批方式。') }}
        </p>
        <p
          v-if="!IS_TAURI"
          class="notice"
        >
          {{ t('浏览器仅预览界面。请在桌面程序中配置和使用 AI。') }}
        </p>
        <fieldset
          :disabled="loading || busy"
          class="ai-config-management"
          :aria-label="t('配置管理')"
        >
          <legend class="section-title">{{ t('配置管理') }}</legend>
          <div class="ai-config-grid">
            <!-- 已保存的配置选择：在当前值和候选项中显示图标。 -->
            <AppSelect
              icon="lucide:bot"
              v-model="selectedId"
              :label="t('已保存的配置')"
              :options="options"
              :disabled="loading || busy"
              searchable
            />
            <div class="flex items-end gap-2">
              <div class="min-w-0 flex-1">
                <!-- 添加配置选择：在当前值和候选项中显示图标。 -->
                <AppSelect
                  icon="lucide:circle-plus"
                  v-model="preset"
                  :label="t('添加配置')"
                  :options="
                    AGENT_PROVIDER_PRESETS.map(option => ({
                      ...option,
                      label: translateLabel(option.label),
                    }))
                  "
                  :disabled="loading || busy"
                />
              </div>
              <AppButton
                :disabled="loading || busy"
                @click="add"
                ><AppIcon
                  name="lucide:plus"
                  :size="13"
                />{{ t('添加') }}</AppButton
              >
            </div>
          </div>
          <p class="ai-field-help">
            {{
              t(
                '同一服务可添加多份官网或中转站配置，分别保存地址、密钥和模型。'
              )
            }}
          </p>
        </fieldset>
        <!-- 模型服务区：连接表单与按需展开的高级选项。 -->
        <AiProfileForm
          v-if="draft"
          :key="selectedId"
          :model-value="draft"
          :disabled="loading || busy || !IS_TAURI"
        />
        <!-- 扩展工具区：MCP 独立于模型配置和固定安全规则。 -->
        <div class="ai-extension-card">
          <McpServersPanel />
        </div>
        <!-- 安全说明区：集中展示审批与数据外传边界。 -->
        <div class="security-rules">
          <h3>
            <AppIcon
              name="lucide:shield-check"
              :size="14"
            />{{ t('固定安全规则') }}
          </h3>
          <ul>
            <li>{{ t('服务器状态探针、数据库结构读取可自动执行。') }}</li>
            <li>{{ t('按所选权限审批工具；会话授权只匹配相同操作。') }}</li>
            <li>{{ t('审批锁定目标和原文，5 分钟过期，只执行一次。') }}</li>
            <li>{{ t('切换连接、关闭面板或停止任务会撤销待审批操作。') }}</li>
            <li>{{ t('聊天记录在本机加密保存，可从聊天记录菜单管理。') }}</li>
          </ul>
          <p>
            {{
              t(
                '你输入的消息及工具结果会发送给此模型服务。请确认服务可信，不要输入密码、密钥或不应外传的数据。只读放行不等于数据不会离开本机。'
              )
            }}
          </p>
        </div>
        <!-- 提示词区：独立入口，不与安全规则混排。 -->
        <div class="ai-prompt-card">
          <h3 class="section-title">{{ t('管理提示词模板') }}</h3>
          <AppButton @click="managingPrompts = true">{{
            t('管理提示词模板')
          }}</AppButton>
          <Teleport to="body"
            ><AgentPromptsDialog
              v-if="managingPrompts"
              @close="managingPrompts = false"
          /></Teleport>
        </div>
      </div>
    </div>
    <footer class="ai-settings-footer">
      <p
        v-if="error"
        role="alert"
        class="ai-settings-feedback scroll-thin text-danger"
      >
        {{ translateNativeMessage(error) }}
      </p>
      <p
        v-if="message"
        role="status"
        class="ai-settings-feedback scroll-thin text-success"
      >
        {{ translateNativeMessage(message) }}
      </p>
      <div class="ai-settings-actions">
        <AppButton
          variant="primary"
          :disabled="busy || loading || !IS_TAURI"
          @click="save(false)"
          >{{ t('保存并使用') }}</AppButton
        >
        <AppButton
          :disabled="busy || loading || !IS_TAURI || !draft?.enabled"
          @click="save(true)"
          >{{ busy ? t('处理中…') : t('保存并测试连接') }}</AppButton
        >
        <AppButton
          :disabled="busy || loading || !draft || !IS_TAURI"
          variant="ghost"
          class="ai-delete-action"
          @click="deleting = true"
          >{{ t('删除当前配置') }}</AppButton
        >
      </div>
      <p class="ai-field-help">
        {{
          t(
            '保存或切换配置会停止当前任务，并在当前会话继续对话。测试仅发送固定测试消息，不读取服务器或数据库。服务商可能按其标准计费。'
          )
        }}
      </p>
    </footer>
    <AppConfirmDialog
      :open="deleting"
      :title="t('删除 AI 配置')"
      :description="t('ai.deleteDescription', { name: draft?.name ?? '' })"
      :confirm-label="t('删除配置')"
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
  width: 100%;
  max-width: 920px;
  margin-inline: auto;
  padding: 24px;
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
  background: color-mix(in oklch, var(--color-blue) 14%, transparent);
  color: var(--color-blue);
}
.ai-field-help {
  font-size: 10px;
  color: var(--color-txt-3);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.ai-config-management,
.ai-extension-card,
.ai-prompt-card,
.security-rules {
  min-width: 0;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  padding: 18px;
  background: color-mix(in oklch, var(--color-panel) 45%, transparent);
}
.ai-config-management {
  display: grid;
  gap: 12px;
}
.section-title {
  color: var(--color-txt);
  font-size: 13px;
  font-weight: 600;
}
.ai-config-management legend {
  float: left;
  width: 100%;
}
.ai-config-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
.ai-prompt-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ai-delete-action {
  margin-inline-start: auto;
}
.security-rules {
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
@media (prefers-reduced-motion: no-preference) {
  .ai-settings-content {
    animation: ai-settings-enter 180ms ease-out;
  }
}
@keyframes ai-settings-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@container settings (max-width: 680px) {
  .ai-config-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container settings (max-width: 560px) {
  .ai-config-management,
  .ai-extension-card,
  .ai-prompt-card,
  .security-rules {
    padding: 14px;
  }
  .ai-delete-action {
    margin-inline-start: 0;
  }
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
