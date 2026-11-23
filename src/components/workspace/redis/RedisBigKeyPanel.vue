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
interface ScanRequest {
  generation: number
  job: number | null
  finished: boolean
  stopToken?: number
  reportStopError?: boolean
}
// 响应式状态
const state = reactive({
  // 当前扫描匹配模式，空值表示全部键。
  pattern: '',
  // IPC 返回任务 ID 前也锁定启动入口，并允许用户取消。
  starting: false,
  // 当前后端扫描任务 ID，完成或取消后清空。
  job: null as number | null,
  // 只保留当前连接与 DB 的扫描快照。
  progress: null as RedisBigKeyProgress | null,
  // 快照对应的 DB，避免旧键进入新库。
  scannedDb: '',
  // 快照对应的 SSH/Redis 会话，切换连接时清空。
  scannedSession: '',
  // 结果类型过滤，开始新扫描时恢复全部类型。
  typeFilter: '',
})
const { pattern, progress, typeFilter } = toRefs(state)
const scanning = computed(() => state.starting || state.job != null)
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
const maxBytes = computed(() =>
  Math.max(1, state.progress?.keys[0]?.bytes ?? 1)
)
let generation = 0
let disposed = false
let activeRequest: ScanRequest | null = null

/** 判断扫描回调是否仍属于当前生命周期，旧进度和旧 finally 均不得回写。 */
function isCurrent(request: ScanRequest): boolean {
  return (
    !disposed && activeRequest === request && generation === request.generation
  )
}

/** 回收后端任务；显式取消失败才通知当前界面，过期或卸载清理始终静默。 */
async function stopJob(
  job: number,
  token: number,
  reportError = false
): Promise<void> {
  try {
    await redis.stopJob(job)
  } catch (error) {
    if (reportError && !disposed && token === generation)
      toast.error(redis.errorMessage(error))
  }
}

/** 启动扫描前立即锁定入口；取消后晚到的任务 ID 会回收，不重新激活扫描。 */
async function start(): Promise<void> {
  if (disposed || !props.sessionId || scanning.value) return
  const request: ScanRequest = {
    generation: ++generation,
    job: null,
    finished: false,
  }
  activeRequest = request
  state.starting = true
  state.progress = null
  state.typeFilter = ''
  state.scannedDb = props.database
  state.scannedSession = props.sessionId
  const sessionId = props.sessionId
  const pattern = state.pattern.trim()
  try {
    const id = await redis.bigKeyScan(sessionId, pattern, progress => {
      if (!isCurrent(request) || request.finished) return
      state.progress = progress
      if (progress.done) {
        request.finished = true
        state.job = null
        state.starting = false
        if (progress.error) toast.error(redis.errorMessage(progress.error))
      }
    })
    request.job = id
    if (!isCurrent(request)) {
      if (!request.finished)
        await stopJob(
          id,
          request.stopToken ?? generation,
          request.reportStopError
        )
      return
    }
    // 极小的库可能在返回任务 ID 前就已扫完，不能重新置为扫描中。
    if (!request.finished) state.job = id
  } catch (error) {
    if (!isCurrent(request) || request.finished) return
    request.finished = true
    state.job = null
    toast.error(redis.errorMessage(error))
  } finally {
    if (isCurrent(request)) state.starting = false
  }
}

/** 使当前扫描立即失效；用户取消保留部分结果，切换或卸载时丢弃整个快照。 */
function invalidate(keepProgress: boolean, reportError = false): void {
  const request = activeRequest
  const token = ++generation
  activeRequest = null
  if (request && !request.finished) {
    request.stopToken = token
    request.reportStopError = reportError
  }
  state.starting = false
  state.job = null
  if (keepProgress && request && !request.finished) {
    state.progress = {
      scanned: state.progress?.scanned ?? 0,
      total: state.progress?.total ?? 0,
      keys: state.progress?.keys ?? [],
      done: true,
      cancelled: true,
      error: null,
    }
  }
  if (request?.job != null && !request.finished)
    void stopJob(request.job, token, reportError)
}

/** 取消已启动或仍等待 IPC 任务 ID 的扫描，后续旧进度不再进入界面。 */
function cancel(): void {
  invalidate(true, true)
}

/** 打开当前快照中的原始键标识；取消后的部分结果仍可用，但跨连接/DB 不可用。 */
function openKey(key: RedisKey): void {
  if (
    disposed ||
    state.scannedSession !== props.sessionId ||
    state.scannedDb !== props.database ||
    !state.progress?.keys.some(item => item.key.id === key.id)
  )
    return
  emit('open', key)
}

// 同会话切 DB 也会清理任务与旧结果；纯标签隐藏不触发此监听。
watch(
  [() => props.sessionId, () => props.database],
  () => {
    invalidate(false)
    state.progress = null
    state.typeFilter = ''
    state.scannedDb = ''
    state.scannedSession = ''
  },
  { flush: 'sync' }
)
// 卸载先阻止回调/通知，再回收任务；pending ID 到达后由 start 的过期分支补充回收。
onScopeDispose(() => {
  disposed = true
  invalidate(false)
})
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    :aria-label="t('大 key 扫描')"
    :aria-busy="scanning"
  >
    <!-- 扫描控制区：启动中的 IPC 同样支持取消，工具栏在窄窗口自动换行。 -->
    <form
      class="border-line-soft flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
      @submit.prevent="start"
    >
      <AppInput
        v-model="pattern"
        size="sm"
        monospace
        class="min-w-32 flex-1"
        :aria-label="t('匹配模式')"
        :placeholder="t('匹配模式（留空为全部）')"
        :disabled="scanning"
        spellcheck="false"
      />
      <AppButton
        v-if="!scanning"
        type="submit"
        size="sm"
        variant="primary"
        :disabled="!sessionId"
      >
        <AppIcon
          name="lucide:scan-search"
          :size="11"
        />{{ t('开始扫描') }}
      </AppButton>
      <AppButton
        v-else
        size="sm"
        @click="cancel"
      >
        <AppIcon
          name="lucide:square"
          :size="11"
        />{{ t('取消') }}
      </AppButton>
      <span class="text-txt-3 basis-full text-[10px] leading-relaxed">
        {{ t('使用 SCAN + MEMORY USAGE 分批读取，大库请缩小匹配范围') }}
      </span>
    </form>
    <!-- 当前扫描快照与进度：只接受当前 generation 的消息。 -->
    <div
      v-if="progress"
      class="border-line-soft shrink-0 border-b px-3 py-2"
    >
      <div
        class="text-txt-3 flex flex-wrap items-center gap-2 text-[11px]"
        role="status"
      >
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
        <span class="ml-auto font-mono tabular-nums"
          >{{ percent.toFixed(0) }}%</span
        >
      </div>
      <div
        class="bg-raised mt-1.5 h-1 overflow-hidden rounded-full"
        role="progressbar"
        :aria-label="t('大 key 扫描')"
        :aria-valuenow="Math.round(percent)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="bg-accent h-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-300"
          :style="{ transform: `scaleX(${percent / 100})` }"
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
        class="focus-visible:ring-violet/65 cursor-pointer rounded px-2 py-1 text-[10px] outline-none focus-visible:ring-2 motion-safe:transition-colors"
        :class="
          typeFilter === type
            ? 'bg-accent/15 text-accent'
            : 'text-txt-3 hover:bg-raised'
        "
        :aria-pressed="typeFilter === type"
        @click="typeFilter = type"
      >
        {{ type || t('全部类型') }}
      </button>
    </div>
    <!-- 大键列表：保留横向滚动，键名使用原生按钮提供键盘打开入口。 -->
    <div class="scroll-thin min-h-0 min-w-0 flex-1 overflow-auto">
      <table
        v-if="progress"
        class="w-full min-w-[560px] table-fixed border-collapse text-[11px]"
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
            class="border-line-soft hover:bg-raised/60 border-b motion-safe:transition-colors"
          >
            <td class="text-txt-3 px-2 py-1.5">{{ index + 1 }}</td>
            <td class="text-txt-2 px-2 py-1.5 font-mono">
              <button
                type="button"
                class="focus-visible:ring-violet/65 w-full cursor-pointer truncate rounded text-left outline-none focus-visible:ring-2"
                :title="t('打开键')"
                @click="openKey(row.key)"
              >
                {{ row.key.name }}
              </button>
            </td>
            <td class="text-txt-3 px-2 py-1.5">{{ row.keyType }}</td>
            <td
              class="text-txt-3 px-2 py-1.5 text-right font-mono tabular-nums"
            >
              {{ row.length || '—' }}
            </td>
            <td class="px-2 py-1.5">
              <div class="flex items-center gap-2">
                <div
                  class="bg-raised h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
                >
                  <div
                    class="bg-amber h-full origin-left rounded-full"
                    :style="{ transform: `scaleX(${row.bytes / maxBytes})` }"
                  />
                </div>
                <span
                  class="text-txt-2 w-16 shrink-0 text-right font-mono tabular-nums"
                  >{{ formatBytes(row.bytes) }}</span
                >
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td
              colspan="5"
              class="text-txt-3 px-3 py-6 text-center"
            >
              {{ scanning ? t('正在扫描…') : t('没有键') }}
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-else
        class="text-txt-3 flex h-full min-h-24 items-center justify-center px-6 text-center text-[11px]"
        role="status"
      >
        {{
          scanning
            ? t('正在扫描…')
            : t('扫描当前 DB，列出占用内存最多的 100 个键')
        }}
      </div>
    </div>
  </section>
</template>
