<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { CSSProperties } from 'vue'
import {
  computed,
  nextTick,
  reactive,
  shallowRef,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { ContextMenuItem } from '@/types/context-menu'
import type { DatabaseKind } from '@/types/database'
import { copyText } from '@/utils/clipboard'
import { toast } from '@/composables/useToast'
import {
  completeSql,
  parseSql,
  type SqlSuggestion,
} from '@/utils/sql-completion'
import { cn } from '@/utils/cn'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    databaseKind?: DatabaseKind
    disabled?: boolean
    suggestions?: readonly string[]
  }>(),
  {
    databaseKind: 'mysql',
    disabled: false,
    suggestions: () => [],
  }
)

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
const replaceEnd = shallowRef(0)
const filteredSuggestions = shallowRef<SqlSuggestion[]>([])
// 响应式状态
const state = reactive({
  // 菜单打开时保存选区，菜单获取焦点后仍能精确执行原选区
  contextMenu: {
    open: false,
    x: 0,
    y: 0,
    start: 0,
    end: 0,
    source: '',
    selected: '',
  },
  // 右键默认行为可能移动光标，提前保留用户已经选中的内容
  pendingSelection: null as {
    start: number
    end: number
    source: string
  } | null,
})
const { contextMenu } = toRefs(state)
const contextItems = computed<ContextMenuItem[]>(() => [
  {
    id: 'run-selection',
    label: t('运行选中的 SQL'),
    icon: 'lucide:play',
    shortcut: 'Ctrl+Enter',
    disabled: props.disabled || !state.contextMenu.selected.trim(),
  },
  {
    id: 'run-all',
    label: t('运行全部 SQL'),
    icon: 'lucide:list-start',
    disabled: props.disabled || !sql.value.trim(),
  },
  {
    id: 'copy',
    label: t('复制'),
    icon: 'lucide:copy',
    separatorBefore: true,
    disabled: !state.contextMenu.selected,
  },
  {
    id: 'cut',
    label: t('剪切'),
    icon: 'lucide:scissors',
    disabled: props.disabled || !state.contextMenu.selected,
  },
  {
    id: 'paste',
    label: t('粘贴'),
    icon: 'lucide:clipboard-paste',
    disabled: props.disabled,
  },
  {
    id: 'select-all',
    label: t('全选'),
    shortcut: 'Ctrl+A',
    disabled: !sql.value,
  },
])

function openContextMenu(event: MouseEvent): void {
  const editor = editorRef.value
  if (!editor) return
  autocompleteOpen.value = false
  const pending = state.pendingSelection
  const selection =
    pending?.source === sql.value
      ? pending
      : { start: editor.selectionStart, end: editor.selectionEnd }
  state.pendingSelection = null
  state.contextMenu = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    start: selection.start,
    end: selection.end,
    source: sql.value,
    selected: sql.value.slice(selection.start, selection.end),
  }
}

function captureContextSelection(event: PointerEvent): void {
  const editor = editorRef.value
  state.pendingSelection =
    event.button === 2 &&
    editor &&
    editor.selectionStart !== editor.selectionEnd
      ? {
          start: editor.selectionStart,
          end: editor.selectionEnd,
          source: sql.value,
        }
      : null
}

async function handleContextAction(id: string): Promise<void> {
  const selection = { ...state.contextMenu }
  state.contextMenu.open = false
  if (id === 'run-selection' || id === 'run-all') {
    if (props.disabled) return
    const statement =
      id === 'run-selection' ? selection.selected.trim() : sql.value.trim()
    if (statement) emit('run', statement)
    return
  }
  const editor = editorRef.value
  if (!editor) return
  try {
    if (id === 'copy' || id === 'cut') await copyText(selection.selected)
    if (id === 'cut' || id === 'paste') {
      if (props.disabled) return
      const text = id === 'paste' ? await navigator.clipboard.readText() : ''
      if (sql.value !== selection.source || props.disabled) return
      editor.setRangeText(text, selection.start, selection.end, 'end')
      sql.value = editor.value
    }
    await nextTick()
    editor.focus()
    if (id === 'select-all') editor.select()
    else if (id === 'copy')
      editor.setSelectionRange(selection.start, selection.end)
  } catch {
    toast.error(t('剪贴板操作失败，请使用键盘快捷键重试'))
  }
}

const parsedSql = computed(() => parseSql(sql.value, props.databaseKind))
const tokens = computed(() => parsedSql.value.tokens)
const lineNumbers = computed(() =>
  Array.from(
    { length: Math.max(1, sql.value.split('\n').length) },
    (_, index) => index + 1
  )
)

const autocompleteStyle = computed<CSSProperties>(() => {
  const editor = editorRef.value
  const before = sql.value.slice(
    0,
    replaceStart.value + currentPrefix.value.length
  )
  const lines = before.split('\n')
  const row = lines.length - 1
  const column = lines.at(-1)?.length ?? 0
  return {
    left: `${Math.max(8, Math.min(column * 7.25 + 12 - scroll.left, (editor?.clientWidth ?? 320) - 220))}px`,
    top: `${Math.max(8, Math.min(row * 19.8 + 30 - scroll.top, (editor?.clientHeight ?? 320) - 160))}px`,
  }
})

function runnableSql(): string {
  const editor = editorRef.value
  if (!editor) return sql.value.trim()
  const selected = sql.value
    .slice(editor.selectionStart, editor.selectionEnd)
    .trim()
  return selected || sql.value.trim()
}

function updateAutocomplete(forced = false): void {
  const editor = editorRef.value
  if (
    !editor ||
    props.disabled ||
    editor.selectionStart !== editor.selectionEnd
  ) {
    autocompleteOpen.value = false
    return
  }

  const cursor = editor.selectionStart
  const completion = completeSql(
    parsedSql.value,
    cursor,
    props.suggestions,
    forced
  )
  if (!completion) {
    autocompleteOpen.value = false
    return
  }
  currentPrefix.value = completion.prefix
  replaceStart.value = completion.from
  replaceEnd.value = completion.to
  filteredSuggestions.value = completion.options
  autocompleteForced.value = forced
  activeSuggestion.value = 0
  autocompleteOpen.value = filteredSuggestions.value.length > 0
}

watch([() => props.suggestions, () => props.databaseKind], () => {
  if (editorRef.value === document.activeElement)
    updateAutocomplete(autocompleteForced.value)
})

function insertSuggestion(value: SqlSuggestion): void {
  const editor = editorRef.value
  if (!editor) return
  editor.setRangeText(value.text, replaceStart.value, replaceEnd.value, 'end')
  sql.value = editor.value
  autocompleteOpen.value = false
  void nextTick(() => editor.focus())
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
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
      if (statement) emit('run', statement)
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
      activeSuggestion.value =
        (activeSuggestion.value +
          direction +
          filteredSuggestions.value.length) %
        filteredSuggestions.value.length
      void nextTick(() =>
        editorRef.value?.parentElement
          ?.querySelector('[aria-selected="true"]')
          ?.scrollIntoView({ block: 'nearest' })
      )
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const suggestion = filteredSuggestions.value[activeSuggestion.value]
      if (suggestion) insertSuggestion(suggestion)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      autocompleteOpen.value = false
      return
    }
  }

  if (event.key !== 'Tab') return

  event.preventDefault()
  const editor = editorRef.value
  if (!editor) return
  const start = editor.selectionStart
  editor.setRangeText('  ', start, editor.selectionEnd, 'end')
  sql.value = editor.value
  void nextTick(() => editor.setSelectionRange(start + 2, start + 2))
}

function handleInput(event: Event): void {
  if ((event as InputEvent).isComposing) return
  updateAutocomplete()
}

function syncScroll(): void {
  if (!editorRef.value) return
  scroll.top = editorRef.value.scrollTop
  scroll.left = editorRef.value.scrollLeft
  if (gutterRef.value) gutterRef.value.scrollTop = scroll.top
}

defineExpose({ runnableSql })
</script>

<template>
  <div
    class="bg-terminal relative flex min-h-0 flex-[1.05] overflow-hidden font-mono text-[12px] leading-[1.65]"
  >
    <div
      ref="gutter"
      class="scroll-none border-line-soft text-txt-4 w-11 shrink-0 overflow-hidden border-r py-2 text-right"
      aria-hidden="true"
    >
      <div
        v-for="line in lineNumbers"
        :key="line"
        class="h-[19.8px] pr-2.5"
      >
        {{ line }}
      </div>
    </div>

    <div class="relative min-w-0 flex-1 overflow-hidden">
      <pre
        class="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2 whitespace-pre"
        aria-hidden="true"
      ><code :style="{ display: 'block', transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }"><span v-for="(token, index) in tokens" :key="index" :class="`sql-token-${token.kind}`">{{ token.text }}</span></code></pre>
      <textarea
        ref="editor"
        v-model="sql"
        class="sql-editor scroll-thin selection:bg-violet/30 absolute inset-0 size-full resize-none overflow-auto bg-transparent px-3 py-2 outline-none"
        :disabled="disabled"
        spellcheck="false"
        :aria-label="t('SQL 编辑器')"
        :placeholder="t('输入 SQL；选中片段后按 Ctrl+Enter 可只执行选中内容')"
        @input="handleInput"
        @click="updateAutocomplete()"
        @keydown="handleKeydown"
        @keyup.left="updateAutocomplete()"
        @keyup.right="updateAutocomplete()"
        @scroll="syncScroll"
        @blur="autocompleteOpen = false"
        @contextmenu.prevent.stop="openContextMenu"
        @pointerdown="captureContextSelection"
        @compositionend="updateAutocomplete()"
      />

      <div
        v-if="autocompleteOpen && filteredSuggestions.length"
        class="border-line-strong bg-panel/96 shadow-pop scroll-thin absolute z-30 max-h-40 w-52 overflow-y-auto rounded-lg border p-1 backdrop-blur-xl"
        :style="autocompleteStyle"
        role="listbox"
      >
        <AppButton
          v-for="(suggestion, index) in filteredSuggestions"
          :key="suggestion.label"
          variant="bare"
          :class="
            cn(
              'flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px]',
              index === activeSuggestion ? 'bg-hover text-txt' : 'text-txt-2'
            )
          "
          tabindex="-1"
          role="option"
          :aria-selected="index === activeSuggestion"
          @pointerdown.prevent="insertSuggestion(suggestion)"
          @pointerenter="activeSuggestion = index"
        >
          <AppIcon
            :name="
              suggestion.kind === 'keyword'
                ? 'lucide:case-upper'
                : 'lucide:braces'
            "
            :size="11"
            :class="suggestion.kind === 'keyword' ? 'text-violet' : 'text-blue'"
          />
          <span class="min-w-0 flex-1 truncate">{{ suggestion.label }}</span>
          <span class="text-txt-4 text-[9px]">{{
            suggestion.kind.toUpperCase()
          }}</span>
        </AppButton>
      </div>
    </div>
    <AppContextMenu
      :open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextItems"
      :label="t('SQL 编辑器')"
      @close="contextMenu.open = false"
      @select="handleContextAction"
    />
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
.sql-token-identifier {
  color: var(--color-term-fg);
}
.sql-token-keyword {
  color: var(--color-violet);
  font-weight: 600;
}
.sql-token-function {
  color: var(--color-blue);
}
.sql-token-string {
  color: var(--color-term-green);
}
.sql-token-number {
  color: var(--color-amber);
}
.sql-token-comment {
  color: var(--color-txt-4);
  font-style: italic;
}
.sql-token-operator {
  color: var(--color-txt-3);
}

@media (prefers-reduced-motion: reduce) {
  * {
    scroll-behavior: auto;
  }
}
</style>
