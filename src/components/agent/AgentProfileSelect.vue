<script setup lang="ts">
import AppSelect from '@/components/ui/AppSelect.vue'
defineProps<{
  activeId: string
  options: { value: string; label: string; disabled?: boolean }[]
  disabled: boolean
}>()
const emit = defineEmits<{ select: [id: string] }>()
</script>
<template>
  <div class="agent-model-select">
    <AppSelect
      :model-value="activeId"
      :options="options"
      :disabled="disabled || !options.length"
      placeholder="请添加并启用配置"
      label="选择 AI 模型"
      hide-label
      compact
      searchable
      @update:model-value="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.agent-model-select {
  min-width: 0;
  max-width: 290px;
}
.agent-model-select :deep(.app-select-trigger) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  padding-inline: 6px;
}
.agent-model-select :deep(.app-select-trigger:hover),
.agent-model-select :deep(.app-select-trigger:focus-visible) {
  background: var(--color-hover);
}
.agent-model-select :deep(.app-select-trigger:focus-visible) {
  outline: 1px solid var(--agent-color);
}
</style>
