<script setup lang="ts">
import { useId } from 'vue'

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
    :class="['app-switch inline-flex cursor-pointer items-start gap-2.5', disabled && 'pointer-events-none opacity-45']"
  >
    <input
      :id="inputId"
      v-model="model"
      type="checkbox"
      role="switch"
      :disabled="disabled"
      :aria-describedby="description ? descriptionId : undefined"
      class="app-switch-input sr-only"
    >
    <span
      :class="['app-switch-track mt-px inline-flex h-[18px] w-8 shrink-0 items-center p-0.5', model && 'app-switch-track-on']"
      aria-hidden="true"
    >
      <span :class="['app-switch-thumb size-3', model && 'translate-x-3.5']" />
    </span>
    <span class="min-w-0">
      <span class="block text-[11px] leading-[18px] text-txt-2">{{ label }}</span>
      <span v-if="description" :id="descriptionId" class="mt-0.5 block text-[10px] leading-4 text-txt-3">
        {{ description }}
      </span>
    </span>
  </label>
</template>

<style scoped>
.app-switch-track {
  border: 1px solid var(--color-line-strong);
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}

.app-switch:hover .app-switch-track {
  border-color: color-mix(in oklch, var(--color-violet) 48%, var(--color-line-strong));
}

.app-switch-track-on {
  border-color: color-mix(in oklch, var(--color-violet) 68%, white 8%);
  background: linear-gradient(135deg, var(--color-indigo), var(--color-violet));
}

.app-switch-thumb {
  border-radius: 999px;
  background: var(--color-txt-3);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
  transition: transform 150ms ease, background-color 150ms ease;
}

.app-switch-track-on .app-switch-thumb {
  background: white;
}

.app-switch-input:focus-visible + .app-switch-track {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .app-switch-track,
  .app-switch-thumb {
    transition: none;
  }
}
</style>
