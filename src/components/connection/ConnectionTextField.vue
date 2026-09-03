<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

type FieldType = 'text' | 'password'

const props = withDefaults(defineProps<{
  label: string
  type?: FieldType
  placeholder?: string
  autocomplete?: string
  required?: boolean
  autofocus?: boolean
  inputmode?: 'text' | 'numeric' | 'url'
}>(), {
  type: 'text',
  placeholder: '',
  autocomplete: 'off',
  required: false,
  autofocus: false,
  inputmode: 'text',
})

const model = defineModel<string>({ required: true })
const passwordVisible = shallowRef(false)
const inputId = useId()

const resolvedType = computed<'text' | 'password'>(() => (
  props.type === 'password' && !passwordVisible.value ? 'password' : 'text'
))
</script>

<template>
  <div class="space-y-1.5">
    <label :for="inputId" class="block text-[11px] font-medium text-txt-2">
      {{ label }}
      <span v-if="required" class="text-violet" aria-hidden="true">*</span>
    </label>

    <div class="connection-control">
      <input
        :id="inputId"
        v-model="model"
        :type="resolvedType"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :required="required"
        :autofocus="autofocus"
        :inputmode="inputmode"
        class="connection-input"
      >

      <button
        v-if="type === 'password'"
        type="button"
        class="connection-control-button"
        :title="passwordVisible ? '隐藏密码' : '显示密码'"
        :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
        :aria-pressed="passwordVisible"
        @click="passwordVisible = !passwordVisible"
      >
        <AppIcon :name="passwordVisible ? 'lucide:eye-off' : 'lucide:eye'" :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.connection-control {
  display: flex;
  height: 34px;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.025);
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease;
}

.connection-control:focus-within {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  background: color-mix(in oklch, var(--color-raised) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}

.connection-input {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  border: 0;
  background: transparent;
  padding: 0 10px;
  color: var(--color-txt);
  font-size: 12px;
  outline: none;
}

.connection-input::placeholder {
  color: var(--color-txt-4);
}

.connection-control-button {
  display: grid;
  width: 34px;
  height: 100%;
  flex-shrink: 0;
  cursor: pointer;
  place-items: center;
  color: var(--color-txt-4);
  transition: color 150ms ease;
}

.connection-control-button:hover,
.connection-control-button:focus-visible {
  color: var(--color-txt-2);
  outline: none;
}
</style>
