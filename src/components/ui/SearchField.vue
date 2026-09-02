<script setup lang="ts">
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
</script>

<template>
  <label class="field">
    <AppIcon v-if="icon" :name="icon" :size="13" class="text-txt-4" />
    <input v-model="model" type="text" :placeholder="placeholder">
    <span v-if="shortcut" class="kbd shrink-0">{{ shortcut }}</span>
  </label>
</template>
