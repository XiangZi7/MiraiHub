<script setup lang="ts">
import { computed, nextTick, useTemplateRef } from 'vue'

const props = withDefaults(defineProps<{
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  run: []
}>()

const sql = defineModel<string>({ required: true })
const editorRef = useTemplateRef<HTMLTextAreaElement>('editor')
const gutterRef = useTemplateRef<HTMLElement>('gutter')
const lineNumbers = computed(() => Array.from({ length: Math.max(1, sql.value.split('\n').length) }, (_, index) => index + 1))

function handleKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    if (!props.disabled)
      emit('run')
    return
  }

  if (event.key !== 'Tab')
    return

  event.preventDefault()
  const editor = editorRef.value
  if (!editor)
    return

  const start = editor.selectionStart
  editor.setRangeText('  ', start, editor.selectionEnd, 'end')
  sql.value = editor.value
  void nextTick(() => editor.setSelectionRange(start + 2, start + 2))
}

function syncScroll(): void {
  if (gutterRef.value && editorRef.value)
    gutterRef.value.scrollTop = editorRef.value.scrollTop
}
</script>

<template>
  <div class="relative flex min-h-0 flex-[1.05] overflow-hidden bg-terminal font-mono text-[12px] leading-[1.65]">
    <div
      ref="gutter"
      class="scroll-none w-11 shrink-0 overflow-hidden border-r border-line-soft py-2 text-right text-txt-4"
      aria-hidden="true"
    >
      <div v-for="line in lineNumbers" :key="line" class="h-[19.8px] pr-2.5">
        {{ line }}
      </div>
    </div>
    <textarea
      ref="editor"
      v-model="sql"
      class="min-h-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 text-term-fg outline-none scroll-thin selection:bg-violet/30"
      :disabled="disabled"
      spellcheck="false"
      aria-label="SQL 编辑器"
      placeholder="输入 SQL，按 Ctrl+Enter 执行"
      @keydown="handleKeydown"
      @scroll="syncScroll"
    />
  </div>
</template>
