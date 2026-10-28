<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppSelect from '@/components/ui/AppSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const { t } = useI18n()
defineProps<{
  activeId: string
  options: { value: string; label: string; disabled?: boolean }[]
  disabled: boolean
}>()
const emit = defineEmits<{ select: [id: string] }>()
</script>
<template>
  <div
    class="bg-txt/5 flex max-w-[48%] min-w-0 items-center gap-0.5 rounded-full pl-2 @min-[37.5rem]/agent:min-w-[158px]"
  >
    <AppIcon
      name="lucide:lock-keyhole"
      :size="12"
      class="text-txt-3 shrink-0"
    />
    <AppSelect
      class="min-w-0 flex-1"
      :model-value="activeId"
      :options="options"
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
