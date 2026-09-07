<script setup lang="ts">
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { openSettingsWindow } from '@/utils/window'
defineProps<{
  activeId: string
  options: { value: string; label: string; disabled?: boolean }[]
  disabled: boolean
  error: string
}>()
const emit = defineEmits<{ select: [id: string] }>()
</script>
<template>
  <div class="border-line-soft grid gap-1 border-b px-3 py-2">
    <div class="flex min-w-0 items-center gap-2">
      <span class="text-txt-3 shrink-0 text-[10px]">模型配置</span>
      <div class="min-w-0 flex-1">
        <AppSelect
          :model-value="activeId"
          :options="options"
          :disabled="disabled || !options.length"
          placeholder="请添加并启用配置"
          label="切换 AI 配置"
          hide-label
          compact
          searchable
          @update:model-value="emit('select', $event)"
        />
      </div>
      <IconButton
        icon="lucide:settings-2"
        title="管理 AI 配置"
        :size="14"
        @click="openSettingsWindow()"
      />
    </div>
    <p
      v-if="error"
      role="alert"
      class="text-danger text-[10px]"
    >
      {{ error }}
    </p>
  </div>
</template>
