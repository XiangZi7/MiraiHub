<script setup lang="ts">
import { useTemplateRef } from 'vue'
import AppIcon from './AppIcon.vue'

defineProps<{
  /** 占位文案 */
  placeholder?: string
  /** 左侧图标 */
  icon?: string
  /** 右侧快捷键提示 */
  shortcut?: string
}>()

const model = defineModel<string>({ default: '' })

const inputRef = useTemplateRef('inputRef')

/** 供外部把焦点交进来（命令面板的搜索类命令），顺手全选便于直接改写 */
function focus(): void {
  inputRef.value?.focus()
  inputRef.value?.select()
}

defineExpose({ focus })
</script>

<template>
  <label class="field">
    <AppIcon
      v-if="icon"
      :name="icon"
      :size="13"
      class="text-txt-4"
    />
    <input
      ref="inputRef"
      v-model="model"
      type="text"
      :placeholder="placeholder"
    />
    <span
      v-if="shortcut"
      class="kbd shrink-0"
      >{{ shortcut }}</span
    >
  </label>
</template>
