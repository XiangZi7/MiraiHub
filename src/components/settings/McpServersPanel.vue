<script setup lang="ts">
import { translateNativeMessage } from '@/i18n/native'
import { useI18n } from 'vue-i18n'
import { useMcpServers } from '@/composables/useMcpServers'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import type { McpSecretDraft, McpTarget } from '@/types/agent'
import { IS_TAURI } from '@/utils/window'

const { t } = useI18n()
const { servers, draft, selectedId, loading, busy, error, message, probe, select, create, save, remove, test } =
  useMcpServers()

const transports = [
  { value: 'stdio', label: t('本地程序（stdio）') },
  { value: 'http', label: t('远程服务（HTTP）') },
]
const targetOptions: { value: McpTarget; label: string }[] = [
  { value: 'ssh', label: 'SSH' },
  { value: 'database', label: t('数据库') },
  { value: 'redis', label: 'Redis' },
]

function toggle(target: McpTarget): void {
  const current = draft.value
  if (!current) return
  current.targets = current.targets.includes(target)
    ? current.targets.filter(item => item !== target)
    : [...current.targets, target]
}

function addSecret(list: McpSecretDraft[]): void {
  list.push({ key: '', value: '', clear: false, hasValue: false })
}
</script>

<template>
  <section
    class="mcp-servers"
    aria-labelledby="mcp-servers-title"
  >
    <header class="mcp-heading">
      <AppIcon
        name="lucide:plug"
        :size="15"
      />
      <h3 id="mcp-servers-title">{{ t('外部 MCP 服务器') }}</h3>
    </header>
    <p class="mcp-warning">
      {{
        t(
          '外部 MCP 服务器是以当前用户权限运行的本机程序，不在 SSH 与数据库的审批边界内。调用其工具仍会逐次征求确认。'
        )
      }}
    </p>
    <div class="mcp-layout">
      <ul
        class="mcp-list"
        :aria-label="t('已添加的 MCP 服务器')"
      >
        <li
          v-for="server in servers"
          :key="server.id"
        >
          <button
            type="button"
            :class="['mcp-item', selectedId === server.id && 'is-active']"
            :aria-current="selectedId === server.id ? 'true' : undefined"
            @click="select(server)"
          >
            <span>{{ server.name }}</span>
            <small>{{ server.enabled ? server.tools.length + ' ' + t('个工具') : t('已停用') }}</small>
          </button>
        </li>
        <li v-if="!servers.length && !loading">
          <p class="mcp-empty">{{ t('还没有 MCP 服务器。') }}</p>
        </li>
      </ul>
      <AppButton
        size="sm"
        :disabled="loading || busy || !IS_TAURI"
        @click="create"
        ><AppIcon
          name="lucide:plus"
          :size="12"
        />{{ t('添加服务器') }}</AppButton
      >
    </div>
    <fieldset
      v-if="draft"
      :disabled="loading || busy || !IS_TAURI"
      class="mcp-form"
    >
      <div class="ai-setting-field">
        <label for="mcp-name">{{ t('名称') }}</label>
        <input
          id="mcp-name"
          v-model="draft.name"
          maxlength="80"
        />
      </div>
      <AppSwitch
        v-model="draft.enabled"
        :label="t('启用')"
        :disabled="loading || busy || !IS_TAURI"
      />
      <AppSelect
        v-model="draft.transport"
        :label="t('连接方式')"
        :options="transports"
        :disabled="loading || busy || !IS_TAURI"
      />
      <template v-if="draft.transport === 'stdio'">
        <div class="ai-setting-field">
          <label for="mcp-command">{{ t('启动命令') }}</label>
          <input
            id="mcp-command"
            v-model="draft.command"
            spellcheck="false"
            maxlength="512"
            placeholder="npx"
          />
        </div>
        <div class="ai-setting-field">
          <label for="mcp-args">{{ t('参数（每行一个）') }}</label>
          <textarea
            id="mcp-args"
            v-model="draft.argsText"
            rows="3"
            spellcheck="false"
          />
        </div>
      </template>
      <div
        v-else
        class="ai-setting-field"
      >
        <label for="mcp-url">{{ t('服务地址') }}</label>
        <input
          id="mcp-url"
          v-model="draft.url"
          type="url"
          spellcheck="false"
          placeholder="https://mcp.example/rpc"
        />
      </div>
      <fieldset class="mcp-secrets">
        <legend>
          {{ draft.transport === 'stdio' ? t('环境变量') : t('请求头') }}
        </legend>
        <div
          v-for="(secret, index) in draft.transport === 'stdio' ? draft.env : draft.headers"
          :key="index"
          class="mcp-secret"
        >
          <input
            v-model="secret.key"
            :aria-label="t('名称')"
            spellcheck="false"
            maxlength="128"
          />
          <input
            v-model="secret.value"
            type="password"
            :placeholder="secret.hasValue ? t('留空保留已保存的值') : ''"
            :disabled="secret.clear"
            :aria-label="t('值')"
            spellcheck="false"
            autocomplete="new-password"
          />
          <AppButton
            size="sm"
            variant="ghost"
            @click="(draft.transport === 'stdio' ? draft.env : draft.headers).splice(index, 1)"
            >{{ t('移除') }}</AppButton
          >
        </div>
        <AppButton
          size="sm"
          variant="ghost"
          @click="addSecret(draft.transport === 'stdio' ? draft.env : draft.headers)"
          >{{ t('添加一项') }}</AppButton
        >
      </fieldset>
      <fieldset class="mcp-targets">
        <legend>{{ t('适用目标（不选则全部可用）') }}</legend>
        <label
          v-for="option in targetOptions"
          :key="option.value"
        >
          <input
            type="checkbox"
            :checked="draft.targets.includes(option.value)"
            @change="toggle(option.value)"
          />{{ option.label }}
        </label>
      </fieldset>
      <p
        v-if="draft.tools.length"
        class="mcp-tools"
      >
        {{ t('已发现的工具') }}：{{ draft.tools.join('、') }}
      </p>
      <div class="mcp-actions">
        <AppButton
          variant="primary"
          size="sm"
          @click="save"
          >{{ t('保存服务器') }}</AppButton
        >
        <AppButton
          size="sm"
          :disabled="!draft.id"
          @click="test"
          >{{ busy ? t('处理中…') : t('测试连接') }}</AppButton
        >
        <AppButton
          size="sm"
          variant="ghost"
          :disabled="!draft.id"
          @click="remove"
          >{{ t('删除') }}</AppButton
        >
      </div>
    </fieldset>
    <p
      v-if="error"
      role="alert"
      class="mcp-feedback text-danger"
    >
      {{ translateNativeMessage(error) }}
    </p>
    <p
      v-if="probe || message"
      role="status"
      class="mcp-feedback text-success"
    >
      {{ translateNativeMessage(probe || message) }}
    </p>
  </section>
</template>

<style scoped>
.mcp-servers {
  display: grid;
  gap: 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 14px;
}
.mcp-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-txt-2);
}
.mcp-warning {
  font-size: 11px;
  line-height: 1.7;
  color: var(--color-txt-3);
  border: 1px solid color-mix(in oklch, var(--color-danger) 35%, transparent);
  background: color-mix(in oklch, var(--color-danger) 8%, transparent);
  border-radius: 6px;
  padding: 8px 10px;
}
.mcp-layout {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.mcp-list {
  display: grid;
  flex: 1;
  gap: 4px;
  min-width: 0;
}
.mcp-item {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--color-line-soft);
  border-radius: 6px;
  font-size: 12px;
  text-align: left;
}
.mcp-item.is-active {
  border-color: var(--color-line-strong);
}
.mcp-item small {
  color: var(--color-txt-4);
  font-size: 10px;
}
.mcp-empty {
  font-size: 11px;
  color: var(--color-txt-4);
}
.mcp-form {
  display: grid;
  gap: 12px;
  min-width: 0;
  border: 0;
  padding: 0;
}
.mcp-form textarea,
.mcp-form input {
  width: 100%;
}
.mcp-secrets,
.mcp-targets {
  display: grid;
  gap: 6px;
  border: 0;
  padding: 0;
  font-size: 11px;
}
.mcp-secret {
  display: flex;
  gap: 6px;
}
.mcp-targets {
  grid-auto-flow: column;
  justify-content: start;
  gap: 14px;
}
.mcp-targets label {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mcp-tools {
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-txt-3);
  overflow-wrap: anywhere;
}
.mcp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mcp-feedback {
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
