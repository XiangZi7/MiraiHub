<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue'
import IconButton from './IconButton.vue'

type FieldType = 'text' | 'password'

const props = withDefaults(defineProps<{
  label: string
  type?: FieldType
  placeholder?: string
  autocomplete?: string
  required?: boolean
  autofocus?: boolean
  inputmode?: 'text' | 'numeric' | 'url'
  readonly?: boolean
  /** 可选的尾部操作图标，例如文件选择器。 */
  actionIcon?: string
  actionTitle?: string
  actionDisabled?: boolean
}>(), {
  type: 'text',
  placeholder: '',
  autocomplete: 'off',
  required: false,
  autofocus: false,
  inputmode: 'text',
  readonly: false,
  actionIcon: '',
  actionTitle: '',
  actionDisabled: false,
})

const emit = defineEmits<{
  action: []
  blur: [event: FocusEvent]
}>()

const model = defineModel<string>({ required: true })
const passwordVisible = shallowRef(false)
const inputId = useId()

const resolvedType = computed<'text' | 'password'>(() => (
  props.type === 'password' && !passwordVisible.value ? 'password' : 'text'
))

const passwordButtonTitle = computed(() => passwordVisible.value ? '隐藏密码' : '显示密码')
</script>

<template>
  <div class="space-y-1.5">
    <label :for="inputId" class="block text-[11px] font-medium text-txt-2">
      {{ label }}
      <span v-if="required" class="text-violet" aria-hidden="true">*</span>
    </label>

    <div class="field h-[34px] px-0">
      <input
        :id="inputId"
        v-model="model"
        :type="resolvedType"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :required="required"
        :autofocus="autofocus"
        :inputmode="inputmode"
        :readonly="readonly"
        class="min-w-0 flex-1 px-2.5"
        @blur="emit('blur', $event)"
      >

      <IconButton
        v-if="type === 'password'"
        :icon="passwordVisible ? 'lucide:eye-off' : 'lucide:eye'"
        :size="14"
        :title="passwordButtonTitle"
        :aria-label="passwordButtonTitle"
        :aria-pressed="passwordVisible"
        class="mr-0.5"
        @click="passwordVisible = !passwordVisible"
      />

      <IconButton
        v-if="actionIcon"
        :icon="actionIcon"
        :size="14"
        :title="actionTitle"
        :aria-label="actionTitle"
        :disabled="actionDisabled"
        class="mr-0.5"
        @click="emit('action')"
      />
    </div>
  </div>
</template>
