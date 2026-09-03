<script setup lang="ts">
import { nextTick, onMounted, shallowRef, useTemplateRef } from 'vue'
import IconButton from '@/components/ui/IconButton.vue'

const props = withDefaults(defineProps<{
  initialValue?: string
  placeholder?: string
}>(), {
  initialValue: '',
  placeholder: 'Group name',
})

const emit = defineEmits<{
  submit: [name: string]
  cancel: []
}>()

const value = shallowRef(props.initialValue)
const input = useTemplateRef<HTMLInputElement>('input')

function submit(): void {
  const name = value.value.trim()
  if (name)
    emit('submit', name)
}

onMounted(() => void nextTick(() => {
  input.value?.focus()
  input.value?.select()
}))
</script>

<template>
  <form class="sidebar-group-editor" @submit.prevent="submit">
    <input
      ref="input"
      v-model="value"
      :placeholder="placeholder"
      aria-label="分组名称"
      maxlength="64"
      @keydown.esc.prevent="emit('cancel')"
    >
    <IconButton icon="lucide:check" :size="12" title="确认" @click="submit" />
    <IconButton icon="lucide:x" :size="12" title="取消" @click="emit('cancel')" />
  </form>
</template>

<style scoped>
.sidebar-group-editor {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 2px;
  padding-left: 8px;
}

.sidebar-group-editor input {
  min-width: 0;
  height: 26px;
  flex: 1;
  border: 1px solid color-mix(in oklch, var(--color-violet) 60%, var(--color-line));
  border-radius: 5px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  padding: 0 7px;
  color: var(--color-txt);
  font-size: 11px;
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 10%, transparent);
}
</style>
