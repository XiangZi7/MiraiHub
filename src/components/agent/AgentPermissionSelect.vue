<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentApprovalMode } from '@/types/agent'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

defineProps<{ disabled: boolean }>()
const mode = defineModel<AgentApprovalMode>({ required: true })
const { t } = useI18n()
const options = computed(() => [
  {
    value: 'ask',
    label: t('请求批准'),
    description: t('每次工具操作前询问，包括只读操作'),
  },
  {
    value: 'auto',
    label: t('帮我批准'),
    description: t('内置只读工具自动执行，其他操作询问'),
  },
  {
    value: 'full',
    label: t('完全访问权限'),
    description: t('当前连接的命令与 SQL 自动执行，可修改或删除数据'),
  },
])
const icon = computed(() =>
  mode.value === 'ask'
    ? 'lucide:hand'
    : mode.value === 'full'
      ? 'lucide:shield-alert'
      : 'lucide:shield-check'
)
</script>

<template>
  <div
    class="permission-select"
    :class="mode === 'full' && 'full-access'"
  >
    <AppIcon
      :name="icon"
      :size="13"
      class="permission-icon"
    />
    <AppSelect
      v-model="mode"
      :label="t('AI 操作审批方式')"
      :options="options"
      :disabled="disabled"
      :menu-min-width="280"
      wrap-descriptions
      compact
      hide-label
    />
  </div>
</template>

<style scoped>
.permission-select {
  display: flex;
  align-items: center;
  gap: 1px;
  min-width: 0;
  color: var(--color-txt-3);
}
.permission-icon {
  flex-shrink: 0;
}
.permission-select :deep(.app-select-trigger) {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  padding-inline: 3px;
}
.permission-select :deep(.app-select-value) {
  color: var(--color-txt-3);
}
.permission-select :deep(.app-select-trigger:hover),
.permission-select :deep(.app-select-trigger:focus-visible) {
  background: var(--color-hover);
}
.permission-select :deep(.app-select-trigger:focus-visible) {
  outline: 1px solid var(--agent-color);
}
.full-access,
.full-access :deep(.app-select-value) {
  color: var(--color-warning, #e5a34b);
}
</style>
