<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { DatabaseQueryResult } from '@/types/database'
import { cn } from '@/utils/cn'

const props = defineProps<{
  result: DatabaseQueryResult | null
  loading: boolean
  error: string
}>()

const activeTab = shallowRef<'results' | 'messages'>('results')
const rowCountLabel = computed(() => {
  if (!props.result)
    return '0 rows'
  if (!props.result.columns.length)
    return `${props.result.rowsAffected} affected`
  return `${props.result.rows.length}${props.result.truncated ? '+' : ''} rows`
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col border-t border-line">
    <div class="flex h-8 shrink-0 items-center gap-0.5 border-b border-line-soft px-2">
      <button
        v-for="tab in ([{ id: 'results', label: 'Results' }, { id: 'messages', label: 'Messages' }] as const)"
        :key="tab.id"
        type="button"
        :class="cn(
          'rounded px-2.5 py-1 text-[11px] transition-colors',
          activeTab === tab.id ? 'bg-raised text-txt' : 'text-txt-3 hover:text-txt-2',
        )"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="activeTab === 'messages'" class="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 scroll-thin">
      <p v-if="loading" class="text-txt-3">正在执行查询…</p>
      <p v-else-if="error" class="whitespace-pre-wrap text-danger">{{ error }}</p>
      <p v-else-if="result" class="text-txt-2">{{ result.message }}</p>
      <p v-else class="text-txt-4">执行查询后将在这里显示消息。</p>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto scroll-thin">
      <div v-if="loading" class="grid h-full place-items-center text-xs text-txt-3">
        <span class="flex items-center gap-2">
          <AppIcon name="lucide:loader-circle" :size="14" class="animate-spin" />
          正在执行查询…
        </span>
      </div>
      <div v-else-if="error" class="p-3 text-xs leading-5 text-danger">
        {{ error }}
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
      <div class="flex-1" />
      <span v-if="result" class="flex items-center gap-1">
        <AppIcon name="lucide:timer" :size="11" />
        <span>{{ result.elapsedMs }} ms</span>
      </span>
    </footer>
  </div>
</template>
