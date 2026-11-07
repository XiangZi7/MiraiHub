<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import { useDatabaseGuardHost } from '@/composables/useDatabaseGuard'

const { t } = useI18n()
const { prompt, register, unregister, settle } = useDatabaseGuardHost()

const typed = shallowRef('')
const matches = computed(
  () => prompt.value !== null && typed.value.trim() === prompt.value.expected
)

onMounted(register)
onBeforeUnmount(unregister)
watch(prompt, () => {
  typed.value = ''
})

function submit(): void {
  if (matches.value) settle(typed.value.trim())
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="motion-safe:transition-opacity motion-safe:duration-150"
      leave-active-class="motion-safe:transition-opacity motion-safe:duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="prompt"
        class="fixed inset-0 z-100"
      >
        <AppDialog
          :title="t('确认生产环境操作')"
          :description="prompt.action"
          @close="settle(null)"
        >
          <form
            class="grid gap-3"
            @submit.prevent="submit"
          >
            <p class="text-txt-3 text-xs">
              {{ t('此操作风险较高。请输入 {name} 以继续。', { name: prompt.expected }) }}
            </p>
            <AppTextField
              v-model="typed"
              :label="t('确认文本')"
              :placeholder="prompt.expected"
              autofocus
            />
          </form>
          <template #footer>
            <div class="flex-1" />
            <AppButton @click="settle(null)">{{ t('取消') }}</AppButton>
            <AppButton
              variant="danger"
              :disabled="!matches"
              @click="submit"
            >
              {{ t('确认执行') }}
            </AppButton>
          </template>
        </AppDialog>
      </div>
    </Transition>
  </Teleport>
</template>
