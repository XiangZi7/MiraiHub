<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import type {
  DatabaseExecution,
  DatabaseKind,
  DatabaseStatementResult,
} from '@/types/database'
import SqlEditor from './SqlEditor.vue'
import DatabaseQueryResizeHandle from './DatabaseQueryResizeHandle.vue'
import DatabaseQueryResults from './DatabaseQueryResults.vue'
import type { PlanNode } from '@/utils/explain-plan'
import {
  byteOffsetToIndex,
  type QueryResultEntry,
} from '@/utils/query-result-history'

const props = defineProps<{
  databaseKind: DatabaseKind
  databaseName: string
  execution: DatabaseExecution | null
  loading: boolean
  error: string
  suggestions: string[]
  tableColumns?: Record<string, string[]>
  plan?: PlanNode | null
  planLoading?: boolean
  planSql?: string
  history?: readonly QueryResultEntry[]
  /** 最近一次执行的 SQL，用于把失败语句换算回编辑器位置 */
  executedSql?: string
  /** 快捷键切换：隐藏结果面板，让编辑器占满。 */
  resultsHidden?: boolean
}>()
const sql = defineModel<string>({ required: true })
const ratio = defineModel<number>('ratio', { required: true })
const emit = defineEmits<{
  run: [sql?: string]
  save: []
  askAgent: [content: string, intent: 'explain' | 'optimize' | 'fix']
  explain: [sql: string]
  cancel: []
  retry: []
  togglePin: [id: string]
  closeResult: [id: string]
}>()
const editor = useTemplateRef<InstanceType<typeof SqlEditor>>('editor')
const style = computed(() => {
  if (props.resultsHidden) return { gridTemplateRows: '1fr 0 0' }
  const value = Math.min(
    85,
    Math.max(15, Number.isFinite(ratio.value) ? ratio.value : 58)
  )
  // 分隔条拖拽中直接改写这两个变量，松手后再由 ratio 接管。
  return {
    '--query-split-top': `${value}fr`,
    '--query-split-bottom': `${100 - value}fr`,
    gridTemplateRows:
      'var(--query-split-top) 10px var(--query-split-bottom)',
  }
})

/** 把失败语句换算成编辑器里的字符范围；运行的是选区时按文本匹配。 */
function statementRange(
  statement: DatabaseStatementResult
): { start: number; end: number } | null {
  const text = statement.statement.trim()
  if (!text) return null
  const executed = props.executedSql ?? ''
  const base = executed ? sql.value.indexOf(executed) : -1
  if (base >= 0) {
    const start = base + byteOffsetToIndex(executed, statement.offset)
    if (sql.value.startsWith(text, start))
      return { start, end: start + text.length }
  }
  const start = sql.value.indexOf(text)
  return start >= 0 ? { start, end: start + text.length } : null
}

const errorRange = computed(() => {
  const failed = props.execution?.statements.find(item => item.error)
  return failed ? statementRange(failed) : null
})

function locate(statement: DatabaseStatementResult): void {
  const range = statementRange(statement)
  if (range) editor.value?.revealRange(range.start, range.end)
}

defineExpose({ runnableSql: () => editor.value?.runnableSql() ?? sql.value })
</script>

<template>
  <div
    class="grid min-h-0 min-w-0 flex-1 overflow-hidden"
    :style="style"
  >
    <SqlEditor
      ref="editor"
      v-model="sql"
      :database-kind="props.databaseKind"
      :disabled="loading"
      :suggestions="suggestions"
      :table-columns="tableColumns"
      :error-range="loading ? null : errorRange"
      @explain="emit('explain', $event)"
      @run="emit('run', $event)"
      @save="emit('save')"
      @ask-agent="(content, intent) => emit('askAgent', content, intent)"
    />
    <DatabaseQueryResizeHandle
      v-show="!resultsHidden"
      v-model="ratio"
    />
    <DatabaseQueryResults
      v-show="!resultsHidden"
      :execution="execution"
      :loading="loading"
      :error="error"
      :database-kind="databaseKind"
      :database-name="databaseName"
      :plan="plan"
      :plan-loading="planLoading"
      :plan-sql="planSql"
      :history="history"
      @fix-error="emit('askAgent', $event, 'fix')"
      @cancel="emit('cancel')"
      @retry="emit('retry')"
      @locate="locate"
      @toggle-pin="emit('togglePin', $event)"
      @close-result="emit('closeResult', $event)"
    />
  </div>
</template>
