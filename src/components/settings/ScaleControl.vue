<script setup lang="ts">
import { computed } from 'vue'
import IconButton from '@/components/ui/IconButton.vue'
import {
  normalizeUiScale,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_STEP,
} from '@/utils/ui-scale'
const props = defineProps<{ modelValue: string; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const percent = computed(() => normalizeUiScale(props.modelValue))
function change(amount: number): void {
  emit('update:modelValue', String(normalizeUiScale(percent.value + amount)))
}
</script>
<template>
  <div
    class="flex shrink-0 items-center gap-1"
    role="group"
    :aria-label="label"
  >
    <IconButton
      icon="lucide:minus"
      title="缩小全局字体"
      :disabled="percent <= UI_SCALE_MIN"
      @click="change(-UI_SCALE_STEP)"
    />
    <output
      class="text-txt w-12 text-center font-mono text-xs"
      aria-live="polite"
      >{{ percent }}%</output
    >
    <IconButton
      icon="lucide:plus"
      title="放大全局字体"
      :disabled="percent >= UI_SCALE_MAX"
      @click="change(UI_SCALE_STEP)"
    />
    <IconButton
      icon="lucide:rotate-ccw"
      title="恢复默认大小 (100%)"
      :disabled="percent === 100"
      @click="emit('update:modelValue', '100')"
    />
  </div>
</template>
