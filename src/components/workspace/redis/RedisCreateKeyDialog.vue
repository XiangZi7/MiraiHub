<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import type { RedisCollectionOp, RedisKey } from '@/types/redis'
import { textToBase64 } from './redis-value'

const props = defineProps<{ open: boolean; sessionId: string }>()
const emit = defineEmits<{ close: []; created: [key: RedisKey] }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  type: 'string',
  name: '',
  // Hash 字段 / Stream 字段名
  field: '',
  value: '',
  score: '0',
  ttl: '-1',
  loading: false,
})
const { type, name, field, value, score, ttl, loading } = toRefs(state)
const types = [
  { value: 'string', label: 'String', icon: 'lucide:type' },
  { value: 'hash', label: 'Hash', icon: 'lucide:hash' },
  { value: 'list', label: 'List', icon: 'lucide:list' },
  { value: 'set', label: 'Set', icon: 'lucide:braces' },
  { value: 'zset', label: 'Sorted Set', icon: 'lucide:list-ordered' },
  { value: 'stream', label: 'Stream', icon: 'lucide:workflow' },
]
watch(
  () => props.open,
  open => {
    if (open)
      Object.assign(state, {
        name: '',
        field: '',
        value: '',
        score: '0',
        ttl: '-1',
      })
  }
)
const needsField = computed(
  () => state.type === 'hash' || state.type === 'stream'
)
const valid = computed(
  () =>
    state.name !== '' &&
    /^(-1|[1-9]\d*)$/.test(state.ttl) &&
    (!needsField.value || state.field !== '') &&
    (state.type !== 'zset' ||
      Number.isFinite(Number(state.score.trim() || 'x')))
)
function firstOp(): RedisCollectionOp {
  const value = textToBase64(state.value)
  switch (state.type) {
    case 'hash':
      return { op: 'hashSet', field: textToBase64(state.field), value }
    case 'list':
      return { op: 'listPush', value, head: false }
    case 'set':
      return { op: 'setAdd', member: value }
    case 'zset':
      return { op: 'zsetAdd', member: value, score: Number(state.score) }
    default:
      return {
        op: 'streamAdd',
        id: '*',
        fields: [[textToBase64(state.field), value]],
      }
  }
}
async function create() {
  if (!valid.value || state.loading) return
  state.loading = true
  const key = textToBase64(state.name)
  const ttlSecs = Number(state.ttl)
  try {
    if (state.type === 'string')
      await redis.createString(props.sessionId, key, state.value, ttlSecs)
    else {
      // 先确认键不存在，避免向已有集合追加成员。
      if (await exists(key)) throw new Error(t('键已存在'))
      await redis.collectionWrite(props.sessionId, key, firstOp(), true)
      if (ttlSecs > 0) await redis.expireKey(props.sessionId, key, ttlSecs)
    }
    toast.success(t('已创建'))
    emit('created', { id: key, name: state.name })
    emit('close')
  } catch (error) {
    toast.error(redis.errorMessage(error))
  } finally {
    state.loading = false
  }
}
async function exists(key: string) {
  try {
    await redis.inspect(props.sessionId, key)
    return true
  } catch (error) {
    if (redis.isAppError(error) && error.kind === 'notFound') return false
    throw error
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-100"
    >
      <AppDialog
        :title="t('新建键')"
        @close="!loading && emit('close')"
      >
        <form
          id="redis-create-key-form"
          class="flex flex-col gap-3"
          @submit.prevent="create"
        >
          <div class="flex gap-2">
            <AppSelect
              icon="lucide:shapes"
              v-model="type"
              class="w-32 shrink-0"
              :label="t('类型')"
              :options="types"
            />
            <AppInput
              v-model="name"
              monospace
              class="flex-1 self-end"
              :aria-label="t('键名')"
              :placeholder="t('键名')"
              spellcheck="false"
              autofocus
            />
          </div>
          <div
            v-if="needsField || type === 'zset'"
            class="flex gap-2"
          >
            <AppInput
              v-if="needsField"
              v-model="field"
              monospace
              class="flex-1"
              :aria-label="t('字段')"
              :placeholder="t('字段')"
            />
            <AppInput
              v-else
              v-model="score"
              monospace
              class="w-32"
              inputmode="decimal"
              :aria-label="t('分数')"
              :placeholder="t('分数')"
            />
          </div>
          <textarea
            v-model="value"
            rows="5"
            class="field scroll-thin w-full resize-y rounded-md px-2 py-1.5 font-mono text-xs"
            :aria-label="
              type === 'set' || type === 'zset' ? t('成员') : t('值')
            "
            :placeholder="
              type === 'set' || type === 'zset' ? t('成员') : t('值')
            "
            spellcheck="false"
          />
          <label class="field h-7 w-40 gap-1 rounded-md px-2 text-[11px]">
            <span class="text-txt-4">TTL</span>
            <input
              v-model="ttl"
              class="min-w-0"
              inputmode="numeric"
              :aria-label="t('TTL（秒，-1 表示永不过期）')"
              :title="t('TTL（秒，-1 表示永不过期）')"
            />
            <span class="text-txt-4">s</span>
          </label>
        </form>
        <template #footer>
          <AppButton
            class="ml-auto"
            variant="ghost"
            :disabled="loading"
            @click="emit('close')"
            >{{ t('取消') }}</AppButton
          >
          <AppButton
            type="submit"
            form="redis-create-key-form"
            variant="primary"
            :disabled="!valid || loading"
            >{{ t('创建') }}</AppButton
          >
        </template>
      </AppDialog>
    </div>
  </Teleport>
</template>
