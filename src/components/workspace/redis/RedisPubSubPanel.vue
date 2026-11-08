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
import RedisValueViewer from './RedisValueViewer.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import type { RedisPubSubMessage } from '@/types/redis'

const props = defineProps<{ sessionId: string }>()
const { t } = useI18n()
/** 消息流最多保留的条数，超出后丢弃最旧的。 */
const MAX_MESSAGES = 2000
interface Subscription {
  job: number
  channels: string[]
  patterns: string[]
  closed: boolean
}
interface Row extends RedisPubSubMessage {
  seq: number
}
// 响应式状态
const state = reactive({
  // 订阅表单：逗号或空白分隔
  channelInput: '',
  patternInput: '',
  subscribing: false,
  subscriptions: [] as Subscription[],
  // 发布表单
  publishChannel: '',
  publishMessage: '',
  publishing: false,
  // 消息流
  filter: '',
  paused: false,
  follow: true,
  selected: null as number | null,
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
} = toRefs(state)
// 高频消息直接整体替换，避免深层响应式开销
const messages = shallowRef<Row[]>([])
let seq = 0
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
function split(input: string) {
  return input
    .split(/[\s,]+/)
    .map(value => value.trim())
    .filter(Boolean)
}
function append(items: RedisPubSubMessage[]) {
  state.received += items.length
  if (state.paused) return
  const next = messages.value.concat(
    items.map(item => ({ ...item, seq: ++seq }))
  )
  messages.value =
    next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
  if (state.follow)
    void nextTick(() =>
      list.value?.scrollTo({ top: list.value.scrollHeight })
    )
}
async function subscribe() {
  const channels = split(state.channelInput)
  const patterns = split(state.patternInput)
  if (state.subscribing || (!channels.length && !patterns.length)) return
  state.subscribing = true
  try {
    const subscription = reactive<Subscription>({
      job: 0,
      channels,
      patterns,
      closed: false,
    })
    subscription.job = await redis.pubsubSubscribe(
      props.sessionId,
      channels,
      patterns,
      event => {
        if (event.kind === 'messages') append(event.items)
        else {
          subscription.closed = true
          if (event.error) toast.error(event.error)
        }
      }
    )
    state.subscriptions.push(subscription)
    state.channelInput = ''
    state.patternInput = ''
  } catch (error) {
    toast.error(redis.errorMessage(error))
  } finally {
    state.subscribing = false
  }
}
function unsubscribe(subscription: Subscription) {
  void redis.stopJob(subscription.job)
  state.subscriptions = state.subscriptions.filter(item => item !== subscription)
}
function unsubscribeAll() {
  state.subscriptions.forEach(item => void redis.stopJob(item.job))
  state.subscriptions = []
}
async function publish() {
  if (state.publishing || !state.publishChannel) return
  state.publishing = true
  try {
    const receivers = await redis.publish(
      props.sessionId,
      state.publishChannel,
      state.publishMessage
    )
    toast.success(t('已发布，{count} 个订阅者收到', { count: receivers }))
  } catch (error) {
    toast.error(redis.errorMessage(error))
  } finally {
    state.publishing = false
  }
}
function clear() {
  messages.value = []
  state.selected = null
  state.received = 0
}
function onScroll() {
  const el = list.value
  if (el) state.follow = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}
function time(ms: number) {
  const date = new Date(ms)
  return (
    date.toLocaleTimeString(undefined, { hour12: false }) +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0')
  )
}
watch(
  () => props.sessionId,
  () => {
    unsubscribeAll()
    clear()
  }
)
onScopeDispose(unsubscribeAll)
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1"
    :aria-label="t('发布/订阅')"
  >
    <aside
      class="border-line-soft scroll-thin flex w-72 shrink-0 flex-col gap-4 overflow-auto border-r p-3 text-[11px]"
    >
      <form
        class="flex flex-col gap-2"
        @submit.prevent="subscribe"
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
          spellcheck="false"
        />
        <AppInput
          v-model="patternInput"
          size="sm"
          monospace
          :aria-label="t('模式')"
          :placeholder="t('模式，如 news.*')"
          spellcheck="false"
        />
        <AppButton
          type="submit"
          size="sm"
          variant="primary"
          class="h-6"
          :disabled="subscribing || (!channelInput.trim() && !patternInput.trim())"
        >
          <AppIcon
            :name="subscribing ? 'lucide:loader-circle' : 'lucide:plus'"
            :size="11"
            :class="subscribing && 'motion-safe:animate-spin'"
          />{{ t('订阅') }}
        </AppButton>
      </form>
      <div
        v-if="subscriptions.length"
        class="flex flex-col gap-1"
      >
        <div class="text-txt-3 flex items-center">
          <span>{{ t('当前订阅') }}</span>
          <button
            type="button"
            class="text-txt-4 hover:text-danger ml-auto text-[10px]"
            @click="unsubscribeAll"
          >
            {{ t('全部退订') }}
          </button>
        </div>
        <div
          v-for="item in subscriptions"
          :key="item.job"
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
      <form
        class="border-line-soft flex flex-col gap-2 border-t pt-3"
        @submit.prevent="publish"
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
          spellcheck="false"
        />
        <AppTextarea
          v-model="publishMessage"
          class="min-h-20 font-mono text-[11px]"
          :label="t('消息')"
          hide-label
          :placeholder="t('消息内容（Ctrl+Enter 发布）')"
          spellcheck="false"
          @keydown.ctrl.enter.prevent="publish"
          @keydown.meta.enter.prevent="publish"
        />
        <AppButton
          type="submit"
          size="sm"
          class="h-6"
          :disabled="publishing || !publishChannel"
        >
          {{ t('发布') }}
        </AppButton>
      </form>
    </aside>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        class="border-line-soft flex h-9 shrink-0 items-center gap-2 border-b px-2 text-[11px]"
      >
        <AppInput
          v-model="filter"
          size="sm"
          class="w-56"
          :aria-label="t('过滤消息')"
          :placeholder="t('过滤频道或内容')"
          spellcheck="false"
        />
        <span class="text-txt-4 ml-auto text-[10px] tabular-nums">{{
          t('显示 {shown} / 收到 {received}', {
            shown: visible.length,
            received: state.received,
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
          class="border-line-soft hover:bg-raised/60 flex w-full items-baseline gap-3 border-b px-3 py-1 text-left motion-safe:transition-colors"
          :class="selected === row.seq && 'bg-accent/10'"
          @click="selected = selected === row.seq ? null : row.seq"
        >
          <span class="text-txt-4 shrink-0 tabular-nums">{{
            time(row.receivedAt)
          }}</span>
          <span
            class="text-accent max-w-48 shrink-0 truncate"
            :title="row.pattern ? row.pattern + ' → ' + row.channel : row.channel"
            >{{ row.channel }}</span
          >
          <span class="text-txt-2 min-w-0 flex-1 truncate">{{
            row.payload.binary ? t('二进制，{count} 字节', { count: row.payload.size }) : row.payload.text
          }}</span>
        </button>
        <div
          v-if="!visible.length"
          class="text-txt-4 flex h-full items-center justify-center font-sans"
        >
          {{
            subscriptions.length ? t('等待消息…') : t('订阅频道后，消息会显示在这里')
          }}
        </div>
      </div>
      <div
        v-if="selectedRow"
        class="border-line-soft flex max-h-[45%] min-h-32 shrink-0 flex-col border-t"
      >
        <div
          class="text-txt-3 flex h-7 shrink-0 items-center gap-2 px-3 text-[10px]"
        >
          <span class="text-accent font-mono">{{ selectedRow.channel }}</span>
          <span v-if="selectedRow.pattern">← {{ selectedRow.pattern }}</span>
          <span>{{ t('{count} 字节', { count: selectedRow.payload.size }) }}</span>
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
  </section>
</template>
