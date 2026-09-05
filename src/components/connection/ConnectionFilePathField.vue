<script setup lang="ts">
import { shallowRef } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import AppTextField from '@/components/ui/AppTextField.vue'

const props = withDefaults(
  defineProps<{
    label: string
    placeholder?: string
    dialogTitle: string
    filterName?: string
    extensions?: readonly string[]
  }>(),
  {
    placeholder: '',
    filterName: '证书与密钥文件',
    extensions: () => [],
  }
)

const emit = defineEmits<{
  selected: [path: string]
  error: [message: string]
}>()

const model = defineModel<string>({ required: true })
const selecting = shallowRef(false)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function selectFile(): Promise<void> {
  if (selecting.value) return
  selecting.value = true
  try {
    const selected = await open({
      title: props.dialogTitle,
      directory: false,
      multiple: false,
      filters: props.extensions.length
        ? [{ name: props.filterName, extensions: [...props.extensions] }]
        : undefined,
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    if (!path) return
    model.value = path
    emit('selected', path)
  } catch (error) {
    emit('error', errorMessage(error))
  } finally {
    selecting.value = false
  }
}
</script>

<template>
  <AppTextField
    v-model="model"
    :label="label"
    :placeholder="placeholder"
    action-icon="lucide:folder-open"
    :action-title="selecting ? '正在打开文件选择器…' : dialogTitle"
    :action-disabled="selecting"
    @action="selectFile"
  />
</template>
