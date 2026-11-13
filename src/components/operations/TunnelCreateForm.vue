<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, useId } from 'vue'
import type { SshSessionInfo, SshTunnelKind } from '@/types/ssh'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { cn } from '@/utils/cn'

const { t } = useI18n()

const props = defineProps<{
  sessions: readonly SshSessionInfo[]
  busy: boolean
  loading: boolean
  valid: boolean
}>()
const emit = defineEmits<{ submit: []; refresh: [] }>()
const sessionId = defineModel<string>('sessionId', { required: true })
const kind = defineModel<SshTunnelKind>('kind', { default: 'local' })
const remoteBindHost = defineModel<string>('remoteBindHost', {
  default: '127.0.0.1',
})
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
// 隧道类型选项：标签与 ssh 命令行等价说明
const kindOptions = computed(() => [
  {
    value: 'local' as const,
    label: t('本地转发'),
    flag: '-L',
    description: t('本机端口 → SSH 服务器 → 目标服务（ssh -L）'),
  },
  {
    value: 'remote' as const,
    label: t('远程转发'),
    flag: '-R',
    description: t('SSH 服务器端口 → 本机 → 目标服务（ssh -R）'),
  },
  {
    value: 'dynamic' as const,
    label: t('动态转发'),
    flag: '-D',
    description: t('本机 SOCKS5 代理，经 SSH 服务器连接任意目标（ssh -D）'),
  },
])
// 当前类型的说明文字
const kindDescription = computed(
  () =>
    kindOptions.value.find(option => option.value === kind.value)
      ?.description ?? ''
)
// 远程转发可选的服务器监听地址，后端只接受回环地址
const remoteBindOptions = [
  { value: '127.0.0.1', label: '127.0.0.1' },
  { value: 'localhost', label: 'localhost' },
  { value: '::1', label: '::1' },
]
// 监听端标题、标签与提示随类型变化
const listenText = computed(() => {
  if (kind.value === 'remote')
    return {
      title: t('远端监听'),
      tag: t('SSH 服务器'),
      port: t('远端端口'),
      hint: t('端口填 0 时由服务器分配，仅服务器本机可访问。'),
    }
  if (kind.value === 'dynamic')
    return {
      title: t('本地 SOCKS5 监听'),
      tag: t('本机'),
      port: t('本地端口'),
      hint: t(
        '端口填 0 时自动分配。浏览器或应用把 SOCKS5 代理指向该地址，即可经 SSH 服务器访问任意目标。'
      ),
    }
  return {
    title: t('本地监听'),
    tag: t('本机'),
    port: t('本地端口'),
    hint: t('端口填 0 时自动分配，仅本机可访问。'),
  }
})
// 目标端标题、标签与提示随类型变化
const targetText = computed(() =>
  kind.value === 'remote'
    ? {
        title: t('本地目标'),
        tag: t('本机'),
        hint: t('由本机发起连接，127.0.0.1 表示本机自身。'),
      }
    : {
        title: t('远端目标'),
        tag: t('通过 SSH'),
        hint: t('127.0.0.1 表示 SSH 服务器自身。'),
      }
)
// 提交按钮文字随类型变化
const submitLabel = computed(() => {
  if (kind.value === 'remote') return t('建立远程隧道')
  if (kind.value === 'dynamic') return t('建立动态代理')
  return t('建立本地隧道')
})
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
          icon="lucide:server"
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

    <fieldset class="flex min-w-0 flex-col gap-2">
      <legend class="text-txt-2 text-agent-small mb-2">
        {{ t('隧道类型') }}
      </legend>
      <div
        class="grid grid-cols-3 gap-2"
        role="radiogroup"
        :aria-label="t('隧道类型')"
        :aria-describedby="`${fieldId}-kind-hint`"
      >
        <AppButton
          v-for="option in kindOptions"
          :key="option.value"
          role="radio"
          :aria-checked="kind === option.value"
          :disabled="busy"
          :class="
            cn(
              'justify-center gap-1.5 text-[11.5px]',
              kind === option.value
                ? 'border-violet/60! bg-violet/12! text-txt!'
                : 'text-txt-3'
            )
          "
          @click="kind = option.value"
        >
          <span class="font-medium">{{ option.label }}</span>
          <code class="text-txt-4 text-[10px]">{{ option.flag }}</code>
        </AppButton>
      </div>
      <p
        :id="`${fieldId}-kind-hint`"
        class="text-txt-2 text-agent-small leading-relaxed"
      >
        {{ kindDescription }}
      </p>
    </fieldset>

    <div
      :class="cn('tunnel-route-grid', kind === 'dynamic' && 'grid-cols-1!')"
    >
      <section
        class="tunnel-endpoint"
        :aria-labelledby="`${fieldId}-local-title`"
      >
        <h3
          :id="`${fieldId}-local-title`"
          class="tunnel-endpoint-title"
        >
          <AppIcon
            :name="kind === 'remote' ? 'lucide:server' : 'lucide:monitor'"
            :size="15"
          />
          {{ listenText.title }}
          <span class="tunnel-endpoint-tag"> {{ listenText.tag }} </span>
        </h3>
        <div class="tunnel-endpoint-fields">
          <div
            v-if="kind === 'remote'"
            class="tunnel-form-field"
          >
            <span
              class="tunnel-field-label"
              aria-hidden="true"
            >
              {{ t('监听地址') }}
            </span>
            <AppSelect
              icon="lucide:network"
              v-model="remoteBindHost"
              :label="t('监听地址')"
              hide-label
              :options="remoteBindOptions"
              :disabled="busy"
            />
          </div>
          <div
            v-else
            class="tunnel-form-field"
          >
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
              {{ listenText.port }}
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
          {{ listenText.hint }}
        </p>
      </section>

      <template v-if="kind !== 'dynamic'">
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
              :name="kind === 'remote' ? 'lucide:monitor' : 'lucide:server'"
              :size="15"
            />
            {{ targetText.title }}
            <span class="tunnel-endpoint-tag"> {{ targetText.tag }} </span>
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
            {{ targetText.hint }}
          </p>
        </section>
      </template>
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
        {{ busy ? t('正在建立…') : submitLabel }}
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
