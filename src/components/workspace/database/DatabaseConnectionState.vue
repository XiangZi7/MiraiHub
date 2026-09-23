<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import type { SshSessionStatus } from '@/types/ssh'

const props = withDefaults(
  defineProps<{
    status: SshSessionStatus
    needsPassword: boolean
    error?: string
    kind?: 'database' | 'redis'
  }>(),
  { error: '', kind: 'database' }
)

const emit = defineEmits<{
  connect: [password?: string]
}>()

const password = defineModel<string>('password', { required: true })
const { t } = useI18n()

const connecting = computed(() => props.status === 'connecting')
const hasError = computed(() => !connecting.value && !!props.error)
const title = computed(() => {
  if (connecting.value)
    return props.kind === 'redis' ? t('正在连接 Redis…') : t('正在连接数据库…')
  if (hasError.value)
    return props.kind === 'redis' ? t('Redis 连接失败') : t('数据库连接失败')
  return props.kind === 'redis' ? t('Redis 连接未建立') : t('数据库连接未建立')
})
const description = computed(() => {
  if (connecting.value) return t('正在建立连接，请稍候。')
  if (hasError.value) return t('请检查网络、主机和认证信息，然后重试。')
  return props.kind === 'redis'
    ? t('连接后即可浏览键值并执行命令。')
    : t('连接后即可浏览数据库对象并运行查询。')
})

function reconnect() {
  emit('connect', props.needsPassword ? password.value : undefined)
}
</script>

<template>
  <div class="connection-state-wrap">
    <section
      class="connection-state"
      :role="hasError ? 'alert' : 'status'"
    >
      <div class="connection-state-heading">
        <div
          class="connection-state-icon"
          :class="hasError ? 'connection-state-icon-error' : ''"
          aria-hidden="true"
        >
          <AppIcon
            :name="
              connecting
                ? 'lucide:loader-circle'
                : hasError
                  ? 'lucide:plug-zap'
                  : 'lucide:database-zap'
            "
            :size="21"
            :class="connecting && 'animate-spin'"
          />
        </div>
        <div class="connection-state-copy">
          <h2 class="connection-state-title">{{ title }}</h2>
          <p class="connection-state-description">{{ description }}</p>
        </div>
      </div>

      <AppTextField
        v-if="needsPassword"
        v-model="password"
        class="connection-state-password"
        :label="t('Password')"
        type="password"
        autocomplete="current-password"
        :disabled="connecting"
        :placeholder="t('输入本次连接使用的密码')"
        @keyup.enter="!connecting && reconnect()"
      />

      <div
        v-if="!connecting"
        class="connection-state-actions"
      >
        <AppButton
          variant="primary"
          class="connection-state-action"
          @click="reconnect"
        >
          <AppIcon
            name="lucide:plug-zap"
            :size="14"
          />
          {{ t('重新连接') }}
        </AppButton>
      </div>

      <details
        v-if="hasError"
        class="connection-state-details"
      >
        <summary>
          <AppIcon
            name="lucide:info"
            :size="13"
          />
          {{ t('查看技术详情') }}
          <AppIcon
            name="lucide:chevron-down"
            :size="13"
            class="connection-state-chevron"
          />
        </summary>
        <pre>{{ error }}</pre>
      </details>
    </section>
  </div>
</template>

<style scoped>
.connection-state-wrap {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: clamp(16px, 3vw, 36px);
  container: connection-state / inline-size;
}

.connection-state {
  width: min(100%, 500px);
  margin: auto;
  padding: 26px 28px;
  border: 1px solid var(--color-line);
  border-radius: 16px;
  background: var(--color-pane);
  box-shadow: var(--shadow-pane);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

.connection-state-heading {
  display: flex;
  align-items: flex-start;
  gap: 15px;
}

.connection-state-icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: none;
  place-items: center;
  border: 1px solid color-mix(in oklch, var(--color-violet) 25%, var(--color-line));
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-violet) 10%, transparent);
  color: var(--color-violet);
}

.connection-state-icon-error {
  border-color: color-mix(in oklch, var(--color-danger) 25%, var(--color-line));
  background: color-mix(in oklch, var(--color-danger) 9%, transparent);
  color: var(--color-danger);
}

.connection-state-copy {
  min-width: 0;
  padding-top: 1px;
}

.connection-state-title {
  color: var(--color-txt);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
}

.connection-state-description {
  margin-top: 5px;
  color: var(--color-txt-2);
  font-size: 12px;
  line-height: 1.65;
}

.connection-state-password {
  margin-top: 24px;
}

.connection-state-actions {
  display: flex;
  margin-top: 24px;
}

.connection-state-action {
  min-height: 36px;
}

.connection-state-details {
  margin-top: 24px;
  padding-top: 14px;
  border-top: 1px solid var(--color-line-soft);
}

.connection-state-details summary {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  color: var(--color-txt-3);
  cursor: pointer;
  font-size: 11px;
  list-style: none;
}

.connection-state-details summary::-webkit-details-marker {
  display: none;
}

.connection-state-details summary:hover,
.connection-state-details summary:focus-visible {
  color: var(--color-txt);
}

.connection-state-details summary:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.connection-state-chevron {
  margin-left: auto;
  transition: transform 150ms ease;
}

.connection-state-details[open] .connection-state-chevron {
  transform: rotate(180deg);
}

.connection-state-details pre {
  max-height: 140px;
  margin-top: 10px;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--color-line-soft);
  border-radius: 8px;
  background: var(--color-window);
  color: var(--color-txt-2);
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

:global(html.material-solid) .connection-state {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

@container connection-state (max-width: 420px) {
  .connection-state {
    padding: 20px;
  }

  .connection-state-actions,
  .connection-state-action {
    width: 100%;
  }

  .connection-state-action {
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .connection-state-chevron {
    transition: none;
  }
}
</style>
