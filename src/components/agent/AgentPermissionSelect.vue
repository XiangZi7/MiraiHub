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
    icon: 'lucide:hand',
    description: t('每次工具操作前询问，包括只读操作'),
  },
  {
    value: 'auto',
    label: t('帮我批准'),
    icon: 'lucide:shield-check',
    description: t('常见只读检查自动执行，修改和未识别操作询问'),
  },
  {
    value: 'full',
    label: t('完全访问权限'),
    icon: 'lucide:shield-check',
    description: t('当前连接的命令与 SQL 自动执行，可修改或删除数据'),
  },
])
const icon = computed(
  () =>
    options.value.find(option => option.value === mode.value)?.icon ??
    'lucide:shield-check'
)
</script>

<template>
  <div
    class="bg-txt/5 text-txt-2 flex min-w-0 items-center gap-0.5 rounded-full pl-2"
  >
    <AppIcon
      :name="icon"
      :size="13"
      class="shrink-0"
    />
    <AppSelect
      class="min-w-0 flex-1"
      v-model="mode"
      :label="t('AI 操作审批方式')"
      :options="options"
      :disabled="disabled"
      :menu-min-width="280"
      wrap-descriptions
      compact
      hide-label
      pill
    />
  </div>
</template>
