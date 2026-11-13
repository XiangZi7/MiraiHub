<script setup lang="ts">
import { computed, nextTick, reactive, toRefs, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import RedisCommandGuide from '@/components/workspace/redis/RedisCommandGuide.vue'
import DatabaseQueryResizeHandle from '@/components/workspace/database/DatabaseQueryResizeHandle.vue'
import type { RedisCommandResult, RedisKey } from '@/types/redis'
import {
  REDIS_CONSOLE_HISTORY_KEY,
  isSensitiveRedisCommand,
  sanitizeRedisHistory,
} from '@/utils/redis-console-history'
const props = defineProps<{
  busy: boolean
  result: RedisCommandResult | null
  selectedKey?: RedisKey
  keyType?: string
}>()
const command = defineModel<string>({ required: true })
const emit = defineEmits<{ execute: [] }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 编辑器与结果区的高度比例
  editorRatio: 45,
})
const { editorRatio } = toRefs(state)
const gutter = useTemplateRef<HTMLElement>('gutter')
const editor = useTemplateRef<HTMLTextAreaElement>('editor')
async function insertCommand(value: string) {
  command.value = value
  await nextTick()
  editor.value?.focus()
}
function syncScroll(event: Event) {
  if (gutter.value)
    gutter.value.scrollTop = (event.target as HTMLTextAreaElement).scrollTop
}
const formatted = computed(() =>
  typeof props.result?.value === 'string'
    ? props.result.value
    : JSON.stringify(props.result?.value, null, 2)
)
const splitStyle = computed(() => ({
  gridTemplateRows:
    'minmax(0, ' +
    state.editorRatio +
    'fr) 10px minmax(0, ' +
    (100 - state.editorRatio) +
    'fr)',
}))
const lines = computed(() => command.value.split('\n').length)
// 常用 Redis 命令名，用于首词补全
const COMMANDS = (
  'APPEND AUTH BGSAVE BITCOUNT BLPOP BRPOP CLIENT CONFIG COPY DBSIZE DECR DECRBY DEL DUMP ECHO EVAL EVALSHA EXISTS EXPIRE EXPIREAT EXPIRETIME ' +
  'FLUSHALL FLUSHDB GEOADD GEODIST GEOPOS GEOSEARCH GET GETDEL GETEX GETRANGE GETSET HDEL HEXISTS HGET HGETALL HINCRBY HINCRBYFLOAT HKEYS HLEN ' +
  'HMGET HMSET HSCAN HSET HSETNX HSTRLEN HVALS INCR INCRBY INCRBYFLOAT INFO KEYS LASTSAVE LINDEX LINSERT LLEN LMOVE LPOP LPOS LPUSH LPUSHX ' +
  'LRANGE LREM LSET LTRIM MEMORY MGET MONITOR MOVE MSET MSETNX OBJECT PERSIST PEXPIRE PFADD PFCOUNT PFMERGE PING PSETEX PTTL PUBLISH PUBSUB ' +
  'RANDOMKEY RENAME RENAMENX RPOP RPUSH RPUSHX SADD SAVE SCAN SCARD SCRIPT SDIFF SELECT SET SETEX SETNX SETRANGE SINTER SISMEMBER SLOWLOG ' +
  'SMEMBERS SMOVE SPOP SRANDMEMBER SREM SSCAN STRLEN SUNION TIME TOUCH TTL TYPE UNLINK XACK XADD XDEL XGROUP XINFO XLEN XRANGE XREAD ' +
  'XREVRANGE XTRIM ZADD ZCARD ZCOUNT ZINCRBY ZPOPMAX ZPOPMIN ZRANGE ZRANGEBYSCORE ZRANK ZREM ZREVRANGE ZSCAN ZSCORE'
).split(' ')
// 命令历史（最近 100 条、去重），持久化到本地存储
const history = useStorage<string[]>(REDIS_CONSOLE_HISTORY_KEY, [])
// 打开控制台时再清理一次，兜底启动后才写入的旧版敏感记录
const sanitizedHistory = sanitizeRedisHistory(history.value)
if (sanitizedHistory) history.value = sanitizedHistory
// 上/下键浏览历史时的当前位置，-1 表示未在浏览
let historyIndex = -1
// 单行输入首词时的命令补全候选
const suggestions = computed(() => {
  const text = command.value
  if (text.includes('\n') || /\s/.test(text.trimStart())) return []
  const word = text.trim().toUpperCase()
  if (!word) return []
  return COMMANDS.filter(name => name.startsWith(word) && name !== word).slice(0, 8)
})
// 用补全候选替换首词并聚焦编辑器
function applySuggestion(name: string) {
  command.value = name + ' '
  void nextTick(() => editor.value?.focus())
}
// Tab 键接受第一个补全候选
function onTab(event: KeyboardEvent) {
  const first = suggestions.value[0]
  if (!first) return
  event.preventDefault()
  applySuggestion(first)
}
// 单行时用上/下键切换历史命令
function onHistoryKey(event: KeyboardEvent, step: number) {
  if (command.value.includes('\n') || !history.value.length) return
  const next = historyIndex + step
  if (next < -1 || next >= history.value.length) return
  event.preventDefault()
  historyIndex = next
  command.value = next === -1 ? '' : history.value[next]!
}
const historyOptions = computed(() =>
  history.value.map(value => ({
    value,
    label: value.length > 80 ? value.slice(0, 80) + '…' : value,
    icon: 'lucide:square-terminal',
  }))
)
/** 从带图标的历史下拉框插入命令，并由现有插入流程将焦点还给编辑区。 */
function pickHistory(value: string): void {
  if (value) void insertCommand(value)
}
// 执行命令并记录到历史（含凭据的命令不记录）
function run() {
  const text = command.value.trim()
  if (props.busy || !text) return
  if (!isSensitiveRedisCommand(text)) history.value = [text, ...history.value.filter(item => item !== text)].slice(0, 100)
  historyIndex = -1
  emit('execute')
}
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    :aria-label="t('Redis 命令')"
  >
    <RedisCommandGuide
      :busy="busy"
      :selected-key="selectedKey"
      :key-type="keyType"
      @insert="insertCommand"
    />
    <div
      class="grid min-h-0 flex-1"
      :style="splitStyle"
    >
      <div class="flex min-h-0 flex-col">
        <div
          class="border-line-soft text-txt-4 flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[10px]"
        >
          <AppIcon
            name="lucide:square-terminal"
            :size="12"
          />
          <span class="text-txt-3">{{ t('Redis 命令') }}</span>
          <!-- 命令历史使用公共图标下拉，选取后仍只填入编辑区。 -->
          <AppSelect
            v-if="history.length"
            class="ml-auto w-48 min-w-0"
            icon="lucide:history"
            :model-value="''"
            :label="t('命令历史')"
            :placeholder="t('命令历史')"
            :options="historyOptions"
            hide-label
            compact
            @update:model-value="pickHistory"
          />
          <span :class="!history.length && 'ml-auto'">Ctrl + Enter</span>
          <AppButton
            size="sm"
            variant="primary"
            class="h-6"
            :disabled="busy || !command.trim()"
            @click="run"
          >
            <AppIcon
              :name="busy ? 'lucide:loader-circle' : 'lucide:play'"
              :size="11"
              :class="busy && 'animate-spin'"
            />{{ t('执行') }}
          </AppButton>
        </div>
        <div class="bg-terminal flex min-h-0 flex-1 overflow-hidden">
          <div
            ref="gutter"
            class="border-line-soft text-txt-4 w-11 shrink-0 overflow-hidden border-r py-3 pr-3 text-right font-mono text-xs leading-[1.65]"
            aria-hidden="true"
          >
            <div
              v-for="line in lines"
              :key="line"
            >
              {{ line }}
            </div>
          </div>
          <textarea
            ref="editor"
            v-model="command"
            :aria-label="t('Redis 命令')"
            :disabled="busy"
            placeholder="PING"
            class="scroll-thin text-txt min-h-0 min-w-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-[1.65] outline-none"
            spellcheck="false"
            wrap="off"
            maxlength="1048576"
            @scroll="syncScroll"
            @keydown.ctrl.enter.stop.prevent="run"
            @keydown.meta.enter.stop.prevent="run"
            @keydown.tab="onTab"
            @keydown.up.exact="onHistoryKey($event, 1)"
            @keydown.down.exact="onHistoryKey($event, -1)"
          />
        </div>
        <div
          v-if="suggestions.length"
          class="border-line-soft flex shrink-0 flex-wrap gap-1 border-t px-3 py-1"
          :aria-label="t('命令补全')"
        >
          <button
            v-for="name in suggestions"
            :key="name"
            type="button"
            class="bg-raised text-txt-2 hover:text-txt rounded px-1.5 py-0.5 font-mono text-[10px] motion-safe:transition-colors"
            @click="applySuggestion(name)"
          >
            {{ name }}
          </button>
        </div>
        <p class="text-txt-4 shrink-0 px-3 py-1.5 text-[10px] leading-relaxed">
          {{ t('每次执行一条命令，支持引号和转义；写入命令会立即生效') }}
          {{ t('Tab 补全命令，↑/↓ 切换历史') }}
        </p>
      </div>
      <DatabaseQueryResizeHandle
        v-model="editorRatio"
        :default-value="45"
        :label="t('调整 Redis 编辑器和结果区高度')"
        :value-text="
          t('Redis 编辑器占 {value0}%', { value0: Math.round(editorRatio) })
        "
      />
      <div class="flex min-h-0 min-w-0 flex-col">
        <header
          class="border-line-soft flex h-8 shrink-0 items-center gap-2 border-b px-2 text-[11px]"
        >
          <span class="bg-raised text-txt rounded px-2.5 py-1">{{
            t('结果')
          }}</span>
          <span
            v-if="result"
            class="text-txt-4 ml-auto text-[10px]"
            >{{ result.elapsedMs }} ms</span
          >
        </header>
        <pre
          v-if="result"
          class="scroll-thin text-txt-2 min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap"
          >{{ formatted }}</pre>
        <div
          v-else
          class="text-txt-4 flex min-h-0 flex-1 items-center justify-center text-[11px]"
        >
          {{ t('运行命令以查看结果') }}
        </div>
        <p
          v-if="result?.truncated"
          class="text-amber shrink-0 px-3 py-1.5 text-[10px]"
        >
          {{ t('结果已截断') }}
        </p>
      </div>
    </div>
  </section>
</template>
