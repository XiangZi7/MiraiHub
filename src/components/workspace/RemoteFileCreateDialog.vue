<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { nextTick, onMounted, shallowRef, useTemplateRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { toast } from '@/composables/useToast'

const { t } = useI18n()
const props = defineProps<{ isDirectory: boolean }>()
const emit = defineEmits<{ submit: [name: string]; close: [] }>()
const name = shallowRef('')
const input = useTemplateRef<HTMLInputElement>('input')
const title = props.isDirectory ? t('新建文件夹') : t('新建文件')

function submit(): void {
  const value = name.value.trim()
  if (!value || value === '.' || value === '..' || /[\\/\x00-\x1f]/.test(value)) {
    toast.warning(t('请输入不含斜杠的有效文件名'))
    return
  }
  emit('submit', value)
}

onMounted(() => void nextTick(() => input.value?.focus()))
</script>

<template>
  <AppDialog :title="title" @close="emit('close')">
    <form @submit.prevent="submit">
      <input
        ref="input"
        v-model="name"
        :aria-label="title"
        :placeholder="title"
        autocomplete="off"
        class="text-txt border-line bg-panel h-9 w-full rounded-md border px-2 text-xs outline-none"
      />
    </form>
    <template #footer>
      <div class="flex-1" />
      <AppButton size="sm" @click="emit('close')">{{ t('取消') }}</AppButton>
      <AppButton size="sm" variant="primary" @click="submit">{{ t('创建') }}</AppButton>
    </template>
  </AppDialog>
</template>
