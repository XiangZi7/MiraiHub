<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppTextField from '@/components/ui/AppTextField.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    initialValue?: string
    label?: string
    placeholder?: string
    confirmLabel?: string
    loading?: boolean
  }>(),
  {
    description: '',
    initialValue: '',
    label: '',
    placeholder: '',
    confirmLabel: '',
    loading: false,
  }
)

const emit = defineEmits<{
  close: []
  submit: [name: string]
}>()

const state = reactive({ name: '' })
const canSubmit = computed(() => Boolean(state.name.trim()) && !props.loading)

watch(
  [() => props.open, () => props.initialValue],
  ([open, initialValue]) => {
    if (open) state.name = initialValue
  },
  { immediate: true }
)

function submit(): void {
  if (canSubmit.value) emit('submit', state.name.trim())
}
</script>

<template>
  <Teleport to="body">
    <Transition name="database-name-dialog">
      <div
        v-if="open"
        class="fixed inset-0 z-100"
      >
        <AppDialog
          :title="title"
          :description="description"
          @close="!loading && emit('close')"
        >
          <form
            class="grid gap-3"
            @submit.prevent="submit"
          >
            <AppTextField
              v-model="state.name"
              :label="label || t('名称')"
              :placeholder="placeholder || t('请输入名称')"
              required
              autofocus
            />
          </form>

          <template #footer>
            <div class="flex-1" />
            <AppButton
              :disabled="loading"
              @click="emit('close')"
            >
              {{ t('取消') }}
            </AppButton>
            <AppButton
              variant="primary"
              :disabled="!canSubmit"
              @click="submit"
            >
              {{ loading ? t('处理中…') : confirmLabel || t('确认') }}
            </AppButton>
          </template>
        </AppDialog>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.database-name-dialog-enter-active,
.database-name-dialog-leave-active {
  transition: opacity 120ms ease;
}

.database-name-dialog-enter-from,
.database-name-dialog-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .database-name-dialog-enter-active,
  .database-name-dialog-leave-active {
    transition: none;
  }
}
</style>
