<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

import AppSelect from '@/components/ui/AppSelect.vue'
import { agentProviderIcon } from '@/utils/agent-provider-icon'

const { t } = useI18n()
const props = defineProps<{
  activeId: string
  options: {
    value: string
    label: string
    disabled?: boolean
    iconSrc?: string
  }[]
  disabled: boolean
}>()
const emit = defineEmits<{ select: [id: string] }>()
const brandedOptions = computed(() =>
  props.options.map(option => ({
    ...option,
    iconSrc: option.iconSrc ?? agentProviderIcon({ name: option.label }),
  }))
)
</script>
<template>
  <div class="bg-txt/5 flex min-w-0 items-center rounded-full pl-1">
    <AppSelect
      class="min-w-0 flex-1"
      :model-value="activeId"
      :options="brandedOptions"
      :disabled="disabled || !options.length"
      :placeholder="t('请添加并启用配置')"
      :label="t('选择 AI 模型')"
      hide-label
      compact
      searchable
      pill
      @update:model-value="emit('select', $event)"
    />
  </div>
</template>
