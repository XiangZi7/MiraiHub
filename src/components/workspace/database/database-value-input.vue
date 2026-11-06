<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue'
import {
  databaseInputType,
  dateInputValue,
  databaseDateValue,
} from '@/utils/database-value'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ dataType?: string; autofocus?: boolean }>()
const model = defineModel<string>({ required: true })
const type = computed(() => databaseInputType(props.dataType, model.value))
const input = useTemplateRef<HTMLInputElement>('input')
const value = computed({
  get: () => dateInputValue(model.value, type.value),
  set: value => {
    model.value = databaseDateValue(value, type.value)
  },
})
/** 用户点击日期单元格时展开原生日历；不支持时仍可直接键入日期。 */
function showPicker(): void {
  if (type.value === 'text') return
  try {
    input.value?.showPicker?.()
  } catch {
    /* 浏览器要求用户手势时保留日历按钮。 */
  }
}
onMounted(() => {
  if (!props.autofocus || !input.value) return
  input.value.focus()
  if (type.value === 'text') {
    const end = input.value.value.length
    input.value.setSelectionRange(end, end)
  } else showPicker()
})
</script>
<template>
  <input
    ref="input"
    v-bind="$attrs"
    v-model="value"
    :type="type"
    :step="type === 'time' || type === 'datetime-local' ? 'any' : undefined"
    class="placeholder:text-txt-4 focus:border-violet/40 focus:bg-card focus:ring-violet/45 h-7 w-full min-w-0 border border-transparent bg-transparent px-2.5 font-mono text-inherit outline-none placeholder:italic focus:ring-1 focus:ring-inset"
    autocomplete="off"
    spellcheck="false"
    @click="showPicker"
  />
</template>
