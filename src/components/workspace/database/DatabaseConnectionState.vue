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
</script>

<template>
  <div
    class="flex min-h-0 min-w-0 flex-1 overflow-auto p-[clamp(16px,3vw,36px)] [container:connection-state/inline-size]"
  >
    <!-- 与 Toast / 会话错误提示同构：角落辉光标示语义，--tone 一处定调。 -->
    <section
      class="connection-state border-line bg-pane rounded-pane glass relative m-auto w-[min(100%,400px)] overflow-hidden border px-6 py-5.5 shadow-(--shadow-notice)"
      :class="
        hasError
          ? '[--tone:var(--color-danger)]'
          : '[--tone:var(--color-violet)]'
      "
      :role="hasError ? 'alert' : 'status'"
    >
      <span
        class="tone-glow"
        aria-hidden="true"
      />

      <div class="relative flex items-start gap-3.5">
        <div
          class="grid size-8.5 flex-none place-items-center rounded-full bg-(--tone)/15 text-(--tone) ring-1 ring-(--tone)/35 ring-inset"
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
            :size="17"
            :class="connecting && 'animate-spin'"
          />
        </div>
        <div class="min-w-0 pt-px">
          <h2 class="text-txt text-[15px] leading-normal font-semibold">
            {{ title }}
          </h2>
          <p class="text-txt-2 mt-1.5 text-xs leading-relaxed">
            {{ description }}
          </p>
        </div>
      </div>

      <AppTextField
        v-if="needsPassword"
        v-model="password"
        class="relative mt-5"
        :label="t('Password')"
        type="password"
        autocomplete="current-password"
        :disabled="connecting"
        :placeholder="t('输入本次连接使用的密码')"
        @keyup.enter="!connecting && emit('connect', password)"
      />

      <div
        v-if="!connecting"
        class="relative mt-5 flex"
      >
        <AppButton
          variant="primary"
          class="connection-state-action min-h-9"
          @click="emit('connect', needsPassword ? password : undefined)"
        >
          <AppIcon
            name="lucide:plug-zap"
            :size="14"
          />
          {{ t('重新连接') }}
        </AppButton>
      </div>

      <!-- 技术详情默认收起：它是给排查用的原始报错，不该占掉卡片的主视线 -->
      <details
        v-if="hasError"
        class="group border-line-soft relative mt-4 border-t pt-2.5"
      >
        <summary
          class="text-txt-3 hover:text-txt focus-visible:text-txt outline-accent flex h-7 cursor-pointer list-none items-center gap-2 rounded-sm text-[11px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden"
        >
          <AppIcon
            name="lucide:info"
            :size="13"
          />
          {{ t('查看技术详情') }}
          <AppIcon
            name="lucide:chevron-down"
            :size="13"
            class="ml-auto transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <pre
          class="scroll-thin border-line-soft bg-window text-txt-2 mt-2.5 max-h-35 overflow-auto rounded-lg border p-3 font-mono text-[10.5px] leading-relaxed wrap-anywhere whitespace-pre-wrap"
          >{{ error }}</pre>
      </details>
    </section>
  </div>
</template>

<style scoped>
/* 窄容器下按钮撑满：卡片已经窄到 400px 以下，左对齐的小按钮会显得没分量。 */
@container connection-state (max-width: 420px) {
  .connection-state {
    padding: 20px;
  }

  .connection-state-action {
    width: 100%;
    justify-content: center;
  }
}

/* 关掉透明材质时不再自绘模糊，交给纯色层级。 */
:global(html.material-solid) .connection-state {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
</style>
