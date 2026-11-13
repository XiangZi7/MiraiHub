<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { Compartment, EditorState } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { codeLanguage } from '@/utils/code-language'

const props = defineProps<{
  /** 远端文件路径，仅用于按文件名识别语言 */
  path: string
  /** 读取或保存期间锁定编辑 */
  disabled?: boolean
  /** 空文档时显示的占位文案 */
  placeholder?: string
}>()

const model = defineModel<string>({ required: true })

const emit = defineEmits<{
  /** 光标所在行列（从 1 开始），供状态栏展示 */
  cursor: [line: number, column: number]
}>()

const hostRef = useTemplateRef<HTMLElement>('host')
let view: EditorView | null = null
const editableCompartment = new Compartment()
const languageCompartment = new Compartment()
const placeholderCompartment = new Compartment()

/* 高亮配色直接绑皮肤令牌：与终端语法色同源，深浅与换肤自动跟随，不另起一套色板。 */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--color-accent)' },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: 'var(--color-term-green)',
  },
  { tag: tags.comment, color: 'var(--color-term-dim)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--color-amber)' },
  {
    tag: [tags.variableName, tags.definition(tags.variableName)],
    color: 'var(--color-term-cyan)',
  },
  {
    tag: [tags.propertyName, tags.attributeName, tags.labelName],
    color: 'var(--color-term-blue)',
  },
  {
    tag: [tags.typeName, tags.className, tags.tagName],
    color: 'var(--color-term-blue)',
  },
  {
    tag: [tags.operator, tags.punctuation, tags.separator],
    color: 'var(--color-txt-2)',
  },
])

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '10px 12px 32px 8px' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-accent)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor:
        'color-mix(in oklab, var(--color-accent) 26%, transparent)',
    },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklab, var(--color-txt) 5%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--color-txt-4)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklab, var(--color-txt) 5%, transparent)',
    color: 'var(--color-txt-2)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px' },
  '.cm-placeholder': { color: 'var(--color-txt-4)' },
  '.cm-panels': {
    backgroundColor: 'var(--color-panel)',
    color: 'var(--color-txt)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--color-line-soft)',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--color-card)',
    border: '1px solid var(--color-line)',
    borderRadius: '6px',
    color: 'var(--color-txt)',
    fontSize: '12px',
    padding: '2px 6px',
  },
  '.cm-button': {
    backgroundColor: 'var(--color-card)',
    backgroundImage: 'none',
    border: '1px solid var(--color-line)',
    borderRadius: '6px',
    color: 'var(--color-txt-2)',
    fontSize: '12px',
    padding: '2px 8px',
  },
})

/** 将实际光标行列同步给窗口状态栏。 */
function reportCursor(state: EditorState): void {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  emit('cursor', line.number, head - line.from + 1)
}

// 草稿按现有文档接口统一使用 LF，远端原有 CRLF/BOM 由后端元数据保持。
onMounted(() => {
  const host = hostRef.value
  if (!host) return
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: model.value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        search({ top: true }),
        syntaxHighlighting(highlightStyle),
        editorTheme,
        EditorState.tabSize.of(2),
        EditorView.contentAttributes.of({
          'aria-label': props.path,
          spellcheck: 'false',
        }),
        languageCompartment.of(codeLanguage(props.path).extension),
        editableCompartment.of([
          EditorView.editable.of(!props.disabled),
          EditorState.readOnly.of(!!props.disabled),
        ]),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        placeholderCompartment.of(
          props.placeholder ? placeholderExtension(props.placeholder) : []
        ),
        EditorView.updateListener.of(update => {
          if (update.docChanged) model.value = update.state.doc.toString()
          if (update.docChanged || update.selectionSet)
            reportCursor(update.state)
        }),
      ],
    }),
  })
  reportCursor(view.state)
})

/* 远端重读或保存回写时整体替换文档；与当前内容相同则跳过，避免打断光标。 */
watch(model, value => {
  if (!view || view.state.doc.toString() === value) return
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
  })
})

/* 读取或保存期间同时锁定输入与编辑命令，保持文档状态一致。 */
watch(
  () => props.disabled,
  disabled => {
    view?.dispatch({
      effects: editableCompartment.reconfigure([
        EditorView.editable.of(!disabled),
        EditorState.readOnly.of(!!disabled),
      ]),
    })
  }
)

/* 占位文案随读取状态切换（读取中 → 可编辑），空文件时也不会停在旧文案上 */
watch(
  () => props.placeholder,
  text => {
    view?.dispatch({
      effects: placeholderCompartment.reconfigure(
        text ? placeholderExtension(text) : []
      ),
    })
  }
)

/* 切换文件时按新路径重配语言解析器，复用当前编辑器实例。 */
watch(
  () => props.path,
  path => {
    view?.dispatch({
      effects: languageCompartment.reconfigure(codeLanguage(path).extension),
    })
  }
)

/* 窗口卸载时释放 CodeMirror 的 DOM 和事件监听。 */
onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

defineExpose({
  /** 将外部焦点请求交给实际代码编辑区。 */
  focus: () => view?.focus(),
})
</script>

<template>
  <div
    ref="host"
    class="code-editor"
    :aria-label="path"
  />
</template>

<style scoped>
.code-editor {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.code-editor :deep(.cm-editor) {
  height: 100%;
  outline: none;
}
</style>
