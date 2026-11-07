<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useEventListener, useResizeObserver } from '@vueuse/core'

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
  type SqlDocument,
  type SqlSuggestion,
} from '@/utils/sql-completion'
import { cn } from '@/utils/cn'
import { formatSql, statementAtCursor } from '@/utils/sql-format'
import { formatShortcut, matchesShortcut } from '@/utils/shortcut'
import {
  expandSnippet,
  matchSnippets,
  snippetOrder,
  snippetsFor,
  type SnippetStop,
  type SqlSnippet,
} from '@/utils/sql-snippets'
import { useSqlSnippets } from '@/composables/useSqlSnippets'
import DatabaseSqlSnippetsDialog from './DatabaseSqlSnippetsDialog.vue'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    databaseKind?: DatabaseKind
    disabled?: boolean
    suggestions?: readonly string[]
    /** 表名 → 字段映射，`别名.` 后按表补全字段 */
    tableColumns?: Readonly<Record<string, readonly string[]>>
    /** 执行失败语句在编辑器文本中的范围，行号槽标红 */
    errorRange?: { start: number; end: number } | null
  }>(),
  {
    databaseKind: 'mysql',
    disabled: false,
    suggestions: () => [],
    tableColumns: () => ({}),
    errorRange: null,
  }
)

const emit = defineEmits<{
  run: [sql: string]
  save: []
  askAgent: [content: string, intent: 'explain' | 'optimize']
  /** 请求分析某条语句的执行计划 */
  explain: [sql: string]
}>()

const sql = defineModel<string>({ required: true })
/** 执行/格式化快捷键来自设置 → 快捷键 → 数据库，可自定义。 */
const shortcuts = useSettingsStore().values
const editorRef = useTemplateRef<HTMLTextAreaElement>('editor')
const gutterRef = useTemplateRef<HTMLElement>('gutter')
const autocompleteRef = useTemplateRef<HTMLElement>('autocomplete')
const scroll = reactive({ top: 0, left: 0 })
const autocompleteOpen = shallowRef(false)
const autocompleteForced = shallowRef(false)
const activeSuggestion = shallowRef(0)
const replaceStart = shallowRef(0)
const currentPrefix = shallowRef('')
const replaceEnd = shallowRef(0)
const filteredSuggestions = shallowRef<SqlSuggestion[]>([])
const snippetsDialogOpen = shallowRef(false)
const { customSnippets } = useSqlSnippets()

/** 进行中的片段占位跳转；只驱动按键逻辑，不参与渲染。stops 按文本位置排序。 */
interface SnippetSession {
  stops: SnippetStop[]
  order: number[]
  position: number
  /** 上次同步时的文本长度；与当前不符说明内容被外部改动，跳转作废 */
  length: number
}
let snippetSession: SnippetSession | null = null
// 跳转时替换镜像占位触发的 input 事件不算用户输入。
let applyingSnippet = false
// 响应式状态
const state = reactive({
  // 补全浮层使用窗口坐标，避免编辑器和分屏容器裁剪阴影。
  autocompleteStyle: {} as CSSProperties,
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
const { contextMenu, autocompleteStyle } = toRefs(state)
const contextItems = computed<ContextMenuItem[]>(() => [
  {
    id: 'ai-explain',
    label: t('让 AI 解释选中 SQL'),
    icon: 'lucide:sparkles',
    disabled: props.disabled || !state.contextMenu.selected.trim(),
  },
  {
    id: 'ai-optimize',
    label: t('让 AI 优化选中 SQL'),
    icon: 'lucide:wand-sparkles',
    disabled: props.disabled || !state.contextMenu.selected.trim(),
  },
  {
    id: 'run-selection',
    separatorBefore: true,
    label: t('运行选中的 SQL'),
    icon: 'lucide:play',
    shortcut: formatShortcut(shortcuts.shortcutDbExecute),
    disabled: props.disabled || !state.contextMenu.selected.trim(),
  },
  {
    id: 'run-current',
    label: t('运行当前语句'),
    icon: 'lucide:text-cursor-input',
    shortcut: formatShortcut(shortcuts.shortcutDbExecuteCurrent),
    disabled: props.disabled || !sql.value.trim(),
  },
  {
    id: 'run-all',
    label: t('运行全部 SQL'),
    icon: 'lucide:list-start',
    disabled: props.disabled || !sql.value.trim(),
  },
  {
    id: 'explain',
    label: t('查看执行计划'),
    icon: 'lucide:network',
    shortcut: 'Ctrl+E',
    disabled: props.disabled || !sql.value.trim(),
  },
  {
    id: 'format',
    label: t('格式化 SQL'),
    icon: 'lucide:align-left',
    shortcut: formatShortcut(shortcuts.shortcutDbFormat),
    disabled: props.disabled || !sql.value.trim(),
  },
  {
    id: 'snippets',
    label: t('SQL 片段…'),
    icon: 'lucide:square-code',
    separatorBefore: true,
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
  if (id === 'ai-explain' || id === 'ai-optimize') {
    if (!props.disabled && selection.selected.trim())
      emit(
        'askAgent',
        selection.selected,
        id === 'ai-optimize' ? 'optimize' : 'explain'
      )
    return
  }
  if (id === 'run-current' || id === 'explain') {
    if (props.disabled) return
    const statement =
      selection.selected.trim() || statementAtCursor(sql.value, selection.start)
    if (!statement) return
    if (id === 'explain') emit('explain', statement)
    else emit('run', statement)
    return
  }
  if (id === 'format') {
    await formatEditor()
    return
  }
  if (id === 'snippets') {
    snippetsDialogOpen.value = true
    return
  }
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

// 以上次结果为基础增量解析，按键时只重解析变更附近；仍是同步计算，高亮不会落后于文字。
const parsedSql = computed<SqlDocument>(previous =>
  parseSql(sql.value, props.databaseKind, previous)
)
const tokens = computed(() => parsedSql.value.tokens)
// 只数换行符得到行数，避免每次按键 split 出整份行数组。
const lineCount = computed(() => {
  const text = sql.value
  let count = 1
  let index = -1
  while ((index = text.indexOf('\n', index + 1)) !== -1) count++
  return count
})

function lineAt(index: number): number {
  let line = 1
  let cursor = -1
  while (
    (cursor = sql.value.indexOf('\n', cursor + 1)) !== -1 &&
    cursor < index
  )
    line++
  return line
}
// 出错语句覆盖的行号区间；编辑后范围越界时自动失效。
const errorLines = computed(() => {
  const range = props.errorRange
  if (!range || range.start > sql.value.length) return null
  return {
    from: lineAt(range.start),
    to: lineAt(Math.max(range.start, range.end - 1)),
  }
})

/** 选中并滚动到指定范围，供错误面板“定位”使用。 */
function revealRange(start: number, end: number): void {
  const editor = editorRef.value
  if (!editor) return
  editor.focus()
  editor.setSelectionRange(start, end)
  editor.scrollTop = Math.max(0, (lineAt(start) - 3) * 19.8)
  syncScroll()
}

/** 将补全菜单定位到光标附近，并按实际缩放和窗口边缘调整浮层位置。 */
function positionAutocomplete(): void {
  const editor = editorRef.value
  const menu = autocompleteRef.value
  if (!autocompleteOpen.value || !editor || !menu) return
  const rect = editor.getBoundingClientRect()
  const bounds = menu.getBoundingClientRect()
  const scale = bounds.width / menu.offsetWidth || 1
  const style = getComputedStyle(editor)
  const lineHeight = Number.parseFloat(style.lineHeight) || 19.8
  const before = sql.value.slice(
    0,
    replaceStart.value + currentPrefix.value.length
  )
  const lines = before.split('\n')
  const row = lines.length - 1
  const column = lines.at(-1)?.length ?? 0
  const left = rect.left + (column * 7.25 + 12 - editor.scrollLeft) * scale
  const lineTop = rect.top + (row * lineHeight + 8 - editor.scrollTop) * scale
  const below = lineTop + (lineHeight + 4) * scale
  const padding = 8 * scale
  const top =
    below + bounds.height + padding <= window.innerHeight
      ? below
      : lineTop - bounds.height - 4 * scale
  state.autocompleteStyle = {
    left: `${Math.max(padding, Math.min(left, window.innerWidth - bounds.width - padding)) / scale}px`,
    top: `${Math.max(padding, Math.min(top, window.innerHeight - bounds.height - padding)) / scale}px`,
    maxWidth: `${Math.max(0, window.innerWidth / scale - 16)}px`,
    maxHeight: `${Math.min(160, Math.max(0, window.innerHeight / scale - 16))}px`,
  }
}

// 等待菜单渲染后测量；候选内容、滚动或分屏尺寸变化时同步浮层位置。
watch(
  [autocompleteOpen, replaceStart, currentPrefix, filteredSuggestions],
  positionAutocomplete,
  { flush: 'post' }
)
useResizeObserver([editorRef, autocompleteRef], positionAutocomplete)
useEventListener('resize', positionAutocomplete)
useEventListener('scroll', positionAutocomplete, { capture: true })

function runnableSql(): string {
  const editor = editorRef.value
  if (!editor) return sql.value.trim()
  const selected = sql.value
    .slice(editor.selectionStart, editor.selectionEnd)
    .trim()
  return selected || sql.value.trim()
}

/** 选区优先，否则取光标所在语句；供“运行当前语句”和“执行计划”使用。 */
function currentStatement(): string {
  const editor = editorRef.value
  if (!editor) return ''
  const selected = sql.value
    .slice(editor.selectionStart, editor.selectionEnd)
    .trim()
  return selected || statementAtCursor(sql.value, editor.selectionStart)
}

/** 格式化整段 SQL；有选区时只格式化选区。走 setRangeText 以保留撤销栈。 */
async function formatEditor(): Promise<void> {
  const editor = editorRef.value
  if (!editor || props.disabled) return
  const hasSelection = editor.selectionStart !== editor.selectionEnd
  const start = hasSelection ? editor.selectionStart : 0
  const end = hasSelection ? editor.selectionEnd : sql.value.length
  const source = sql.value
  try {
    const formatted = await formatSql(
      source.slice(start, end),
      props.databaseKind
    )
    // 格式化器异步加载期间内容已变化或被禁用时放弃，避免覆盖新输入
    if (sql.value !== source || props.disabled) return
    editor.focus()
    editor.setSelectionRange(start, end)
    document.execCommand('insertText', false, formatted)
    sql.value = editor.value
  } catch {
    toast.warning(t('这段 SQL 无法格式化，请检查语法'))
  }
}

/**
 * 把匹配触发词的片段并入补全候选。触发词完全匹配时排最前（输入 sel 再按 Tab 即展开），
 * 只是前缀匹配时排在关键字和字段之后，不抢 SELECT 这类常用词的首位。
 * 引号标识符内和 `别名.` 之后要的是对象名，不提示片段。
 */
function withSnippets(
  options: SqlSuggestion[],
  prefix: string,
  quote: string,
  from: number
): SqlSuggestion[] {
  if (quote || sql.value[from - 1] === '.') return options
  const lower = prefix.toLowerCase()
  const exact: SqlSuggestion[] = []
  const partial: SqlSuggestion[] = []
  for (const item of matchSnippets(
    snippetsFor(props.databaseKind, customSnippets.value),
    prefix
  ))
    (item.prefix.toLowerCase() === lower ? exact : partial).push({
      label: item.prefix,
      text: item.prefix,
      kind: 'snippet',
      detail: item.builtin ? t(item.label) : item.label,
      body: item.body,
    })
  return [...exact, ...options, ...partial]
}

/** 输入或手动请求时更新补全；选区、禁用状态和空白行由规则统一过滤。 */
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
    forced,
    props.tableColumns
  )
  if (!completion) {
    autocompleteOpen.value = false
    return
  }
  currentPrefix.value = completion.prefix
  replaceStart.value = completion.from
  replaceEnd.value = completion.to
  filteredSuggestions.value = withSnippets(
    completion.options,
    completion.prefix,
    completion.quote,
    completion.from
  )
  autocompleteForced.value = forced
  activeSuggestion.value = 0
  autocompleteOpen.value = filteredSuggestions.value.length > 0
}

// 只刷新已经打开的候选列表，避免迟到的元数据在换行或关闭菜单后重新弹窗。
watch(
  [
    () => props.suggestions,
    () => props.tableColumns,
    () => props.databaseKind,
    () => props.disabled,
  ],
  () => {
    if (autocompleteOpen.value && editorRef.value === document.activeElement)
      updateAutocomplete(autocompleteForced.value)
  }
)

/** 替换编辑器一段文本并保留撤销栈（同 formatEditor）；不产生片段输入跟踪。 */
function replaceEditorRange(from: number, to: number, text: string): void {
  const editor = editorRef.value
  if (!editor) return
  applyingSnippet = true
  editor.focus()
  editor.setSelectionRange(from, to)
  const done = text
    ? document.execCommand('insertText', false, text)
    : from === to || document.execCommand('delete')
  if (!done) editor.setRangeText(text, from, to, 'end')
  sql.value = editor.value
  applyingSnippet = false
}

/** 展开片段替换 from..to 并选中第一个占位；多行正文跟随当前行缩进。无占位时光标停在末尾。 */
function applySnippet(body: string, from: number, to: number): void {
  const editor = editorRef.value
  if (!editor || props.disabled) return
  const lineStart = sql.value.lastIndexOf('\n', from - 1) + 1
  const indent = sql.value.slice(lineStart, from).match(/^[ \t]*/u)?.[0] ?? ''
  const { text, stops } = expandSnippet(body, indent)
  replaceEditorRange(from, to, text)
  autocompleteOpen.value = false
  const absolute = stops.map(stop => ({
    index: stop.index,
    from: stop.from + from,
    to: stop.to + from,
  }))
  if (!absolute.some(stop => stop.index === 0))
    absolute.push({
      index: 0,
      from: from + text.length,
      to: from + text.length,
    })
  snippetSession = {
    stops: absolute,
    order: snippetOrder(absolute),
    position: 0,
    length: editor.value.length,
  }
  selectSnippetStop()
}

/** 当前占位的第一处出现，用户在这里编辑，其余同号占位离开时同步。 */
function primarySnippetStop(session: SnippetSession): SnippetStop {
  const index = session.order[session.position]
  return session.stops.find(stop => stop.index === index)!
}

/** 选中当前占位并滚动到可见；到达 $0 即结束跳转。 */
function selectSnippetStop(): void {
  const session = snippetSession
  if (!session) return
  const stop = primarySnippetStop(session)
  revealRange(stop.from, stop.to)
  if (stop.index === 0) snippetSession = null
}

/** 用户在占位内输入后更新各占位位置；光标离开当前占位或内容被整体替换则结束跳转。 */
function trackSnippetEdit(): void {
  const editor = editorRef.value
  const session = snippetSession
  if (!editor || !session || applyingSnippet) return
  const delta = editor.value.length - session.length
  session.length = editor.value.length
  const primary = primarySnippetStop(session)
  const end = primary.to + delta
  const cursor = editor.selectionStart
  if (end < primary.from || cursor < primary.from || cursor > end) {
    snippetSession = null
    return
  }
  primary.to = end
  for (const stop of session.stops.slice(session.stops.indexOf(primary) + 1)) {
    stop.from += delta
    stop.to += delta
  }
}

/**
 * Tab / Shift+Tab 在占位间跳转：离开前把当前内容同步到同号占位。
 * 返回 false 表示跳转已失效（文本被外部改动或光标已移出），调用方按普通 Tab 处理。
 */
function moveSnippetStop(step: 1 | -1): boolean {
  const editor = editorRef.value
  const session = snippetSession
  if (!editor || !session) return false
  const primary = primarySnippetStop(session)
  if (
    editor.value.length !== session.length ||
    editor.selectionStart < primary.from ||
    editor.selectionEnd > primary.to
  ) {
    snippetSession = null
    return false
  }
  const text = editor.value.slice(primary.from, primary.to)
  const stops = session.stops
  // 从后往前替换，前面的偏移不受影响；后面的占位随长度差平移。
  for (let i = stops.length - 1; i >= 0; i--) {
    const mirror = stops[i]!
    if (mirror === primary || mirror.index !== primary.index) continue
    const delta = text.length - (mirror.to - mirror.from)
    replaceEditorRange(mirror.from, mirror.to, text)
    mirror.to += delta
    for (const later of stops.slice(i + 1)) {
      later.from += delta
      later.to += delta
    }
  }
  session.length = editor.value.length
  session.position = Math.max(0, session.position + step)
  selectSnippetStop()
  return true
}

/** 从片段管理面板插入：替换当前选区，随后关闭面板并进入占位跳转。 */
function insertSnippetFromDialog(snippet: SqlSnippet): void {
  const editor = editorRef.value
  snippetsDialogOpen.value = false
  if (editor)
    applySnippet(snippet.body, editor.selectionStart, editor.selectionEnd)
}

/** 确认补全候选：片段按占位展开，其余直接替换；在占位内补全时同步占位范围。 */
function insertSuggestion(value: SqlSuggestion): void {
  const editor = editorRef.value
  if (!editor) return
  if (value.body !== undefined) {
    applySnippet(value.body, replaceStart.value, replaceEnd.value)
    return
  }
  editor.setRangeText(value.text, replaceStart.value, replaceEnd.value, 'end')
  sql.value = editor.value
  trackSnippetEdit()
  autocompleteOpen.value = false
  void nextTick(() => editor.focus())
}

/** 保留运行、保存和补全快捷键，并在候选列表内处理选择与滚动。 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    emit('save')
    return
  }

  if (matchesShortcut(event, shortcuts.shortcutDbFormat)) {
    event.preventDefault()
    void formatEditor()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
    event.preventDefault()
    const statement = currentStatement()
    if (statement && !props.disabled) emit('explain', statement)
    return
  }

  if (matchesShortcut(event, shortcuts.shortcutDbExecuteCurrent)) {
    event.preventDefault()
    autocompleteOpen.value = false
    const statement = currentStatement()
    if (statement && !props.disabled) emit('run', statement)
    return
  }

  if (matchesShortcut(event, shortcuts.shortcutDbExecute)) {
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
        autocompleteRef.value
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

  if (event.key === 'Escape') snippetSession = null

  if (event.key !== 'Tab') return

  event.preventDefault()
  if (moveSnippetStop(event.shiftKey ? -1 : 1)) return
  const editor = editorRef.value
  if (!editor) return
  const start = editor.selectionStart
  editor.setRangeText('  ', start, editor.selectionEnd, 'end')
  sql.value = editor.value
  void nextTick(() => editor.setSelectionRange(start + 2, start + 2))
}

/** 换行只关闭补全，普通输入继续匹配；输入法组合期间不干扰候选文字。 */
function handleInput(event: Event): void {
  const input = event as InputEvent
  if (input.isComposing || applyingSnippet) return
  trackSnippetEdit()
  if (
    input.inputType === 'insertLineBreak' ||
    input.inputType === 'insertParagraph'
  ) {
    autocompleteOpen.value = false
    autocompleteForced.value = false
    return
  }
  updateAutocomplete()
}

function syncScroll(): void {
  if (!editorRef.value) return
  scroll.top = editorRef.value.scrollTop
  scroll.left = editorRef.value.scrollLeft
  if (gutterRef.value) gutterRef.value.scrollTop = scroll.top
}

defineExpose({ runnableSql, revealRange })
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
        v-for="line in lineCount"
        :key="line"
        :class="
          cn(
            'h-[19.8px] pr-2.5',
            errorLines &&
              line >= errorLines.from &&
              line <= errorLines.to &&
              'bg-danger/15 text-danger'
          )
        "
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
        @compositionend="
          trackSnippetEdit();
          updateAutocomplete()
        "
      />
    </div>
    <Teleport
      v-if="autocompleteOpen && filteredSuggestions.length"
      to="body"
    >
      <div
        ref="autocomplete"
        class="border-line-strong bg-panel/96 shadow-pop scroll-thin fixed z-80 max-h-40 w-52 overflow-y-auto rounded-lg border p-1 font-mono backdrop-blur-xl"
        :style="autocompleteStyle"
        role="listbox"
      >
        <AppButton
          v-for="(suggestion, index) in filteredSuggestions"
          :key="`${suggestion.kind}:${suggestion.label}:${suggestion.detail ?? ''}`"
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
                : suggestion.kind === 'snippet'
                  ? 'lucide:square-code'
                  : 'lucide:braces'
            "
            :size="11"
            :class="
              suggestion.kind === 'keyword'
                ? 'text-violet'
                : suggestion.kind === 'snippet'
                  ? 'text-amber'
                  : 'text-blue'
            "
          />
          <span class="min-w-0 flex-1 truncate">{{ suggestion.label }}</span>
          <span class="text-txt-4 max-w-24 truncate text-[9px]">{{
            suggestion.detail ?? suggestion.kind.toUpperCase()
          }}</span>
        </AppButton>
      </div>
    </Teleport>
    <AppContextMenu
      :open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextItems"
      :label="t('SQL 编辑器')"
      @close="contextMenu.open = false"
      @select="handleContextAction"
    />
    <DatabaseSqlSnippetsDialog
      v-if="snippetsDialogOpen"
      :database-kind="databaseKind"
      :disabled="disabled"
      @close="snippetsDialogOpen = false"
      @insert="insertSnippetFromDialog"
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
