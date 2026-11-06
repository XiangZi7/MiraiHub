<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue'
import AppDatePicker from '@/components/ui/AppDatePicker.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { databaseInputType } from '@/utils/database-value'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ dataType?: string; autofocus?: boolean }>()
const model = defineModel<string>({ required: true })
const type = computed(() => databaseInputType(props.dataType))
const picker = useTemplateRef<InstanceType<typeof AppDatePicker>>('picker')
const text = useTemplateRef<InstanceType<typeof AppInput>>('text')
/** 点开日期单元格时直接展开日历，仍可直接键入；光标统一放到末尾。 */
onMounted(() => {
  if (!props.autofocus) return
  const element: HTMLElement | undefined = (picker.value ?? text.value)?.$el
  const input =
    element instanceof HTMLInputElement
      ? element
      : element?.querySelector('input')
  if (!input) return
  input.focus()
  const end = input.value.length
  input.setSelectionRange(end, end)
  void picker.value?.open()
})
</script>
<template>
  <AppDatePicker
    v-if="type !== 'text'"
    ref="picker"
    v-bind="$attrs"
    v-model="model"
    :mode="type"
    variant="cell"
  />
  <AppInput
    v-else
    ref="text"
    v-bind="$attrs"
    v-model="model"
    variant="cell"
    monospace
    autocomplete="off"
    spellcheck="false"
  />
</template>
