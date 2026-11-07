<script setup lang="ts">
import { computed, onScopeDispose, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import { formatBytes } from '@/utils/format'
import type { RedisBigKeyProgress, RedisKey } from '@/types/redis'

const props = defineProps<{ sessionId: string; database: string }>()
const emit = defineEmits<{ open: [key: RedisKey] }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  pattern: '',
  // 当前扫描任务 ID；为 null 表示未在扫描
  job: null as number | null,
  progress: null as RedisBigKeyProgress | null,
  // 扫描时所在的 DB，切库后结果标记为过期
  scannedDb: '',
  typeFilter: '',
})
const { pattern, job, progress, typeFilter } = toRefs(state)
const percent = computed(() => {
  const p = state.progress
  if (!p) return 0
  if (p.done && !p.cancelled && !p.error) return 100
  // DBSIZE 只是起始快照，扫描中键数变化时封顶 99%。
  return p.total ? Math.min(99, (p.scanned / p.total) * 100) : 0
})
const types = computed(() => [
  ...new Set(state.progress?.keys.map(key => key.keyType) ?? []),
])
const rows = computed(() =>
  (state.progress?.keys ?? []).filter(
    key => !state.typeFilter || key.keyType === state.typeFilter
  )
)
const maxBytes = computed(() => state.progress?.keys[0]?.bytes ?? 1)
async function start() {
  if (state.job != null) return
  state.progress = null
  state.scannedDb = props.database
  try {
    const id = await redis.bigKeyScan(
      props.sessionId,
      state.pattern.trim(),
      progress => {
        state.progress = progress
        if (progress.done) {
          state.job = null
          if (progress.error) toast.error(progress.error)
        }
      }
    )
    // 极小的库可能在返回任务 ID 前就已扫完。
    if (!state.progress?.done) state.job = id
  } catch (error) {
    toast.error(redis.errorMessage(error))
  }
}
function cancel() {
  if (state.job != null) void redis.stopJob(state.job)
}
watch(
  () => props.sessionId,
  () => {
    cancel()
    state.job = null
    state.progress = null
  }
)
onScopeDispose(cancel)
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    :aria-label="t('大 key 扫描')"
  >
    <form
      class="border-line-soft flex h-10 shrink-0 items-center gap-2 border-b px-2"
      @submit.prevent="start"
    >
      <AppInput
        v-model="pattern"
        size="sm"
        monospace
        class="w-64"
        :aria-label="t('匹配模式')"
        :placeholder="t('匹配模式（留空为全部）')"
        :disabled="job != null"
        spellcheck="false"
      />
      <AppButton
        v-if="job == null"
        type="submit"
        size="sm"
        variant="primary"
        class="h-6"
      >
        <AppIcon
          name="lucide:scan-search"
          :size="11"
        />{{ t('开始扫描') }}
      </AppButton>
      <AppButton
        v-else
        size="sm"
        class="h-6"
        @click="cancel"
      >
        <AppIcon
          name="lucide:square"
          :size="11"
        />{{ t('取消') }}
      </AppButton>
      <span class="text-txt-4 ml-auto truncate text-[10px]">{{
        t('使用 SCAN + MEMORY USAGE，按批执行，不阻塞服务器')
      }}</span>
    </form>
    <div
      v-if="progress"
      class="border-line-soft shrink-0 border-b px-3 py-2"
    >
      <div class="text-txt-3 flex items-center gap-2 text-[11px]">
        <span>{{
          t('已扫描 {scanned} / 约 {total} 个键', {
            scanned: progress.scanned,
            total: progress.total,
          })
        }}</span>
        <span
          v-if="progress.done"
          :class="
            progress.error
              ? 'text-danger'
              : progress.cancelled
                ? 'text-amber'
                : 'text-success'
          "
          >{{
            progress.error
              ? t('扫描失败')
              : progress.cancelled
                ? t('已取消，显示部分结果')
                : t('扫描完成')
          }}</span
        >
        <span
          v-if="state.scannedDb !== database"
          class="text-amber"
          >{{ t('结果来自 DB {db}', { db: state.scannedDb }) }}</span
        >
        <span class="ml-auto font-mono tabular-nums"
          >{{ percent.toFixed(0) }}%</span
        >
      </div>
      <div
        class="bg-raised mt-1.5 h-1 overflow-hidden rounded-full"
        role="progressbar"
        :aria-valuenow="Math.round(percent)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="bg-accent h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300"
          :style="{ width: percent + '%' }"
        />
      </div>
    </div>
    <div
      v-if="types.length > 1"
      class="flex shrink-0 flex-wrap gap-1 px-3 pt-2"
    >
      <button
        v-for="type in ['', ...types]"
        :key="type"
        type="button"
        class="rounded px-2 py-0.5 text-[10px] motion-safe:transition-colors"
        :class="
          typeFilter === type
            ? 'bg-accent/15 text-accent'
            : 'text-txt-3 hover:bg-raised'
        "
        @click="typeFilter = type"
      >
        {{ type || t('全部类型') }}
      </button>
    </div>
    <div class="scroll-thin min-h-0 flex-1 overflow-auto">
      <table
        v-if="progress"
        class="w-full table-fixed border-collapse text-[11px]"
      >
        <thead class="bg-panel text-txt-3 sticky top-0 z-10">
          <tr class="border-line-soft border-b text-left">
            <th class="w-10 px-2 py-1.5 font-normal">#</th>
            <th class="px-2 py-1.5 font-normal">{{ t('键名') }}</th>
            <th class="w-20 px-2 py-1.5 font-normal">{{ t('类型') }}</th>
            <th class="w-24 px-2 py-1.5 text-right font-normal">
              {{ t('元素/长度') }}
            </th>
            <th class="w-44 px-2 py-1.5 font-normal">{{ t('内存') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="row.key.id"
            class="border-line-soft hover:bg-raised/60 cursor-pointer border-b motion-safe:transition-colors"
            :title="t('打开键')"
            @click="emit('open', row.key)"
          >
            <td class="text-txt-4 px-2 py-1.5">{{ index + 1 }}</td>
            <td class="text-txt-2 truncate px-2 py-1.5 font-mono">
              {{ row.key.name }}
            </td>
            <td class="text-txt-3 px-2 py-1.5">{{ row.keyType }}</td>
            <td class="text-txt-3 px-2 py-1.5 text-right font-mono tabular-nums">
              {{ row.length || '—' }}
            </td>
            <td class="px-2 py-1.5">
              <div class="flex items-center gap-2">
                <div class="bg-raised h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                  <div
                    class="bg-amber h-full rounded-full"
                    :style="{ width: (row.bytes / maxBytes) * 100 + '%' }"
                  />
                </div>
                <span class="text-txt-2 w-16 shrink-0 text-right font-mono tabular-nums">{{
                  formatBytes(row.bytes)
                }}</span>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td
              colspan="5"
              class="text-txt-4 px-3 py-6 text-center"
            >
              {{ job != null ? t('正在扫描…') : t('没有键') }}
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-else
        class="text-txt-4 flex h-full items-center justify-center px-6 text-center text-[11px]"
      >
        {{ t('扫描当前 DB，列出占用内存最多的 100 个键') }}
      </div>
    </div>
  </section>
</template>
