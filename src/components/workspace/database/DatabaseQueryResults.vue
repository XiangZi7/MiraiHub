<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { DatabaseExecution } from '@/types/database'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'

const props = defineProps<{
  execution: DatabaseExecution | null
  loading: boolean
  error: string
}>()

const activeTab = shallowRef<'results' | 'messages'>('results')
const activeStatement = shallowRef(0)
const result = computed(() => props.execution?.statements[activeStatement.value] ?? null)
const rowCountLabel = computed(() => {
  if (!result.value)
    return '0 rows'
  if (!result.value.columns.length)
    return `${result.value.rowsAffected} affected`
  return `${result.value.rows.length}${result.value.truncated ? '+' : ''} rows`
})

watch(() => props.execution, (execution) => {
  const failed = execution?.statements.findIndex(statement => Boolean(statement.error)) ?? -1
  activeStatement.value = failed >= 0 ? failed : 0
})

function statementLabel(statement: string, index: number): string {
  const keyword = statement.trim().split(/\s+/u)[0]?.toUpperCase()
  return `${index + 1} · ${keyword || 'SQL'}`
}

function csvCell(value: string | null): string {
  if (value === null)
    return ''
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function resultPayload(format: 'csv' | 'json'): string {
  if (!result.value)
    return ''
  if (format === 'csv') {
    return [
      result.value.columns.map(column => csvCell(column.name)).join(','),
      ...result.value.rows.map(row => row.map(csvCell).join(',')),
    ].join('\r\n')
  }
  return JSON.stringify(result.value.rows.map(row => Object.fromEntries(
    result.value?.columns.map((column, index) => [column.name, row[index] ?? null]) ?? [],
  )), null, 2)
}

function exportResult(format: 'csv' | 'json'): void {
  if (!result.value?.columns.length)
    return
  const payload = resultPayload(format)
  const blob = new Blob([format === 'csv' ? `\uFEFF${payload}` : payload], {
    type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `query-result-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyResult(): Promise<void> {
  await copyText(resultPayload('csv'))
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col border-t border-line">
    <div class="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line-soft px-2 scroll-none">
      <AppButton
        v-for="(statement, index) in execution?.statements ?? []"
        :key="`${statement.offset}:${index}`"
        variant="bare"
        :title="statement.statement"
        :class="cn(
          'shrink-0 rounded px-2 py-1 font-mono text-[10px] transition-colors',
          activeStatement === index ? 'bg-raised text-txt' : 'text-txt-4 hover:text-txt-2',
          statement.error && 'text-danger',
        )"
        @click="activeStatement = index"
      >
        {{ statementLabel(statement.statement, index) }}
      </AppButton>
      <span v-if="execution?.statements.length" class="mx-1 h-4 w-px shrink-0 bg-line-soft" />
      <div class="flex-1" />
      <AppButton
        v-for="tab in ([{ id: 'results', label: 'Results' }, { id: 'messages', label: 'Messages' }] as const)"
        :key="tab.id"
        variant="bare"
        :class="cn(
          'rounded px-2.5 py-1 text-[11px] transition-colors',
          activeTab === tab.id ? 'bg-raised text-txt' : 'text-txt-3 hover:text-txt-2',
        )"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </AppButton>
    </div>

    <div v-if="activeTab === 'messages'" class="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 scroll-thin">
      <p v-if="loading" class="text-txt-3">正在执行查询…</p>
      <p v-else-if="error" class="whitespace-pre-wrap text-danger">{{ error }}</p>
      <div v-else-if="execution" class="space-y-1.5">
        <p
          v-for="(statement, index) in execution.statements"
          :key="`${statement.offset}:${index}`"
          :class="statement.error ? 'text-danger' : 'text-txt-2'"
        >
          <span class="mr-2 text-txt-4">[{{ index + 1 }}]</span>{{ statement.message }}
          <span class="ml-2 text-txt-4">{{ statement.elapsedMs }} ms</span>
        </p>
        <p v-if="execution.cancelled" class="text-amber">执行已由用户取消。</p>
      </div>
      <p v-else class="text-txt-4">执行查询后将在这里显示消息。</p>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto scroll-thin">
      <div v-if="loading" class="grid h-full place-items-center text-xs text-txt-3">
        <span class="flex items-center gap-2">
          <AppIcon name="lucide:loader-circle" :size="14" class="animate-spin" />
          正在执行查询…
        </span>
      </div>
      <div v-else-if="error || result?.error" class="p-3 text-xs leading-5 text-danger">
        {{ error || result?.error }}
      </div>
      <div v-else-if="!result" class="grid h-full place-items-center text-xs text-txt-4">
        按 Ctrl+Enter 或点击执行按钮运行 SQL
      </div>
      <div v-else-if="!result.columns.length" class="grid h-full place-items-center text-xs text-txt-3">
        {{ result.message }}
      </div>
      <table v-else class="w-full border-collapse text-left font-mono text-[11.5px]">
        <thead class="sticky top-0 z-10 bg-panel">
          <tr class="text-txt-3">
            <th class="w-10 border-r border-b border-line-soft px-2 py-1.5 text-right font-medium">#</th>
            <th
              v-for="(column, index) in result.columns"
              :key="`${column.name}:${index}`"
              class="min-w-28 border-r border-b border-line-soft px-3 py-1.5 font-medium last:border-r-0"
              :title="column.dataType"
            >
              <span>{{ column.name }}</span>
              <span class="ml-1.5 text-[9px] font-normal text-txt-4">{{ column.dataType }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in result.rows" :key="rowIndex" class="text-txt-2 hover:bg-hover">
            <td class="border-r border-b border-line-soft px-2 py-1.5 text-right text-txt-4">{{ rowIndex + 1 }}</td>
            <td
              v-for="(value, columnIndex) in row"
              :key="columnIndex"
              class="max-w-96 border-r border-b border-line-soft px-3 py-1.5 last:border-r-0"
              :title="value ?? 'NULL'"
            >
              <span v-if="value === null" class="italic text-txt-4">NULL</span>
              <span v-else class="block truncate">{{ value }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="flex h-7 shrink-0 items-center border-t border-line-soft px-3 text-[10.5px] text-txt-3">
      <span>{{ rowCountLabel }}</span>
      <span v-if="result?.truncated" class="ml-2 text-amber">结果已截断</span>
      <span v-if="execution && execution.statements.length > 1" class="ml-2 text-txt-4">
        共 {{ execution.statements.length }} 条语句
      </span>
      <div class="flex-1" />
      <div v-if="result?.columns.length" class="mr-2 flex items-center gap-0.5">
        <IconButton icon="lucide:copy" :size="11" title="复制为 CSV" @click="copyResult" />
        <IconButton icon="lucide:file-down" :size="11" title="导出 CSV" @click="exportResult('csv')" />
        <IconButton icon="lucide:braces" :size="11" title="导出 JSON" @click="exportResult('json')" />
      </div>
      <span v-if="execution" class="flex items-center gap-1">
        <AppIcon name="lucide:timer" :size="11" />
        <span>{{ execution.elapsedMs }} ms</span>
      </span>
    </footer>
  </div>
</template>
