<script setup lang="ts">
import { nextTick, onMounted, shallowRef, useTemplateRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { toast } from '@/composables/useToast'

const props = defineProps<{ name: string }>()
const emit = defineEmits<{
  submit: [name: string]
  close: []
}>()

const value = shallowRef(props.name)
const input = useTemplateRef<HTMLInputElement>('input')

function submit(): void {
  const name = value.value.trim()
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    toast.warning('请输入不含斜杠的有效文件名')
    return
  }
  emit('submit', name)
}

onMounted(
  () =>
    void nextTick(() => {
      input.value?.focus()
      input.value?.select()
    })
)
</script>

<template>
  <AppDialog
    title="重命名远端文件"
    description="只修改名称，文件仍保留在当前目录。"
    @close="emit('close')"
  >
    <form @submit.prevent="submit">
      <label
        for="remote-file-name"
        class="text-txt-2 block text-[11px] font-medium"
        >新名称</label
      >
      <input
        id="remote-file-name"
        ref="input"
        v-model="value"
        class="rename-input mt-1.5"
        autocomplete="off"
      />
    </form>

    <template #footer>
      <div class="flex-1" />
      <AppButton
        size="sm"
        @click="emit('close')"
        >取消</AppButton
      >
      <AppButton
        size="sm"
        variant="primary"
        @click="submit"
        >重命名</AppButton
      >
    </template>
  </AppDialog>
</template>

<style scoped>
.rename-input {
  width: 100%;
  height: 34px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  padding: 0 9px;
  color: var(--color-txt);
  font-size: 12px;
  outline: none;
}

.rename-input:focus {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px
    color-mix(in oklch, var(--color-violet) 12%, transparent);
}
</style>
