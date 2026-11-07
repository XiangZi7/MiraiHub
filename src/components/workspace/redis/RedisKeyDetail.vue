<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import RedisCollectionEditor from './RedisCollectionEditor.vue'
import RedisValueViewer from './RedisValueViewer.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import { copyText } from '@/utils/clipboard'
import type { RedisKey, RedisKeyDetail } from '@/types/redis'
const props = defineProps<{
  detail: RedisKeyDetail | null
  busy: boolean
  /** 复合类型编辑与重命名直接使用当前会话。 */
  sessionId?: string
}>()
const emit = defineEmits<{
  save: [value: string]
  remove: []
  expire: [seconds: number]
  refresh: []
  dirty: [value: boolean]
  command: []
  /** 重命名成功后的新键。 */
  renamed: [key: RedisKey]
  /** 集合最后一个成员被删除，键已不存在。 */
  gone: []
}>()
const { t } = useI18n()
const COLLECTION_TYPES = ['hash', 'list', 'set', 'zset', 'stream']
const TTL_PRESETS = [
  { label: '1m', seconds: 60 },
  { label: '1h', seconds: 3600 },
  { label: '1d', seconds: 86400 },
  { label: '7d', seconds: 604800 },
]
// 响应式状态
const state = reactive({
  // 当前 string 值编辑草稿
  draft: '',
  // string 值以编辑器或格式化视图展示
  stringView: 'edit' as 'edit' | 'view',
  // 待设置的过期秒数
  ttl: '-1',
  // 删除确认弹窗
  confirmDelete: false,
  // 集合编辑器内有未保存的行
  collectionDirty: false,
  // 集合写入后的最新长度，覆盖详情中的旧值
  length: null as number | null,
  // 重命名对话框
  renaming: false,
  newName: '',
  overwrite: false,
  renameBusy: false,
})
const {
  draft,
  stringView,
  ttl,
  confirmDelete,
  renaming,
  newName,
  overwrite,
  renameBusy,
} = toRefs(state)
const isCollection = computed(
  () =>
    !!props.detail &&
    !!props.sessionId &&
    COLLECTION_TYPES.includes(props.detail.keyType)
)
const stringDirty = computed(
  () => !!props.detail?.editable && state.draft !== props.detail.value
)
const dirty = computed(() => stringDirty.value || state.collectionDirty)
const validTtl = computed(
  () => /^(-1|[1-9]\d*)$/.test(state.ttl) && Number(state.ttl) <= 2147483647
)
const formatted = computed(() =>
  typeof props.detail?.value === 'string'
    ? props.detail.value
    : JSON.stringify(props.detail?.value, null, 2)
)
/** string 值可能以 {encoding: 'base64'} 形式回传二进制内容。 */
const binaryString = computed(() => {
  const value = props.detail?.value as { encoding?: string; data?: string }
  return props.detail?.keyType === 'string' && value?.encoding === 'base64'
    ? (value.data ?? '')
    : undefined
})
const ttlLabel = computed(() => {
  const ms = props.detail?.ttlMs ?? -1
  if (ms === -1) return t('永不过期')
  if (ms === -2) return t('已过期')
  const s = Math.ceil(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s % 60}s`]
    .filter(Boolean)
    .join(' ')
})
watch(
  () => props.detail,
  detail => {
    state.draft = detail?.editable ? String(detail.value) : ''
    state.ttl =
      detail && detail.ttlMs >= 0
        ? String(Math.max(1, Math.ceil(detail.ttlMs / 1000)))
        : '-1'
    state.confirmDelete = false
    state.length = null
    state.collectionDirty = false
    state.stringView = 'edit'
  },
  { immediate: true }
)
watch(dirty, value => emit('dirty', value), { immediate: true })
function confirmRemoval() {
  state.confirmDelete = false
  emit('remove')
}
function setTtl(seconds: number) {
  if (props.busy || dirty.value) return
  state.ttl = String(seconds)
  emit('expire', seconds)
}
function collectionChanged(length: number) {
  state.length = length
  if (length === 0) emit('gone')
}
function openRename() {
  state.newName = props.detail?.key.name ?? ''
  state.overwrite = false
  state.renaming = true
}
async function rename() {
  const detail = props.detail
  if (!detail || !props.sessionId || state.renameBusy) return
  if (state.newName === detail.key.name) {
    state.renaming = false
    return
  }
  state.renameBusy = true
  try {
    const key = await redis.renameKey(
      props.sessionId,
      detail.key.id,
      state.newName,
      state.overwrite
    )
    state.renaming = false
    toast.success(t('已重命名'))
    emit('renamed', key)
  } catch (error) {
    toast.error(redis.errorMessage(error))
  } finally {
    state.renameBusy = false
  }
}
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    :aria-label="t('键值')"
  >
    <template v-if="detail">
      <header
        class="border-line-soft flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5"
      >
        <span
          class="bg-raised text-accent rounded px-1.5 py-0.5 font-mono text-[10px]"
          >{{ detail.keyType }}</span
        >
        <span
          class="text-txt-2 min-w-0 flex-1 truncate font-mono text-[11px]"
          :title="detail.key.name"
          >{{ detail.key.name || t('空字符串键') }}</span
        >
        <div class="flex items-center gap-1">
          <IconButton
            icon="lucide:copy"
            :size="13"
            :title="t('复制键名')"
            :aria-label="t('复制键名')"
            @click="copyText(detail.key.name)"
          />
          <IconButton
            v-if="sessionId"
            icon="lucide:pencil-line"
            :size="13"
            :title="t('重命名键')"
            :aria-label="t('重命名键')"
            :disabled="busy || dirty || detail.key.name.startsWith('base64:')"
            @click="openRename"
          />
          <IconButton
            icon="lucide:refresh-cw"
            :size="13"
            :title="t('刷新键内容')"
            :aria-label="t('刷新键内容')"
            :disabled="busy || dirty"
            @click="emit('refresh')"
          />
          <IconButton
            icon="lucide:trash-2"
            :size="13"
            :title="t('删除键')"
            :aria-label="t('删除键')"
            :disabled="busy"
            @click="confirmDelete = true"
          />
        </div>
      </header>
      <form
        class="border-line-soft text-txt-3 flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1 text-[10px]"
        @submit.prevent="
          !busy && !dirty && validTtl && emit('expire', Number(ttl))
        "
      >
        <span>{{ t('长度') }}: {{ state.length ?? detail.length }}</span>
        <span :title="detail.ttlMs >= 0 ? detail.ttlMs + ' ms' : undefined"
          >TTL: {{ ttlLabel }}</span
        >
        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          <div
            class="flex items-center gap-0.5"
            role="group"
            :aria-label="t('快捷 TTL')"
          >
            <AppButton
              v-for="preset in TTL_PRESETS"
              :key="preset.label"
              size="sm"
              variant="ghost"
              class="px-1.5"
              :title="t('{value} 后过期', { value: preset.label })"
              :disabled="busy || dirty"
              @click="setTtl(preset.seconds)"
              >{{ preset.label }}</AppButton
            >
            <AppButton
              size="sm"
              variant="ghost"
              class="px-1.5"
              :title="t('移除过期时间')"
              :disabled="busy || dirty || detail.ttlMs === -1"
              @click="setTtl(-1)"
              ><AppIcon
                name="lucide:infinity"
                :size="12"
            /></AppButton>
          </div>
          <label class="field h-6 w-24 gap-1 rounded-md px-1.5">
            <span class="text-txt-4 text-[10px]">TTL</span>
            <input
              v-model="ttl"
              class="min-w-0"
              :aria-label="t('TTL（秒，-1 表示永不过期）')"
              :title="t('TTL（秒，-1 表示永不过期）')"
              inputmode="numeric"
              :disabled="busy || dirty"
            />
            <span class="text-txt-4 text-[10px]">s</span>
          </label>
          <AppButton
            type="submit"
            size="sm"
            variant="ghost"
            :disabled="busy || dirty || !validTtl"
            >{{ t('设置 TTL') }}</AppButton
          >
        </div>
      </form>
      <RedisCollectionEditor
        v-if="isCollection && sessionId"
        :key="detail.key.id"
        :session-id="sessionId"
        :key-id="detail.key.id"
        :key-type="detail.keyType"
        :busy="busy"
        @changed="collectionChanged"
        @dirty="state.collectionDirty = $event"
      />
      <template v-else>
        <div
          class="border-line-soft bg-panel text-txt-3 flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[11px]"
        >
          <AppIcon
            name="lucide:braces"
            :size="12"
          />
          <span>{{ t('值') }}</span>
          <span
            v-if="stringDirty"
            class="text-amber text-[10px]"
            >{{ t('未保存') }}</span
          >
          <div
            v-if="detail.editable"
            class="bg-raised ml-auto flex items-center gap-0.5 rounded-md p-0.5"
            role="radiogroup"
            :aria-label="t('显示方式')"
          >
            <button
              v-for="mode in ['edit', 'view'] as const"
              :key="mode"
              type="button"
              role="radio"
              :aria-checked="stringView === mode"
              :class="[
                'rounded px-2 py-0.5 text-[10px] motion-safe:transition-colors',
                stringView === mode
                  ? 'bg-accent-deep text-white'
                  : 'text-txt-3 hover:text-txt',
              ]"
              @click="stringView = mode"
            >
              {{ mode === 'edit' ? t('编辑') : t('格式化查看') }}
            </button>
          </div>
          <span
            v-else
            class="text-txt-4 ml-auto text-[10px]"
            >{{ t('只读预览') }}</span
          >
        </div>
        <textarea
          v-if="detail.editable && stringView === 'edit'"
          v-model="draft"
          :aria-label="t('String 值')"
          :disabled="busy"
          class="scroll-thin bg-terminal text-txt min-h-0 w-full flex-1 resize-none p-3 font-mono text-xs leading-relaxed outline-none"
          spellcheck="false"
          @keydown.ctrl.enter.prevent="
            !busy && stringDirty && emit('save', draft)
          "
          @keydown.meta.enter.prevent="
            !busy && stringDirty && emit('save', draft)
          "
        />
        <RedisValueViewer
          v-else-if="detail.keyType === 'string'"
          :text="
            binaryString !== undefined
              ? ''
              : stringView === 'view'
                ? draft
                : formatted
          "
          :raw="binaryString"
          :binary="binaryString !== undefined"
        />
        <pre
          v-else
          class="scroll-thin bg-terminal text-txt-2 min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
          >{{ formatted }}</pre>
        <p
          v-if="detail.truncated"
          class="border-line-soft text-amber shrink-0 border-t px-3 py-2 text-[10px]"
        >
          {{ t('仅显示部分内容；可在命令面板按范围或游标继续读取') }}
        </p>
        <footer
          class="border-line-soft flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-t px-3 py-1.5"
        >
          <AppButton
            v-if="detail.editable"
            size="sm"
            :disabled="busy || !stringDirty"
            @click="emit('save', draft)"
          >
            <AppIcon
              name="lucide:save"
              :size="12"
            />{{ t('保存值') }}
          </AppButton>
          <span
            v-if="detail.editable"
            class="text-txt-4 text-[10px]"
            >{{ t('保存时保留当前 TTL') }}</span
          >
          <AppButton
            v-else
            size="sm"
            @click="emit('command')"
            ><AppIcon
              name="lucide:square-terminal"
              :size="12"
            />{{ t('Redis 命令') }}</AppButton
          >
        </footer>
      </template>
    </template>
    <div
      v-else
      class="text-txt-4 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <AppIcon
        name="lucide:database"
        :size="32"
        class="opacity-40"
      />
      <p class="text-txt-2 text-xs">{{ t('Redis 键浏览器') }}</p>
      <p class="max-w-72 text-[11px] leading-relaxed">
        {{ t('选择一个键查看内容，或使用命令创建数据') }}
      </p>
      <AppButton
        size="sm"
        @click="emit('command')"
        ><AppIcon
          name="lucide:square-terminal"
          :size="12"
        />{{ t('打开 Redis 命令') }}</AppButton
      >
    </div>
    <AppConfirmDialog
      :open="confirmDelete"
      :title="t('删除 Redis 键？')"
      :description="t('将删除当前键及其全部内容。')"
      :confirm-label="t('删除键')"
      danger
      @close="confirmDelete = false"
      @confirm="confirmRemoval"
    />
    <Teleport to="body">
      <div
        v-if="renaming && detail"
        class="fixed inset-0 z-100"
      >
        <AppDialog
          :title="t('重命名键')"
          :description="detail.key.name"
          @close="renaming = false"
        >
          <form
            id="redis-rename-form"
            class="flex flex-col gap-3"
            @submit.prevent="rename"
          >
            <AppInput
              v-model="newName"
              monospace
              :aria-label="t('新键名')"
              :placeholder="t('新键名')"
              spellcheck="false"
              autofocus
            />
            <AppCheckbox
              v-model="overwrite"
              :label="t('目标键已存在时覆盖')"
              :description="t('关闭时使用 RENAMENX，目标存在则失败')"
            />
          </form>
          <template #footer>
            <AppButton
              class="ml-auto"
              variant="ghost"
              @click="renaming = false"
              >{{ t('取消') }}</AppButton
            >
            <AppButton
              type="submit"
              form="redis-rename-form"
              variant="primary"
              :disabled="renameBusy"
              >{{ t('重命名') }}</AppButton
            >
          </template>
        </AppDialog>
      </div>
    </Teleport>
  </section>
</template>
