<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    min?: number
    max?: number
    step?: number
    unit?: string
    disabled?: boolean
  }>(),
  { min: 0, max: 100, step: 1, unit: '', disabled: false }
)
const model = defineModel<number>({ required: true })
const id = useId()
const progress = computed(() =>
  props.max > props.min
    ? Math.min(
        100,
        Math.max(0, ((model.value - props.min) / (props.max - props.min)) * 100)
      )
    : 0
)
</script>

<template>
  <div
    class="app-slider"
    :class="{ 'is-disabled': disabled }"
  >
    <label :for="id">{{ label }}</label>
    <div class="slider-track">
      <input
        :id="id"
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        :value="model"
        :aria-valuetext="`${model}${unit}`"
        :style="{ '--slider-progress': `${progress}%` }"
        @input="model = Number(($event.target as HTMLInputElement).value)"
      />
    </div>
    <output :for="id"
      >{{ model }}<span>{{ unit }}</span></output
    >
  </div>
</template>

<style scoped>
.app-slider {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  color: var(--color-txt-2);
  font-size: 11px;
}
.app-slider label {
  flex-shrink: 0;
  cursor: pointer;
}
.slider-track {
  flex: 1;
  min-width: 36px;
  display: flex;
  align-items: center;
}
input {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 28px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  outline: none;
}
input::-webkit-slider-runnable-track {
  height: 5px;
  border-radius: 10px;
  background: linear-gradient(
    to right,
    var(--color-accent) 0% var(--slider-progress),
    var(--color-line-strong) var(--slider-progress) 100%
  );
}
input::-moz-range-track {
  height: 5px;
  border-radius: 10px;
  background: var(--color-line-strong);
}
input::-moz-range-progress {
  height: 5px;
  border-radius: 10px;
  background: var(--color-accent);
}
input::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -4.5px;
  border: 2px solid var(--color-accent);
  border-radius: 50%;
  background: var(--color-txt);
  box-shadow: 0 1px 5px #0002;
  transition:
    box-shadow 150ms,
    transform 150ms;
}
input::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 2px solid var(--color-accent);
  border-radius: 50%;
  background: var(--color-txt);
  box-shadow: 0 1px 5px #0002;
}
input:hover::-webkit-slider-thumb,
input:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 18%, transparent);
}
input:active::-webkit-slider-thumb {
  transform: scale(1.12);
}
input:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--color-accent) 50%, transparent);
  outline-offset: 3px;
  border-radius: 5px;
}
output {
  min-width: 53px;
  padding: 4px 7px;
  text-align: right;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-txt);
  font-variant-numeric: tabular-nums;
}
output span {
  margin-left: 2px;
  color: var(--color-txt-3);
  font-size: 10px;
}
.is-disabled {
  opacity: 0.45;
}
.is-disabled input {
  cursor: not-allowed;
}
</style>
