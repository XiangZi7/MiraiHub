<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, useId } from 'vue'
import type { SshSessionInfo } from '@/types/ssh'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

const { t } = useI18n()

const props = defineProps<{
  sessions: readonly SshSessionInfo[]
  busy: boolean
  loading: boolean
  valid: boolean
}>()
const emit = defineEmits<{ submit: []; refresh: [] }>()
const sessionId = defineModel<string>('sessionId', { required: true })
const bindPort = defineModel<number | string>('bindPort', { required: true })
const targetHost = defineModel<string>('targetHost', { required: true })
const targetPort = defineModel<number | string>('targetPort', {
  required: true,
})
const fieldId = useId()
const missingSession = computed(
  () =>
    Boolean(sessionId.value) &&
    !props.sessions.some(session => session.id === sessionId.value)
)
const sessionOptions = computed(() => [
  // 原连接断开时保留一个不可选的占位项，提示用户重新选择。
  ...(missingSession.value
    ? [
        {
          value: sessionId.value,
          label: t('原连接已断开，请重新选择'),
          disabled: true,
        },
      ]
    : []),
  ...props.sessions.map(session => ({
    value: session.id,
    label: `${session.username}@${session.host}:${session.port}`,
  })),
])
/**
 * AppInput 的模型声明为 string，但 type="number" 时 Vue 的 v-model 会把输入转成数字回传，
 * 与原生数字输入框一致。这里原样透传，避免 String() 往返在重渲染时改写正在输入的值。
 */
const bindPortInput = computed({
  get: () => bindPort.value as string,
  set: (value: string) => {
    bindPort.value = value
  },
})
const targetPortInput = computed({
  get: () => targetPort.value as string,
  set: (value: string) => {
    targetPort.value = value
  },
})
</script>

<template>
  <form
    class="tunnel-create"
    @submit.prevent="emit('submit')"
  >
    <div class="tunnel-connection-row">
      <div class="tunnel-form-field">
        <span
          class="tunnel-field-label"
          aria-hidden="true"
        >
          {{ t('SSH 连接') }}
        </span>
        <AppSelect
          v-model="sessionId"
          :label="t('SSH 连接')"
          hide-label
          :options="sessionOptions"
          :placeholder="
            loading ? t('正在读取连接…') : t('请选择已连接的服务器')
          "
          :disabled="busy || !sessions.length"
          required
        />
      </div>
      <AppButton
        class="tunnel-refresh"
        :disabled="busy || loading"
        @click="emit('refresh')"
      >
        <AppIcon
          name="lucide:refresh-cw"
          :size="14"
        />
        {{ t('刷新连接') }}
      </AppButton>
    </div>
    <p
      v-if="!sessions.length || missingSession"
      :id="`${fieldId}-session-hint`"
      class="tunnel-connection-hint"
    >
      {{
        !sessions.length
          ? t('请先在工作区连接一台 SSH 服务器，再建立隧道。')
          : t('所选 SSH 连接已断开，请选择可用连接。')
      }}
    </p>

    <div class="tunnel-route-grid">
      <section
        class="tunnel-endpoint"
        :aria-labelledby="`${fieldId}-local-title`"
      >
        <h3
          :id="`${fieldId}-local-title`"
          class="tunnel-endpoint-title"
        >
          <AppIcon
            name="lucide:monitor"
            :size="15"
          />
          {{ t('本地监听') }}
          <span class="tunnel-endpoint-tag"> {{ t('本机') }} </span>
        </h3>
        <div class="tunnel-endpoint-fields">
          <div class="tunnel-form-field">
            <label
              :for="`${fieldId}-bind-host`"
              class="tunnel-field-label"
            >
              {{ t('监听地址') }}
            </label>
            <AppInput
              :id="`${fieldId}-bind-host`"
              model-value="127.0.0.1"
              class="text-txt-2! bg-transparent!"
              readonly
            />
          </div>
          <div class="tunnel-form-field">
            <label
              :for="`${fieldId}-bind-port`"
              class="tunnel-field-label"
            >
              {{ t('本地端口') }}
            </label>
            <AppInput
              :id="`${fieldId}-bind-port`"
              v-model="bindPortInput"
              type="number"
              min="0"
              max="65535"
              step="1"
              required
              :disabled="busy"
              :aria-describedby="`${fieldId}-bind-hint`"
            />
          </div>
        </div>
        <p
          :id="`${fieldId}-bind-hint`"
          class="tunnel-field-hint"
        >
          {{ t('端口填 0 时自动分配，仅本机可访问。') }}
        </p>
      </section>

      <AppIcon
        name="lucide:arrow-right"
        :size="18"
        class="tunnel-route-arrow"
        aria-hidden="true"
      />

      <section
        class="tunnel-endpoint"
        :aria-labelledby="`${fieldId}-remote-title`"
      >
        <h3
          :id="`${fieldId}-remote-title`"
          class="tunnel-endpoint-title"
        >
          <AppIcon
            name="lucide:server"
            :size="15"
          />
          {{ t('远端目标') }}
          <span class="tunnel-endpoint-tag"> {{ t('通过 SSH') }} </span>
        </h3>
        <div class="tunnel-endpoint-fields">
          <div class="tunnel-form-field">
            <label
              :for="`${fieldId}-target-host`"
              class="tunnel-field-label"
            >
              {{ t('目标主机') }}
            </label>
            <AppInput
              :id="`${fieldId}-target-host`"
              v-model="targetHost"
              :placeholder="t('主机名或 IP 地址')"
              spellcheck="false"
              required
              :disabled="busy"
              :aria-describedby="`${fieldId}-target-hint`"
            />
          </div>
          <div class="tunnel-form-field">
            <label
              :for="`${fieldId}-target-port`"
              class="tunnel-field-label"
            >
              {{ t('目标端口') }}
            </label>
            <AppInput
              :id="`${fieldId}-target-port`"
              v-model="targetPortInput"
              type="number"
              min="1"
              max="65535"
              step="1"
              required
              :disabled="busy"
            />
          </div>
        </div>
        <p
          :id="`${fieldId}-target-hint`"
          class="tunnel-field-hint"
        >
          {{ t('127.0.0.1 表示 SSH 服务器自身。') }}
        </p>
      </section>
    </div>

    <div class="tunnel-create-actions">
      <span class="tunnel-security-note"
        ><AppIcon
          name="lucide:shield-check"
          :size="14"
        />
        {{ t('流量通过 SSH 加密转发') }}
      </span>
      <AppButton
        type="submit"
        variant="primary"
        class="tunnel-submit"
        :disabled="busy || !valid"
      >
        <AppIcon
          :name="busy ? 'lucide:loader-circle' : 'lucide:plus'"
          :size="15"
        />
        {{ busy ? t('正在建立…') : t('建立本地隧道') }}
      </AppButton>
    </div>
  </form>
</template>

<style scoped>
.tunnel-create {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.tunnel-connection-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
}
/* Form groups must not inherit the global .field control's fixed height. */
.tunnel-form-field {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  min-width: 0;
}
.tunnel-field-label {
  color: var(--color-txt-2);
  font-size: 11px;
  line-height: 1.5;
}
/* 与 AppSelect 触发按钮同高，底边对齐。 */
.tunnel-refresh {
  min-height: 34px;
  justify-content: center;
  white-space: nowrap;
}
.tunnel-connection-hint {
  margin-top: -7px;
  color: var(--color-txt-2);
  font-size: 11px;
  line-height: 1.6;
}
.tunnel-route-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}
.tunnel-endpoint {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  background: var(--color-card);
}
.tunnel-endpoint-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 14px;
  font-size: 12px;
  font-weight: 600;
}
.tunnel-endpoint-tag {
  margin-left: auto;
  color: var(--color-txt-3);
  font-size: 10px;
  font-weight: 400;
  white-space: nowrap;
}
.tunnel-endpoint-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 10px;
}
.tunnel-field-hint {
  margin-top: 10px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--color-txt-2);
  overflow-wrap: anywhere;
}
.tunnel-route-arrow {
  align-self: center;
  color: var(--color-txt-3);
}
.tunnel-create-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tunnel-security-note {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--color-txt-2);
}
.tunnel-submit {
  min-height: 36px;
  min-width: 140px;
  justify-content: center;
}
@media (max-width: 700px) {
  .tunnel-route-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  .tunnel-route-arrow {
    display: none;
  }
}
@media (max-width: 420px) {
  .tunnel-connection-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .tunnel-refresh {
    justify-self: end;
  }
  .tunnel-endpoint {
    padding: 12px;
  }
  .tunnel-endpoint-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .tunnel-submit {
    width: 100%;
  }
}
</style>
