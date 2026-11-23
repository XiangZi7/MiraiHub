<script setup lang="ts">
import { computed, onScopeDispose, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import { copyText } from '@/utils/clipboard'
import { quoteRedisArgument } from '@/utils/redis-commands'
import type { RedisSlowlog } from '@/types/redis'

const props = withDefaults(
  defineProps<{ sessionId: string; active?: boolean }>(),
  { active: true }
)
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 当前连接最近一次有效的慢日志快照。
  log: null as RedisSlowlog | null,
  // 读取最近多少条记录。
  count: '128',
  // 正在读取快照。
  loading: false,
  // 正在执行清空，禁止重复提交。
  resetting: false,
  // 清空服务器慢日志的确认框。
  confirmReset: false,
  // 按耗时排序，否则保留服务器的时间倒序。
  byDuration: false,
})
const { log, count, loading, resetting, confirmReset, byDuration } =
  toRefs(state)
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
let generation = 0
let disposed = false
/** 以微秒或毫秒展示 Redis 报告的命令耗时。 */
function duration(us: number): string {
  return us >= 1000 ? (us / 1000).toFixed(2) + ' ms' : us + ' µs'
}
/** 对包含空白等字符的参数转义，复制出的命令仍保持原始参数边界。 */
function commandText(args: string[]): string {
  return args
    .map(arg => (/^[\w:.*-]+$/.test(arg) ? arg : quoteRedisArgument(arg)))
    .join(' ')
}
/** 只读取当前活跃连接；隐藏、换连接、改条数或卸载后的旧结果不回写。 */
async function load(): Promise<void> {
  if (disposed || state.loading || !props.active || !props.sessionId) return
  const token = generation
  const id = props.sessionId
  state.loading = true
  try {
    const log = await redis.slowlog(id, Number(state.count))
    if (!disposed && token === generation && id === props.sessionId)
      state.log = log
  } catch (error) {
    if (!disposed && token === generation)
      toast.error({
        title: t('读取 Redis 慢日志失败'),
        description: redis.errorMessage(error),
      })
  } finally {
    if (!disposed && token === generation) state.loading = false
  }
}
/** 确认后只清空当前连接，完成后刷新快照；停止等待不能撤销已执行的 RESET。 */
async function reset(): Promise<void> {
  if (
    disposed ||
    state.resetting ||
    state.loading ||
    !props.active ||
    !props.sessionId
  )
    return
  state.confirmReset = false
  state.resetting = true
  const token = generation
  const id = props.sessionId
  try {
    await redis.slowlogReset(id)
    if (!disposed && token === generation && id === props.sessionId)
      await load()
  } catch (error) {
    if (!disposed && token === generation)
      toast.error(redis.errorMessage(error))
  } finally {
    if (!disposed && token === generation) state.resetting = false
  }
}
/** 通过公共剪贴板入口复制命令，并统一反馈失败或成功。 */
async function copy(args: string[]): Promise<void> {
  try {
    await copyText(commandText(args))
    if (!disposed) toast.success(t('已复制'))
  } catch (error) {
    if (!disposed)
      toast.error({ title: t('复制失败'), description: String(error) })
  }
}
// 连接、可见性或读取条数变化时失效旧请求，新连接不沿用旧记录或清空确认。
watch(
  () => [props.sessionId, props.active, state.count] as const,
  ([id, active], previous) => {
    generation++
    state.loading = false
    state.resetting = false
    state.confirmReset = false
    if (id !== previous?.[0]) state.log = null
    if (active) void load()
  },
  { immediate: true, flush: 'sync' }
)
onScopeDispose(() => {
  disposed = true
  generation++
})
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div
      class="border-line-soft flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1 text-[11px]"
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
        icon="lucide:list-ordered"
        v-model="count"
        class="w-20 shrink-0"
        :label="t('读取条数')"
        :options="counts"
        :disabled="loading || resetting || !active"
        compact
        hide-label
      />
      <IconButton
        icon="lucide:refresh-cw"
        :size="13"
        :class="loading && '[&_svg]:motion-safe:animate-spin'"
        :title="t('刷新')"
        :aria-label="t('刷新')"
        :disabled="loading || resetting || !active"
        @click="load"
      />
      <AppButton
        size="sm"
        class="h-6"
        :disabled="loading || resetting || !active || !log?.total"
        @click="confirmReset = true"
      >
        {{ t('清空慢日志') }}
      </AppButton>
    </div>
    <div
      class="scroll-thin flex min-h-0 flex-1 flex-col overflow-auto"
      :aria-busy="loading || resetting"
    >
      <AppSkeleton
        v-if="loading && !log"
        class="my-auto w-full"
        variant="table"
        :rows="6"
        :columns="5"
      />
      <AppEmptyState
        v-else-if="!log"
        class="my-auto"
        icon="lucide:list-ordered"
        :title="t('暂无慢日志数据')"
      >
        <AppButton
          :disabled="loading || resetting || !active"
          @click="load"
          >{{ t('刷新') }}</AppButton
        >
      </AppEmptyState>
      <table
        v-else
        class="w-full min-w-[620px] table-fixed border-collapse text-[11px]"
      >
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
              :title="
                entry.client +
                (entry.clientName ? ' · ' + entry.clientName : '')
              "
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
      danger
      :title="t('清空慢日志？')"
      :description="t('将执行 SLOWLOG RESET，清空服务器上的全部慢日志记录。')"
      :confirm-label="t('清空慢日志')"
      @close="confirmReset = false"
      @confirm="reset"
    />
  </div>
</template>
