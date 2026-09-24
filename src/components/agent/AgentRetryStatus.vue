<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentRetryNotice } from '@/types/agent'
import { translateNativeMessage } from '@/i18n/native'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ retry: AgentRetryNotice }>()
const { t } = useI18n()
// 重试等待时刷新倒计时，组件离开后立即清除计时器
const clock = shallowRef(Date.now())
const seconds = computed(() =>
  Math.max(0, Math.ceil((props.retry.retryAt - clock.value) / 1000))
)
const timer = setInterval(() => {
  clock.value = Date.now()
}, 1000)
watch(
  () => props.retry.retryAt,
  () => {
    clock.value = Date.now()
  }
)
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div
    class="text-txt-3 grid gap-1 text-[11px]"
    role="status"
  >
    <div class="flex items-center gap-2">
      <AppIcon
        name="lucide:loader-circle"
        :size="13"
        class="animate-spin"
      />
      {{
        t('agent.retryCountdown', {
          attempt: retry.attempt,
          max: retry.max,
          seconds,
        })
      }}
    </div>
    <p class="leading-relaxed break-words">
      {{ translateNativeMessage(retry.reason) }}
    </p>
  </div>
</template>
