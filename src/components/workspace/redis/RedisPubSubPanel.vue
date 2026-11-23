<script setup lang="ts">
import {
  computed,
  nextTick,
  onScopeDispose,
  reactive,
  shallowRef,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppTextarea from '@/components/ui/AppTextarea.vue'
import IconButton from '@/components/ui/IconButton.vue'
import RedisValueViewer from '@/components/workspace/redis/RedisValueViewer.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import type { RedisPubSubMessage } from '@/types/redis'

const props = defineProps<{ sessionId: string; database?: string }>()
const { t } = useI18n()
/** 消息流最多保留的条数，超出后丢弃最旧的。 */
const MAX_MESSAGES = 2000
interface Subscription {
  job: number | null
  channels: string[]
  patterns: string[]
  generation: number
  active: boolean
  closed: boolean
  reportStopError?: boolean
}
interface Row extends RedisPubSubMessage {
  seq: number
}
// 响应式状态
const state = reactive({
  // 待订阅频道，使用逗号或空白分隔。
  channelInput: '',
  // 待订阅的频道匹配模式。
  patternInput: '',
  // 订阅 IPC 正在等待后端任务 ID，此阶段也能取消。
  subscribing: false,
  // 已返回任务 ID 的订阅；后端关闭后保留断开状态供用户查看。
  subscriptions: [] as Subscription[],
  // 发布表单的目标频道。
  publishChannel: '',
  // 发布表单的消息原文。
  publishMessage: '',
  // 当前连接的发布请求等待中，避免重复提交。
  publishing: false,
  // 消息列表的频道/内容过滤关键词。
  filter: '',
  // 暂停展示新消息，但仍记录实际接收数量。
  paused: false,
  // 自动跟随最新消息，可通过滚动或按钮关闭。
  follow: true,
  // 当前展开详情的消息序号。
  selected: null as number | null,
  // 当前上下文累计接收条数，清空消息时归零。
  received: 0,
})
const {
  channelInput,
  patternInput,
  subscribing,
  subscriptions,
  publishChannel,
  publishMessage,
  publishing,
  filter,
  paused,
  follow,
  selected,
  received,
} = toRefs(state)
// 高频消息直接整体替换，避免深层响应式开销。
const messages = shallowRef<Row[]>([])
let seq = 0
let generation = 0
let publishGeneration = 0
let disposed = false
let pendingSubscription: Subscription | null = null
const requests = new Set<Subscription>()
const list = useTemplateRef<HTMLElement>('list')
const visible = computed(() => {
  const query = state.filter.trim().toLowerCase()
  if (!query) return messages.value
  return messages.value.filter(
    row =>
      row.channel.toLowerCase().includes(query) ||
      row.payload.text.toLowerCase().includes(query)
  )
})
const selectedRow = computed(() =>
  messages.value.find(row => row.seq === state.selected)
)

/** 将频道/模式输入拆为不重复的非空项，供订阅请求固定使用。 */
function split(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .map(value => value.trim())
        .filter(Boolean)
    ),
  ]
}

/** 判断异步结果是否仍属于当前连接/DB 生命周期；频道本身仍是实例级而非 DB 级。 */
function isCurrent(token: number): boolean {
  return !disposed && token === generation
}

/** 仅允许仍有效的订阅应用消息与结束事件，退订后的旧事件会直接丢弃。 */
function isActive(subscription: Subscription): boolean {
  return (
    isCurrent(subscription.generation) &&
    subscription.active &&
    !subscription.closed &&
    requests.has(subscription)
  )
}

/** 回收后端订阅任务；显式退订失败才提示，过期和卸载清理错误不会产生未处理拒绝。 */
async function stopJob(
  job: number,
  token: number,
  reportError = false
): Promise<void> {
  try {
    await redis.stopJob(job)
  } catch (error) {
    if (reportError && isCurrent(token)) toast.error(redis.errorMessage(error))
  }
}

/** 将当前订阅消息追加到有界列表；滚动回调同样隔离切换或卸载后的旧上下文。 */
function append(items: RedisPubSubMessage[]): void {
  state.received += items.length
  if (state.paused) return
  const next = messages.value.concat(
    items.map(item => ({ ...item, seq: ++seq }))
  )
  messages.value = next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
  const token = generation
  if (state.follow)
    void nextTick(() => {
      if (isCurrent(token) && state.follow)
        list.value?.scrollTo({ top: list.value.scrollHeight })
    })
}

/** 建立独立订阅，pending 取消/切换/卸载后晚到的 ID 只回收，绝不重新加入列表。 */
async function subscribe(): Promise<void> {
  const channels = split(state.channelInput)
  const patterns = split(state.patternInput)
  if (
    disposed ||
    !props.sessionId ||
    state.subscribing ||
    (!channels.length && !patterns.length)
  )
    return
  const subscription = reactive<Subscription>({
    job: null,
    channels,
    patterns,
    generation,
    active: true,
    closed: false,
  })
  const sessionId = props.sessionId
  const channelInput = state.channelInput
  const patternInput = state.patternInput
  state.subscribing = true
  pendingSubscription = subscription
  requests.add(subscription)
  try {
    const id = await redis.pubsubSubscribe(
      sessionId,
      channels,
      patterns,
      event => {
        if (!isActive(subscription)) return
        if (event.kind === 'messages') append(event.items)
        else {
          subscription.closed = true
          subscription.active = false
          requests.delete(subscription)
          if (event.error) toast.error(redis.errorMessage(event.error))
        }
      }
    )
    subscription.job = id
    if (!isActive(subscription)) {
      await stopJob(id, subscription.generation, subscription.reportStopError)
      return
    }
    state.subscriptions.push(subscription)
    if (state.channelInput === channelInput) state.channelInput = ''
    if (state.patternInput === patternInput) state.patternInput = ''
  } catch (error) {
    if (isActive(subscription)) toast.error(redis.errorMessage(error))
    subscription.active = false
    subscription.closed = true
    requests.delete(subscription)
  } finally {
    // 旧请求的 finally 不得解锁后来发起的新订阅请求。
    if (pendingSubscription === subscription) {
      pendingSubscription = null
      if (isCurrent(subscription.generation)) state.subscribing = false
    }
  }
}

/** 先使订阅本地失效，再请求后端停止；pending ID 由 subscribe 的过期分支回收。 */
function invalidateSubscription(
  subscription: Subscription,
  reportError = false
): void {
  const active = subscription.active && !subscription.closed
  subscription.reportStopError = reportError
  subscription.active = false
  subscription.closed = true
  requests.delete(subscription)
  state.subscriptions = state.subscriptions.filter(
    item => item !== subscription
  )
  if (pendingSubscription === subscription) {
    pendingSubscription = null
    state.subscribing = false
  }
  if (active && subscription.job != null)
    void stopJob(subscription.job, subscription.generation, reportError)
}

/** 用户退订单条订阅，之后该任务的旧消息与结束事件都不再应用。 */
function unsubscribe(subscription: Subscription): void {
  invalidateSubscription(subscription, true)
}

/** 用户取消正在建立的订阅，不必等待后端返回任务 ID。 */
function cancelPending(): void {
  if (pendingSubscription) invalidateSubscription(pendingSubscription, true)
}

/** 统一撤销活跃与 pending 订阅；切换/卸载使用静默模式，纯标签隐藏不调用。 */
function invalidateAll(reportError = false): void {
  for (const subscription of [...requests])
    invalidateSubscription(subscription, reportError)
  state.subscriptions = []
  pendingSubscription = null
  state.subscribing = false
}

/** 用户全部退订，同时撤销尚未返回任务 ID 的订阅请求。 */
function unsubscribeAll(): void {
  invalidateAll(true)
}

/** 发布固定频道与消息快照；只向同一生命周期展示结果，旧 finally 不改新请求状态。 */
async function publish(): Promise<void> {
  const channel = state.publishChannel.trim()
  if (disposed || !props.sessionId || state.publishing || !channel) return
  const token = generation
  const request = ++publishGeneration
  const sessionId = props.sessionId
  const message = state.publishMessage
  state.publishing = true
  try {
    const receivers = await redis.publish(sessionId, channel, message)
    if (isCurrent(token) && request === publishGeneration)
      toast.success(t('已发布，{count} 个订阅者收到', { count: receivers }))
  } catch (error) {
    if (isCurrent(token) && request === publishGeneration)
      toast.error(redis.errorMessage(error))
  } finally {
    if (isCurrent(token) && request === publishGeneration)
      state.publishing = false
  }
}

/** 清空展示与计数，不撤销现有订阅；后续消息仍可正常进入当前上下文。 */
function clear(): void {
  messages.value = []
  state.selected = null
  state.received = 0
}

/** 根据用户滚动位置判断是否继续跟随最新消息。 */
function onScroll(): void {
  const el = list.value
  if (el) state.follow = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

/** 按系统区域格式显示消息接收时间，并保留毫秒用于观察消息顺序。 */
function time(ms: number): string {
  const date = new Date(ms)
  return (
    date.toLocaleTimeString(undefined, { hour12: false }) +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0')
  )
}

// 连接或 DB 变化时撤销旧上下文；这里隔离 UI 生命周期，不把 Redis 频道按 DB 过滤。
watch(
  [() => props.sessionId, () => props.database],
  () => {
    generation += 1
    publishGeneration += 1
    invalidateAll()
    clear()
    state.channelInput = ''
    state.patternInput = ''
    state.publishChannel = ''
    state.publishMessage = ''
    state.publishing = false
    state.filter = ''
    state.paused = false
    state.follow = true
  },
  { flush: 'sync' }
)
// 卸载先阻止消息/发布反馈，再停止当前订阅；pending ID 的后续返回仍会被回收。
onScopeDispose(() => {
  disposed = true
  generation += 1
  publishGeneration += 1
  invalidateAll()
})
</script>

<template>
  <section
    class="redis-pubsub flex min-h-0 min-w-0 flex-1 overflow-hidden"
    :aria-label="t('发布/订阅')"
  >
    <div class="pubsub-layout flex min-h-0 min-w-0 flex-1">
      <!-- 发布订阅控制区：订阅等待 ID 时也提供显式取消，不因标签隐藏自动退订。 -->
      <aside
        class="pubsub-controls border-line-soft scroll-thin flex w-72 shrink-0 flex-col gap-4 overflow-auto border-r p-3 text-[11px]"
      >
        <form
          class="flex flex-col gap-2"
          @submit.prevent="subscribe"
          :aria-busy="subscribing"
        >
          <h3 class="text-txt-3 flex items-center gap-1.5">
            <AppIcon
              name="lucide:radio-receiver"
              :size="12"
            />{{ t('订阅') }}
          </h3>
          <AppInput
            v-model="channelInput"
            size="sm"
            monospace
            :aria-label="t('频道')"
            :placeholder="t('频道，多个用空格或逗号分隔')"
            :disabled="subscribing || !sessionId"
            autocomplete="off"
            spellcheck="false"
          />
          <AppInput
            v-model="patternInput"
            size="sm"
            monospace
            :aria-label="t('模式')"
            :placeholder="t('模式，如 news.*')"
            :disabled="subscribing || !sessionId"
            autocomplete="off"
            spellcheck="false"
          />
          <div class="flex flex-wrap gap-2">
            <AppButton
              type="submit"
              size="sm"
              variant="primary"
              :disabled="
                subscribing ||
                !sessionId ||
                (!channelInput.trim() && !patternInput.trim())
              "
            >
              <AppIcon
                :name="subscribing ? 'lucide:loader-circle' : 'lucide:plus'"
                :size="11"
                :class="subscribing && 'motion-safe:animate-spin'"
              />{{ t('订阅') }}
            </AppButton>
            <AppButton
              v-if="subscribing"
              size="sm"
              @click="cancelPending"
              >{{ t('取消') }}</AppButton
            >
          </div>
        </form>
        <div
          v-if="subscriptions.length || subscribing"
          class="flex flex-col gap-1"
        >
          <div class="text-txt-3 flex flex-wrap items-center gap-2">
            <span>{{ t('当前订阅') }}</span>
            <button
              type="button"
              class="text-txt-3 hover:text-danger focus-visible:ring-violet/65 ml-auto cursor-pointer rounded text-[10px] outline-none focus-visible:ring-2"
              @click="unsubscribeAll"
            >
              {{ t('全部退订') }}
            </button>
          </div>
          <div
            v-for="item in subscriptions"
            :key="item.job!"
            class="border-line-soft flex items-start gap-1 rounded-md border px-2 py-1"
          >
            <span
              class="mt-1 size-1.5 shrink-0 rounded-full"
              :class="item.closed ? 'bg-txt-4' : 'bg-success'"
              :title="item.closed ? t('已断开') : t('订阅中')"
            />
            <div class="min-w-0 flex-1 font-mono break-all">
              <div
                v-for="channel in item.channels"
                :key="'c' + channel"
                class="text-txt-2"
              >
                {{ channel }}
              </div>
              <div
                v-for="pattern in item.patterns"
                :key="'p' + pattern"
                class="text-violet"
              >
                {{ pattern }}
              </div>
            </div>
            <IconButton
              icon="lucide:x"
              :size="11"
              class="size-5 shrink-0"
              :title="t('退订')"
              :aria-label="t('退订')"
              @click="unsubscribe(item)"
            />
          </div>
        </div>
        <!-- 发布控制区：Ctrl/Cmd+Enter 与提交按钮共用防重入和上下文保护。 -->
        <form
          class="border-line-soft flex flex-col gap-2 border-t pt-3"
          @submit.prevent="publish"
          :aria-busy="publishing"
        >
          <h3 class="text-txt-3 flex items-center gap-1.5">
            <AppIcon
              name="lucide:send"
              :size="12"
            />{{ t('发布') }}
          </h3>
          <AppInput
            v-model="publishChannel"
            size="sm"
            monospace
            :aria-label="t('频道')"
            :placeholder="t('频道')"
            :disabled="publishing || !sessionId"
            autocomplete="off"
            spellcheck="false"
          />
          <AppTextarea
            v-model="publishMessage"
            class="min-h-20 font-mono text-[11px]"
            :label="t('消息')"
            hide-label
            :placeholder="t('消息内容（Ctrl+Enter 发布）')"
            :disabled="publishing || !sessionId"
            spellcheck="false"
            @keydown.ctrl.enter.prevent="publish"
            @keydown.meta.enter.prevent="publish"
          />
          <AppButton
            type="submit"
            size="sm"
            :disabled="publishing || !sessionId || !publishChannel.trim()"
            >{{ t('发布') }}</AppButton
          >
        </form>
      </aside>
      <!-- 消息流区：按当前订阅过滤晚到事件，窄布局保留独立滚动区域。 -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          class="border-line-soft flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1 text-[11px]"
        >
          <AppInput
            v-model="filter"
            size="sm"
            class="min-w-32 flex-1"
            :aria-label="t('过滤消息')"
            :placeholder="t('过滤频道或内容')"
            autocomplete="off"
            spellcheck="false"
          />
          <span class="text-txt-3 ml-auto text-[10px] tabular-nums">{{
            t('显示 {shown} / 收到 {received}', {
              shown: visible.length,
              received,
            })
          }}</span>
          <IconButton
            :icon="paused ? 'lucide:play' : 'lucide:pause'"
            :size="13"
            :title="paused ? t('继续接收') : t('暂停接收')"
            :aria-label="paused ? t('继续接收') : t('暂停接收')"
            :aria-pressed="paused"
            :class="paused && 'text-amber'"
            @click="paused = !paused"
          />
          <IconButton
            icon="lucide:arrow-down-to-line"
            :size="13"
            :title="t('自动滚动')"
            :aria-label="t('自动滚动')"
            :aria-pressed="follow"
            :class="follow && 'text-accent'"
            @click="follow = !follow"
          />
          <IconButton
            icon="lucide:trash-2"
            :size="13"
            :title="t('清空消息')"
            :aria-label="t('清空消息')"
            @click="clear"
          />
        </div>
        <div
          ref="list"
          class="scroll-thin min-h-0 flex-1 overflow-auto font-mono text-[11px]"
          role="log"
          aria-live="off"
          @scroll.passive="onScroll"
        >
          <button
            v-for="row in visible"
            :key="row.seq"
            type="button"
            class="pubsub-message border-line-soft hover:bg-raised/60 focus-visible:ring-violet/65 flex w-full cursor-pointer items-baseline gap-3 border-b px-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset motion-safe:transition-colors"
            :class="selected === row.seq && 'bg-accent/10'"
            :aria-pressed="selected === row.seq"
            @click="selected = selected === row.seq ? null : row.seq"
          >
            <span class="text-txt-3 shrink-0 tabular-nums">{{
              time(row.receivedAt)
            }}</span>
            <span
              class="text-accent max-w-48 shrink-0 truncate"
              :title="
                row.pattern ? row.pattern + ' → ' + row.channel : row.channel
              "
              >{{ row.channel }}</span
            >
            <span class="pubsub-payload text-txt-2 min-w-0 flex-1 truncate">{{
              row.payload.binary
                ? t('二进制，{count} 字节', { count: row.payload.size })
                : row.payload.text
            }}</span>
          </button>
          <div
            v-if="!visible.length"
            class="text-txt-3 flex h-full min-h-20 items-center justify-center px-3 text-center font-sans"
          >
            {{
              subscriptions.length || subscribing
                ? t('等待消息…')
                : t('订阅频道后，消息会显示在这里')
            }}
          </div>
        </div>
        <div
          v-if="selectedRow"
          class="border-line-soft flex max-h-[45%] min-h-32 shrink-0 flex-col border-t"
        >
          <div
            class="text-txt-3 flex min-h-7 shrink-0 flex-wrap items-center gap-2 px-3 text-[10px]"
          >
            <span class="text-accent min-w-0 font-mono break-all">{{
              selectedRow.channel
            }}</span>
            <span v-if="selectedRow.pattern">← {{ selectedRow.pattern }}</span>
            <span>{{
              t('{count} 字节', { count: selectedRow.payload.size })
            }}</span>
            <IconButton
              icon="lucide:x"
              :size="11"
              class="ml-auto size-5"
              :title="t('关闭')"
              :aria-label="t('关闭')"
              @click="selected = null"
            />
          </div>
          <RedisValueViewer
            class="min-h-0 flex-1"
            :text="selectedRow.payload.text"
            :raw="selectedRow.payload.raw"
            :binary="selectedRow.payload.binary"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.redis-pubsub {
  container-type: inline-size;
  container-name: redis-pubsub;
}
@container redis-pubsub (max-width: 720px) {
  .pubsub-layout {
    flex-direction: column;
  }
  .pubsub-controls {
    width: 100%;
    max-height: 45%;
    border-right: 0;
    border-bottom: 1px solid var(--color-line-soft);
  }
  .pubsub-message {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 12px;
  }
  .pubsub-payload {
    grid-column: 1 / -1;
  }
}
</style>
