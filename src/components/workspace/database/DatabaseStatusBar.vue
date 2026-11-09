<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import type { DatabaseSelectionStats } from '@/composables/useDatabaseStatusBar'
import type { DatabaseSession } from '@/types/database'
import { cn } from '@/utils/cn'

/**
 * 数据库视图底部信息：当前库、服务器版本、只读状态、运行中查询数与网格选区统计。
 */
defineProps<{
  session: DatabaseSession | null
  /** 当前标签所在库；为空时回退到会话默认库 */
  database?: string
  runningQueries: number
  selection?: DatabaseSelectionStats | null
  /** 嵌入表格分页栏时省去独立底栏的边框和留白。 */
  embedded?: boolean
}>()

const { t } = useI18n()

/** 格式化选区合计和平均值，限制小数位以免挤占状态栏。 */
function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
</script>

<template>
  <div
    :class="
      cn(
        'text-txt-3 flex min-w-0 items-center gap-3 overflow-hidden text-[10.5px] whitespace-nowrap select-none',
        embedded
          ? 'ml-auto justify-end'
          : 'border-line-soft bg-panel h-6 shrink-0 border-t px-2.5'
      )
    "
    role="status"
    :aria-label="t('数据库状态栏')"
  >
    <span
      v-if="session?.readOnly"
      class="bg-txt-4/12 text-txt-3 flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[10px] leading-4"
    >
      <AppIcon
        name="lucide:lock"
        :size="9"
      />
      {{ t('只读') }}
    </span>

    <span
      v-if="database || session?.database"
      class="flex min-w-0 items-center gap-1"
      :title="t('当前数据库')"
    >
      <AppIcon
        name="lucide:layers-3"
        :size="11"
        class="text-txt-4 shrink-0"
      />
      <span class="max-w-36 truncate">{{ database || session?.database }}</span>
    </span>

    <span
      v-if="session?.serverVersion"
      class="text-txt-4 hidden max-w-48 truncate font-mono md:inline @min-[640px]:inline"
      :title="t('服务器版本')"
    >
      {{ session.serverVersion }}
    </span>

    <span
      v-if="!embedded"
      class="min-w-0 flex-1"
    />

    <span
      v-if="selection && selection.cells > 0"
      class="flex shrink-0 items-center gap-2 font-mono"
    >
      <span>{{ t('已选 {count} 个单元格', { count: selection.cells }) }}</span>
      <span v-if="selection.rows">{{
        t('{count} 行', { count: selection.rows })
      }}</span>
      <span v-if="selection.sum !== undefined">
        {{ t('合计') }} {{ formatNumber(selection.sum) }}
      </span>
      <span v-if="selection.average !== undefined">
        {{ t('平均') }} {{ formatNumber(selection.average) }}
      </span>
    </span>
    <slot name="selection" />

    <span
      v-if="runningQueries > 0"
      class="text-accent flex shrink-0 items-center gap-1"
    >
      <AppIcon
        name="lucide:loader-circle"
        :size="11"
        class="motion-safe:animate-spin"
      />
      {{ t('{count} 个查询运行中', { count: runningQueries }) }}
    </span>
  </div>
</template>
