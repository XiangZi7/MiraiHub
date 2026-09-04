<script setup lang="ts">
import { useId } from 'vue'
import AppIcon from './AppIcon.vue'

withDefaults(defineProps<{
  label: string
  description?: string
  disabled?: boolean
}>(), {
  description: '',
  disabled: false,
})

const model = defineModel<boolean>({ required: true })
const inputId = useId()
const descriptionId = useId()
</script>

<template>
  <label
    :for="inputId"
    :class="['app-checkbox inline-flex cursor-pointer items-start gap-2', disabled && 'pointer-events-none opacity-45']"
  >
    <input
      :id="inputId"
      v-model="model"
      type="checkbox"
      :disabled="disabled"
      :aria-describedby="description ? descriptionId : undefined"
      class="app-checkbox-input sr-only"
    >
    <span
      :class="['app-checkbox-box mt-px inline-flex size-4 shrink-0 items-center justify-center', model && 'app-checkbox-box-checked']"
      aria-hidden="true"
    >
      <AppIcon v-if="model" name="lucide:check" :size="12" />
    </span>
    <span class="min-w-0">
      <span class="block whitespace-nowrap text-[11px] leading-4 text-txt-2">{{ label }}</span>
      <span v-if="description" :id="descriptionId" class="mt-0.5 block text-[10px] leading-4 text-txt-3">
        {{ description }}
      </span>
    </span>
  </label>
</template>

<style scoped>
.app-checkbox-box {
  border: 1px solid var(--color-line-strong);
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  color: white;
  transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}

.app-checkbox:hover .app-checkbox-box {
  border-color: color-mix(in oklch, var(--color-violet) 48%, var(--color-line-strong));
}

.app-checkbox-box-checked {
  border-color: color-mix(in oklch, var(--color-violet) 68%, white 8%);
  background: var(--color-violet);
}

.app-checkbox-input:focus-visible + .app-checkbox-box {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .app-checkbox-box {
    transition: none;
  }
}
</style>
