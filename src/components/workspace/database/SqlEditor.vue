<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, reactive, shallowRef, useTemplateRef } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { cn } from '@/utils/cn'

interface SqlToken {
  text: string
  kind: 'plain' | 'keyword' | 'function' | 'string' | 'number' | 'comment' | 'operator' | 'identifier'
}

const props = withDefaults(defineProps<{
  disabled?: boolean
  suggestions?: readonly string[]
}>(), {
  disabled: false,
  suggestions: () => [],
})

const emit = defineEmits<{
  run: [sql: string]
  save: []
}>()

const sql = defineModel<string>({ required: true })
const editorRef = useTemplateRef<HTMLTextAreaElement>('editor')
const gutterRef = useTemplateRef<HTMLElement>('gutter')
const scroll = reactive({ top: 0, left: 0 })
const autocompleteOpen = shallowRef(false)
const autocompleteForced = shallowRef(false)
const activeSuggestion = shallowRef(0)
const replaceStart = shallowRef(0)
const currentPrefix = shallowRef('')

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
  'OUTER', 'FULL', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'EXISTS', 'BETWEEN',
  'LIKE', 'ILIKE', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'UNION',
  'ALL', 'WITH', 'RETURNING', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'TRUE',
  'FALSE', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'CONSTRAINT', 'CASCADE',
] as const
const SQL_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST', 'NOW', 'LOWER', 'UPPER', 'LENGTH', 'ROUND'])
const keywordSet = new Set<string>(SQL_KEYWORDS)

const lineNumbers = computed(() => Array.from({ length: Math.max(1, sql.value.split('\n').length) }, (_, index) => index + 1))
const tokens = computed<SqlToken[]>(() => {
  const result: SqlToken[] = []
  const pattern = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w$]*\b|\s+|.)/gu
  for (const match of sql.value.matchAll(pattern)) {
    const text = match[0]
    const upper = text.toUpperCase()
    let kind: SqlToken['kind'] = 'plain'
    if (text.startsWith('--') || text.startsWith('/*'))
      kind = 'comment'
    else if (text.startsWith("'") || text.startsWith('"') || text.startsWith('`'))
      kind = text.startsWith("'") ? 'string' : 'identifier'
    else if (/^\d/u.test(text))
      kind = 'number'
    else if (keywordSet.has(upper))
      kind = 'keyword'
    else if (SQL_FUNCTIONS.has(upper))
      kind = 'function'
    else if (/^[+*/%=<>!.,;()[\]-]+$/u.test(text))
      kind = 'operator'
    result.push({ text, kind })
  }
  return result
})

const allSuggestions = computed(() => {
  const seen = new Set<string>()
  return [...SQL_KEYWORDS, ...SQL_FUNCTIONS, ...props.suggestions]
    .filter((item) => {
      const key = item.toLocaleLowerCase()
      if (seen.has(key))
        return false
      seen.add(key)
      return true
    })
})
const filteredSuggestions = computed(() => {
  const prefix = currentPrefix.value.toLocaleLowerCase()
  return allSuggestions.value
    .filter(item => autocompleteForced.value || !prefix || item.toLocaleLowerCase().startsWith(prefix))
    .filter(item => item.toLocaleLowerCase() !== prefix)
    .slice(0, 10)
})
const autocompleteStyle = computed<CSSProperties>(() => {
  const editor = editorRef.value
  const before = sql.value.slice(0, editor?.selectionStart ?? 0)
  const lines = before.split('\n')
  const row = lines.length - 1
  const column = lines.at(-1)?.length ?? 0
  return {
    left: `${Math.max(8, Math.min(column * 7.25 + 12 - scroll.left, (editor?.clientWidth ?? 320) - 220))}px`,
    top: `${Math.max(8, row * 19.8 + 30 - scroll.top)}px`,
  }
})

function runnableSql(): string {
  const editor = editorRef.value
  if (!editor)
    return sql.value.trim()
  const selected = sql.value.slice(editor.selectionStart, editor.selectionEnd).trim()
  return selected || sql.value.trim()
}

function updateAutocomplete(forced = false): void {
  const editor = editorRef.value
  if (!editor || props.disabled || editor.selectionStart !== editor.selectionEnd) {
    autocompleteOpen.value = false
    return
  }

  const cursor = editor.selectionStart
  const prefix = sql.value.slice(0, cursor).match(/[A-Za-z_][\w$]*$/u)?.[0] ?? ''
  currentPrefix.value = prefix
  replaceStart.value = cursor - prefix.length
  autocompleteForced.value = forced
  activeSuggestion.value = 0
  autocompleteOpen.value = (forced || prefix.length >= 2) && filteredSuggestions.value.length > 0
}

function insertSuggestion(value: string): void {
  const editor = editorRef.value
  if (!editor)
    return
  const end = editor.selectionStart
  editor.setRangeText(value, replaceStart.value, end, 'end')
  sql.value = editor.value
  autocompleteOpen.value = false
  void nextTick(() => editor.focus())
}

function handleKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    emit('save')
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    if (!props.disabled) {
      autocompleteOpen.value = false
      const statement = runnableSql()
      if (statement)
        emit('run', statement)
    }
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
    event.preventDefault()
    updateAutocomplete(true)
    return
  }

  if (autocompleteOpen.value && filteredSuggestions.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      activeSuggestion.value = (activeSuggestion.value + direction + filteredSuggestions.value.length) % filteredSuggestions.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const suggestion = filteredSuggestions.value[activeSuggestion.value]
      if (suggestion)
        insertSuggestion(suggestion)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      autocompleteOpen.value = false
      return
    }
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

function handleInput(): void {
  updateAutocomplete()
}

function syncScroll(): void {
  if (!editorRef.value)
    return
  scroll.top = editorRef.value.scrollTop
  scroll.left = editorRef.value.scrollLeft
  if (gutterRef.value)
    gutterRef.value.scrollTop = scroll.top
}

defineExpose({ runnableSql })
</script>

<template>
  <div class="relative flex min-h-0 flex-[1.05] overflow-hidden bg-terminal font-mono text-[12px] leading-[1.65]">
    <div ref="gutter" class="scroll-none w-11 shrink-0 overflow-hidden border-r border-line-soft py-2 text-right text-txt-4" aria-hidden="true">
      <div v-for="line in lineNumbers" :key="line" class="h-[19.8px] pr-2.5">{{ line }}</div>
    </div>

    <div class="relative min-w-0 flex-1 overflow-hidden">
      <pre class="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2 whitespace-pre" aria-hidden="true"><code :style="{ display: 'block', transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }"><span v-for="(token, index) in tokens" :key="index" :class="`sql-token-${token.kind}`">{{ token.text }}</span></code></pre>
      <textarea
        ref="editor"
        v-model="sql"
        class="sql-editor absolute inset-0 size-full resize-none overflow-auto bg-transparent px-3 py-2 outline-none scroll-thin selection:bg-violet/30"
        :disabled="disabled"
        spellcheck="false"
        aria-label="SQL 编辑器"
        placeholder="输入 SQL；选中片段后按 Ctrl+Enter 可只执行选中内容"
        @input="handleInput"
        @click="updateAutocomplete()"
        @keydown="handleKeydown"
        @keyup.left="updateAutocomplete()"
        @keyup.right="updateAutocomplete()"
        @scroll="syncScroll"
        @blur="autocompleteOpen = false"
      />

      <div v-if="autocompleteOpen && filteredSuggestions.length" class="absolute z-30 w-52 overflow-hidden rounded-lg border border-line-strong bg-panel/96 p-1 shadow-pop backdrop-blur-xl" :style="autocompleteStyle" role="listbox">
        <button
          v-for="(suggestion, index) in filteredSuggestions"
          :key="suggestion"
          type="button"
          :class="cn('flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px]', index === activeSuggestion ? 'bg-hover text-txt' : 'text-txt-2')"
          tabindex="-1"
          @pointerdown.prevent="insertSuggestion(suggestion)"
          @pointerenter="activeSuggestion = index"
        >
          <AppIcon :name="keywordSet.has(suggestion.toUpperCase()) ? 'lucide:case-upper' : 'lucide:braces'" :size="11" :class="keywordSet.has(suggestion.toUpperCase()) ? 'text-violet' : 'text-blue'" />
          <span class="min-w-0 flex-1 truncate">{{ suggestion }}</span>
          <span class="text-[9px] text-txt-4">{{ keywordSet.has(suggestion.toUpperCase()) ? 'KEYWORD' : 'OBJECT' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sql-editor {
  color: transparent;
  caret-color: var(--color-term-fg);
  -webkit-text-fill-color: transparent;
}

.sql-editor::placeholder {
  color: var(--color-txt-4);
  -webkit-text-fill-color: var(--color-txt-4);
}

.sql-token-plain,
.sql-token-identifier { color: var(--color-term-fg); }
.sql-token-keyword { color: var(--color-violet); font-weight: 600; }
.sql-token-function { color: var(--color-blue); }
.sql-token-string { color: var(--color-term-green); }
.sql-token-number { color: var(--color-amber); }
.sql-token-comment { color: var(--color-txt-4); font-style: italic; }
.sql-token-operator { color: var(--color-txt-3); }

@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto; }
}
</style>
