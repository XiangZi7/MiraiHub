<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from 'vue'

/**
 * 数据表格里正在编辑的那一个单元格。
 *
 * 表格平时只渲染文本，点击后才换成这个输入框：几千个单元格都挂 <input>
 * 既拖慢渲染，输入时每个键都会触发整表重绘。这里用本地草稿，
 * 只在 Enter / Tab / 失焦时把结果交回父组件；没改过就按取消处理，
 * 避免只是点开看看的 NULL 被提交成空字符串。
 */
const props = defineProps<{ value: string | null }>()
const emit = defineEmits<{
  commit: [value: string]
  cancel: []
  /** Tab / Shift+Tab：提交后把编辑焦点移到相邻单元格。 */
  move: [delta: 1 | -1]
}>()

const initial = props.value ?? ''
const draft = shallowRef(initial)
const input = useTemplateRef<HTMLInputElement>('input')
let settled = false

function settle(kind: 'commit' | 'cancel'): void {
  if (settled) return
  settled = true
  if (kind === 'commit' && draft.value !== initial) emit('commit', draft.value)
  else emit('cancel')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    settle('commit')
  } else if (event.key === 'Escape') {
    event.preventDefault()
    settle('cancel')
  } else if (event.key === 'Tab') {
    event.preventDefault()
    if (settled) return
    settle('commit')
    emit('move', event.shiftKey ? -1 : 1)
  }
}

onMounted(() => {
  const element = input.value
  if (!element) return
  element.focus()
  const end = element.value.length
  element.setSelectionRange(end, end)
})
</script>

<template>
  <input
    ref="input"
    v-model="draft"
    type="text"
    class="border-violet/40 bg-card text-txt ring-violet/45 placeholder:text-txt-4 h-7 w-full border px-2.5 font-mono ring-1 outline-none ring-inset placeholder:italic"
    :placeholder="value === null ? 'NULL' : ''"
    autocomplete="off"
    spellcheck="false"
    @keydown="handleKeydown"
    @blur="settle('commit')"
  />
</template>
