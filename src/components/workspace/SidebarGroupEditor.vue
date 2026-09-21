<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { nextTick, onMounted, shallowRef, useTemplateRef } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    initialValue?: string
    placeholder?: string
  }>(),
  {
    initialValue: '',
    placeholder: 'Group name',
  }
)

const emit = defineEmits<{
  submit: [name: string]
  cancel: []
}>()

const value = shallowRef(props.initialValue)
const input = useTemplateRef<HTMLInputElement>('input')

function submit(): void {
  const name = value.value.trim()
  if (name) emit('submit', name)
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
  <form
    class="field field-inline w-full"
    @submit.prevent="submit"
    @keydown.esc.stop.prevent="emit('cancel')"
  >
    <AppIcon
      name="lucide:folder-pen"
      :size="13"
      class="text-txt-4 shrink-0"
    />
    <input
      ref="input"
      v-model="value"
      type="text"
      autocomplete="off"
      spellcheck="false"
      maxlength="64"
      :placeholder="placeholder"
      :aria-label="t('分组名称')"
      class="min-w-0 flex-1"
    />
    <button
      type="submit"
      class="field-action"
      :disabled="!value.trim()"
      :title="t('确认')"
      :aria-label="t('确认')"
    >
      <AppIcon
        name="lucide:check"
        :size="12"
      />
    </button>
    <button
      type="button"
      class="field-action"
      :title="t('取消')"
      :aria-label="t('取消')"
      @click="emit('cancel')"
    >
      <AppIcon
        name="lucide:x"
        :size="12"
      />
    </button>
  </form>
</template>
