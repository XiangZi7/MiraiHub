<script setup lang="ts">
import { useId } from 'vue'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  label: string
  rows?: number
  required?: boolean
  disabled?: boolean
  hideLabel?: boolean
}>(), {
  rows: 3,
  required: false,
  disabled: false,
  hideLabel: false,
})

const model = defineModel<string>({ required: true })
const inputId = useId()
</script>

<template>
  <div class="space-y-1.5">
    <label :for="inputId" :class="hideLabel ? 'sr-only' : 'block text-[11px] font-medium text-txt-2'">
      {{ label }}
      <span v-if="required" class="text-violet" aria-hidden="true">*</span>
    </label>
    <textarea
      v-bind="$attrs"
      :id="inputId"
      v-model="model"
      :rows="rows"
      :required="required"
      :disabled="disabled"
      class="app-textarea w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 text-xs text-txt outline-none placeholder:text-txt-4 focus:border-violet/65 focus:ring-3 focus:ring-violet/12 disabled:pointer-events-none disabled:opacity-45"
    />
  </div>
</template>

<style scoped>
.app-textarea {
  transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .app-textarea {
    transition: none;
  }
}
</style>
