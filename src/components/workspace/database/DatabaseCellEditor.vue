<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue'
import { cn } from '@/utils/cn'
import DatabaseValueInput from '@/components/workspace/database/database-value-input.vue'

/**
 * 数据表格里正在编辑的那一个单元格。
 *
 * 表格平时只渲染文本，点击后才换成这个输入框：几千个单元格都挂 <input>
 * 既拖慢渲染，输入时每个键都会触发整表重绘。这里用本地草稿，
 * 只在 Enter / Tab / 失焦时把结果交回父组件；没改过就按取消处理，
 * 避免只是点开看看的 NULL 被提交成空字符串。
 */
const props = defineProps<{
  value: string | null
  dataType?: string
  /** 与网格密度一致的高度类，默认标准高度。 */
  heightClass?: string
}>()
const emit = defineEmits<{
  commit: [value: string]
  cancel: []
  /** Tab / Shift+Tab：提交后把编辑焦点移到相邻单元格。 */
  move: [delta: 1 | -1]
}>()

const initial = props.value ?? ''
const draft = shallowRef(initial)
let settled = false

/** 输入结束后只提交实际变化，打开后未修改的 NULL 保持不变。 */
function settle(kind: 'commit' | 'cancel'): void {
  if (settled) return
  settled = true
  if (kind === 'commit' && draft.value !== initial) emit('commit', draft.value)
  else emit('cancel')
}

/** 虚拟滚动把正在编辑的行移出窗口时组件会被卸载，此时按失焦处理保留草稿。 */
onBeforeUnmount(() => settle('commit'))

/** 保留表格的回车提交、Esc 取消及 Tab 跨单元格编辑行为。 */
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
</script>

<template>
  <DatabaseValueInput
    v-model="draft"
    :data-type="dataType"
    autofocus
    :class="
      cn(
        'border-violet/40 bg-card text-txt ring-violet/45 placeholder:text-txt-4 w-full border px-2.5 font-mono ring-1 outline-none ring-inset placeholder:italic',
        heightClass ?? 'h-7'
      )
    "
    :placeholder="value === null ? 'NULL' : ''"
    autocomplete="off"
    spellcheck="false"
    @keydown="handleKeydown"
    @blur="settle('commit')"
  />
</template>
