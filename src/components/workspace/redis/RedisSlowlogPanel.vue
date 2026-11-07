<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import { quoteRedisArgument } from '@/utils/redis-commands'
import type { RedisSlowlog } from '@/types/redis'

const props = defineProps<{ sessionId: string }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  log: null as RedisSlowlog | null,
  count: '128',
  loading: false,
  confirmReset: false,
  // 按耗时排序，否则按时间倒序（服务器默认顺序）
  byDuration: false,
})
const { log, count, loading, confirmReset, byDuration } = toRefs(state)
const counts = [
  { value: '32', label: '32' },
  { value: '128', label: '128' },
  { value: '512', label: '512' },
]
const entries = computed(() => {
  const list = [...(state.log?.entries ?? [])]
  return state.byDuration
    ? list.sort((a, b) => b.durationUs - a.durationUs)
    : list
})
function duration(us: number) {
  return us >= 1000 ? (us / 1000).toFixed(2) + ' ms' : us + ' µs'
}
function commandText(args: string[]) {
  return args
    .map(arg => (/^[\w:.*-]+$/.test(arg) ? arg : quoteRedisArgument(arg)))
    .join(' ')
}
async function load() {
  if (state.loading) return
  state.loading = true
  try {
    state.log = await redis.slowlog(props.sessionId, Number(state.count))
  } catch (error) {
    toast.error(redis.errorMessage(error))
  } finally {
    state.loading = false
  }
}
async function reset() {
  state.confirmReset = false
  try {
    await redis.slowlogReset(props.sessionId)
    await load()
  } catch (error) {
    toast.error(redis.errorMessage(error))
  }
}
async function copy(args: string[]) {
  await navigator.clipboard.writeText(commandText(args))
  toast.success(t('已复制'))
}
watch(() => [props.sessionId, state.count], load, { immediate: true })
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div
      class="border-line-soft flex h-9 shrink-0 items-center gap-2 border-b px-3 text-[11px]"
    >
      <span class="text-txt-3">{{
        t('共 {total} 条，显示最近 {count} 条', {
          total: log?.total ?? 0,
          count: log?.entries.length ?? 0,
        })
      }}</span>
      <AppCheckbox
        v-model="byDuration"
        class="ml-auto"
        :label="t('按耗时排序')"
      />
      <AppSelect
        v-model="count"
        class="w-20 shrink-0"
        :label="t('读取条数')"
        :options="counts"
        compact
        hide-label
      />
      <IconButton
        icon="lucide:refresh-cw"
        :size="13"
        :class="loading && '[&_svg]:motion-safe:animate-spin'"
        :title="t('刷新')"
        :aria-label="t('刷新')"
        :disabled="loading"
        @click="load"
      />
      <AppButton
        size="sm"
        class="h-6"
        :disabled="loading || !log?.total"
        @click="confirmReset = true"
      >
        {{ t('清空慢日志') }}
      </AppButton>
    </div>
    <div class="scroll-thin min-h-0 flex-1 overflow-auto">
      <table class="w-full table-fixed border-collapse text-[11px]">
        <thead class="bg-panel text-txt-3 sticky top-0 z-10">
          <tr class="border-line-soft border-b text-left">
            <th class="w-16 px-2 py-1.5 font-normal">ID</th>
            <th class="w-40 px-2 py-1.5 font-normal">{{ t('时间') }}</th>
            <th class="w-24 px-2 py-1.5 text-right font-normal">
              {{ t('耗时') }}
            </th>
            <th class="px-2 py-1.5 font-normal">{{ t('命令') }}</th>
            <th class="w-40 px-2 py-1.5 font-normal">{{ t('客户端') }}</th>
            <th class="w-8" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.id"
            class="border-line-soft group hover:bg-raised/60 border-b align-top motion-safe:transition-colors"
          >
            <td class="text-txt-4 px-2 py-1.5 font-mono">{{ entry.id }}</td>
            <td class="text-txt-3 px-2 py-1.5">
              {{ new Date(entry.timestamp * 1000).toLocaleString() }}
            </td>
            <td
              class="px-2 py-1.5 text-right font-mono tabular-nums"
              :class="entry.durationUs >= 100000 ? 'text-danger' : 'text-amber'"
            >
              {{ duration(entry.durationUs) }}
            </td>
            <td
              class="text-txt-2 px-2 py-1.5 font-mono break-all"
              :title="commandText(entry.args)"
            >
              <span class="line-clamp-3">{{ commandText(entry.args) }}</span>
            </td>
            <td
              class="text-txt-4 truncate px-2 py-1.5 font-mono"
              :title="entry.client + (entry.clientName ? ' · ' + entry.clientName : '')"
            >
              {{ entry.client || '—'
              }}{{ entry.clientName ? ' · ' + entry.clientName : '' }}
            </td>
            <td class="px-1 py-1">
              <IconButton
                icon="lucide:copy"
                :size="11"
                class="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                :title="t('复制命令')"
                :aria-label="t('复制命令')"
                @click="copy(entry.args)"
              />
            </td>
          </tr>
          <tr v-if="!entries.length && !loading">
            <td
              colspan="6"
              class="text-txt-4 px-3 py-6 text-center"
            >
              {{ t('没有慢日志') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <AppConfirmDialog
      :open="confirmReset"
      :title="t('清空慢日志？')"
      :description="t('将执行 SLOWLOG RESET，清空服务器上的全部慢日志记录。')"
      :confirm-label="t('清空慢日志')"
      @close="confirmReset = false"
      @confirm="reset"
    />
  </div>
</template>
