<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

withDefaults(
  defineProps<{
    message: string
    title?: string
    retryLabel?: string
  }>(),
  { title: '', retryLabel: '' }
)

defineEmits<{
  retry: []
  dismiss: []
}>()

const { t } = useI18n()
</script>

<template>
  <div
    class="session-error"
    role="alert"
  >
    <AppIcon
      name="lucide:triangle-alert"
      :size="16"
      class="session-error-icon"
    />
    <div class="session-error-body">
      <p class="session-error-title">{{ title || t('连接失败') }}</p>
      <p class="session-error-message">{{ message }}</p>
    </div>
    <div class="session-error-actions">
      <AppButton
        size="sm"
        variant="danger"
        @click="$emit('retry')"
        >{{ retryLabel || t('重试') }}</AppButton
      >
      <AppButton
        size="sm"
        variant="ghost"
        :aria-label="t('关闭提示')"
        @click="$emit('dismiss')"
        ><AppIcon
          name="lucide:x"
          :size="12"
      /></AppButton>
    </div>
  </div>
</template>

<style scoped>
.session-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-height: 9rem;
  padding: 10px 12px;
  border: 1px solid color-mix(in oklch, var(--color-danger) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-danger) 10%, var(--color-panel));
  color: var(--color-txt-1);
  font-size: 12px;
  line-height: 1.6;
}
.session-error-icon {
  flex: none;
  margin-top: 2px;
  color: var(--color-danger);
}
.session-error-body {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
  overflow-y: auto;
}
.session-error-title {
  font-weight: 600;
}
.session-error-message {
  color: var(--color-txt-2);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.session-error-actions {
  display: flex;
  flex: none;
  gap: 4px;
}
</style>
