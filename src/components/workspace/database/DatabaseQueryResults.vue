<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, shallowRef, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppColumnResizeHandle from '@/components/ui/AppColumnResizeHandle.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import {
  columnsScope,
  useDatabaseColumnWidths,
} from '@/composables/useDatabaseColumnWidths'
import type { DatabaseExecution } from '@/types/database'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'

const { t } = useI18n()

const props = defineProps<{
  execution: DatabaseExecution | null
  loading: boolean
  error: string
}>()

const activeTab = shallowRef<'results' | 'messages'>('results')
const activeStatement = shallowRef(0)
const page = shallowRef(0)
const pageSize = 200
const result = computed(
  () => props.execution?.statements[activeStatement.value] ?? null
)
const pageCount = computed(() =>
  Math.max(1, Math.ceil((result.value?.rows.length ?? 0) / pageSize))
)
const visibleRows = computed(
  () =>
    result.value?.rows.slice(
      page.value * pageSize,
      (page.value + 1) * pageSize
    ) ?? []
)
watch(result, () => {
  page.value = 0
})
const rowCountLabel = computed(() => {
  if (!result.value) return '0 rows'
  if (!result.value.columns.length)
    return `${result.value.rowsAffected} affected`
  return `${result.value.rows.length}${result.value.truncated ? '+' : ''} rows`
})

// 形状相同的结果集（同一批列名）共用一套列宽，重跑查询后仍然保留。
const columnScope = computed(() =>
  columnsScope(
    'query',
    (result.value?.columns ?? []).map(column => column.name)
  )
)
const { resized, widthOf, beginResize, autoFit, keyboardResize, resetWidths } =
  useDatabaseColumnWidths(columnScope)

watch(
  () => props.execution,
  execution => {
    const failed =
      execution?.statements.findIndex(statement => Boolean(statement.error)) ??
      -1
    activeStatement.value = failed >= 0 ? failed : 0
  }
)

function statementLabel(statement: string, index: number): string {
  const keyword = statement.trim().split(/\s+/u)[0]?.toUpperCase()
  return `${index + 1} · ${keyword || 'SQL'}`
}

function csvCell(value: string | null): string {
  if (value === null) return ''
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function resultPayload(format: 'csv' | 'json'): string {
  if (!result.value) return ''
  if (format === 'csv') {
    return [
      result.value.columns.map(column => csvCell(column.name)).join(','),
      ...result.value.rows.map(row => row.map(csvCell).join(',')),
    ].join('\r\n')
  }
  return JSON.stringify(
    result.value.rows.map(row =>
      Object.fromEntries(
        result.value?.columns.map((column, index) => [
          column.name,
          row[index] ?? null,
        ]) ?? []
      )
    ),
    null,
    2
  )
}

function exportResult(format: 'csv' | 'json'): void {
  if (!result.value?.columns.length) return
  const payload = resultPayload(format)
  const blob = new Blob([format === 'csv' ? `\uFEFF${payload}` : payload], {
    type:
      format === 'csv'
        ? 'text/csv;charset=utf-8'
        : 'application/json;charset=utf-8',
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
  <div
    class="border-line flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t"
  >
    <div
      class="border-line-soft scroll-none flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2"
    >
      <AppButton
        v-for="(statement, index) in execution?.statements ?? []"
        :key="`${statement.offset}:${index}`"
        variant="bare"
        :title="statement.statement"
        :class="
          cn(
            'shrink-0 rounded px-2 py-1 font-mono text-[10px] transition-colors',
            activeStatement === index
              ? 'bg-raised text-txt'
              : 'text-txt-4 hover:text-txt-2',
            statement.error && 'text-danger'
          )
        "
        @click="activeStatement = index"
      >
        {{ statementLabel(statement.statement, index) }}
      </AppButton>
      <span
        v-if="execution?.statements.length"
        class="bg-line-soft mx-1 h-4 w-px shrink-0"
      />
      <div class="flex-1" />
      <AppButton
        v-for="tab in [
          { id: 'results', label: 'Results' },
          { id: 'messages', label: 'Messages' },
        ] as const"
        :key="tab.id"
        variant="bare"
        :class="
          cn(
            'rounded px-2.5 py-1 text-[11px] transition-colors',
            activeTab === tab.id
              ? 'bg-raised text-txt'
              : 'text-txt-3 hover:text-txt-2'
          )
        "
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </AppButton>
    </div>

    <div
      v-if="activeTab === 'messages'"
      class="scroll-thin min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5"
    >
      <p
        v-if="loading"
        class="text-txt-3"
      >
        {{ t('正在执行查询…') }}
      </p>
      <p
        v-else-if="error"
        class="text-danger whitespace-pre-wrap"
      >
        {{ error }}
      </p>
      <div
        v-else-if="execution"
        class="space-y-1.5"
      >
        <p
          v-for="(statement, index) in execution.statements"
          :key="`${statement.offset}:${index}`"
          :class="statement.error ? 'text-danger' : 'text-txt-2'"
        >
          <span class="text-txt-4 mr-2">[{{ index + 1 }}]</span
          >{{ statement.message }}
          <span class="text-txt-4 ml-2">{{ statement.elapsedMs }} ms</span>
        </p>
        <p
          v-if="execution.cancelled"
          class="text-amber"
        >
          {{ t('执行已由用户取消。') }}
        </p>
      </div>
      <p
        v-else
        class="text-txt-4"
      >
        {{ t('执行查询后将在这里显示消息。') }}
      </p>
    </div>

    <div
      v-else
      class="query-result-scroll scroll-thin min-h-0 min-w-0 flex-1 overflow-auto"
    >
      <div
        v-if="loading"
        class="text-txt-3 grid h-full place-items-center text-xs"
      >
        <span class="flex items-center gap-2">
          <AppIcon
            name="lucide:loader-circle"
            :size="14"
            class="animate-spin"
          />
          {{ t('正在执行查询…') }}
        </span>
      </div>
      <div
        v-else-if="error || result?.error"
        class="text-danger p-3 text-xs leading-5"
      >
        {{ error || result?.error }}
      </div>
      <div
        v-else-if="!result"
        class="text-txt-4 grid h-full place-items-center text-xs"
      >
        {{ t('按 Ctrl+Enter 或点击执行按钮运行 SQL') }}
      </div>
      <div
        v-else-if="!result.columns.length"
        class="text-txt-3 grid h-full place-items-center text-xs"
      >
        {{ result.message }}
      </div>
      <table
        v-else
        :style="{
          width: `${40 + result.columns.reduce((width, column) => width + (resized ? widthOf(column.name) : 160), 0)}px`,
          minWidth: '100%',
        }"
        :class="
          cn('table-fixed border-collapse text-left font-mono text-[11.5px]')
        "
      >
        <colgroup>
          <col style="width: 40px" />
          <col
            v-for="(column, index) in result.columns"
            :key="`${column.name}:${index}`"
            :style="{ width: `${resized ? widthOf(column.name) : 160}px` }"
          />
        </colgroup>
        <thead class="database-glass-header database-glass-header--sticky">
          <tr class="text-txt-3">
            <th
              class="border-line-soft w-10 border-r border-b px-2 py-1.5 text-right font-medium"
            >
              #
            </th>
            <th
              v-for="(column, index) in result.columns"
              :key="`${column.name}:${index}`"
              :data-column="column.name"
              :class="
                cn(
                  'border-line-soft border-r border-b px-3 py-1.5 font-medium last:border-r-0',
                  !resized && 'min-w-28'
                )
              "
              :title="column.dataType"
            >
              <span class="block truncate">
                <span>{{ column.name }}</span>
                <span class="text-txt-4 ml-1.5 text-[9px] font-normal">{{
                  column.dataType
                }}</span>
              </span>
              <AppColumnResizeHandle
                :label="t('调整“{value0}”列宽', { value0: column.name })"
                @pointerdown="beginResize(column.name, $event)"
                @dblclick="autoFit(column.name, $event)"
                @keydown="keyboardResize(column.name, $event)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, rowIndex) in visibleRows"
            :key="rowIndex"
            class="text-txt-2 hover:bg-hover"
          >
            <td
              class="border-line-soft text-txt-4 border-r border-b px-2 py-1.5 text-right"
            >
              {{ page * pageSize + rowIndex + 1 }}
            </td>
            <td
              v-for="(value, columnIndex) in row"
              :key="columnIndex"
              :class="
                cn(
                  'border-line-soft overflow-hidden border-r border-b px-3 py-1.5 last:border-r-0',
                  !resized && 'max-w-96'
                )
              "
              :title="value ?? 'NULL'"
            >
              <span
                v-if="value === null"
                class="text-txt-4 italic"
                >NULL</span
              >
              <span
                v-else
                class="block truncate"
                >{{ value }}</span
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer
      class="border-line-soft text-txt-3 flex min-h-8 shrink-0 flex-wrap items-center gap-y-1 border-t px-3 py-1 text-[10.5px]"
    >
      <span>{{ rowCountLabel }}</span>
      <span
        v-if="result?.columns.length"
        class="text-txt-4 ml-2"
        :title="t('左右滚动可查看全部字段')"
        >{{ t('{count} 个字段', { count: result.columns.length }) }} ·
        {{ t('左右滚动可查看全部字段') }}</span
      >
      <span
        v-if="result?.truncated"
        class="text-amber ml-2"
      >
        {{ t('已达行数上限，调高上限后重新执行') }}
      </span>
      <span
        v-if="execution && execution.statements.length > 1"
        class="text-txt-4 ml-2"
      >
        {{ t('database.statements', { count: execution.statements.length }) }}
      </span>
      <div class="flex-1" />
      <div
        v-if="pageCount > 1"
        class="mx-2 flex items-center gap-1"
      >
        <IconButton
          icon="lucide:chevron-left"
          :size="11"
          :disabled="page === 0"
          :title="t('上一页')"
          @click="page -= 1"
        />
        <span>{{ page + 1 }} / {{ pageCount }}</span>
        <IconButton
          icon="lucide:chevron-right"
          :size="11"
          :disabled="page + 1 >= pageCount"
          :title="t('下一页')"
          @click="page += 1"
        />
      </div>
      <div
        v-if="result?.columns.length"
        class="mr-2 flex items-center gap-0.5"
      >
        <IconButton
          v-if="resized"
          icon="lucide:unfold-horizontal"
          :size="11"
          :title="t('恢复自动列宽')"
          @click="resetWidths"
        />
        <IconButton
          icon="lucide:copy"
          :size="11"
          :title="t('复制为 CSV')"
          @click="copyResult"
        />
        <IconButton
          icon="lucide:file-down"
          :size="11"
          :title="t('导出 CSV')"
          @click="exportResult('csv')"
        />
        <IconButton
          icon="lucide:braces"
          :size="11"
          :title="t('导出 JSON')"
          @click="exportResult('json')"
        />
      </div>
      <span
        v-if="execution"
        class="flex items-center gap-1"
      >
        <AppIcon
          name="lucide:timer"
          :size="11"
        />
        <span>{{ execution.elapsedMs }} ms</span>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.query-result-scroll {
  scrollbar-width: auto;
}
.query-result-scroll::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
</style>
