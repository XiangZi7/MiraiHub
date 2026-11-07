<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import RedisValueViewer from './RedisValueViewer.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import type {
  RedisBytes,
  RedisCollectionItem,
  RedisCollectionOp,
} from '@/types/redis'
import { textToBase64 } from './redis-value'

const props = defineProps<{
  sessionId: string
  keyId: string
  keyType: string
  busy: boolean
}>()
const emit = defineEmits<{
  /** 写入后的集合长度；为 0 时键已被 Redis 删除。 */
  changed: [length: number]
  dirty: [value: boolean]
}>()
const { t } = useI18n()

interface Draft {
  /** 正在编辑的行下标；-1 表示新增。 */
  row: number
  field: string
  value: string
  score: string
  id: string
  fields: { field: string; value: string }[]
  head: boolean
}
// 响应式状态
const state = reactive({
  items: [] as RedisCollectionItem[],
  cursor: '0',
  total: 0,
  loaded: false,
  loading: false,
  // 搜索草稿与已生效的搜索词
  query: '',
  pattern: '',
  pageSize: '100',
  draft: null as Draft | null,
  // 待确认删除的行
  removing: null as RedisCollectionItem | null,
  // 查看中的值
  viewing: null as { title: string; bytes: RedisBytes } | null,
})
const { items, total, loading, query, pageSize, draft, removing, viewing } =
  toRefs(state)
const disabled = computed(() => props.busy || state.loading)
const isHash = computed(() => props.keyType === 'hash')
const isList = computed(() => props.keyType === 'list')
const isZset = computed(() => props.keyType === 'zset')
const isStream = computed(() => props.keyType === 'stream')
/** Hash / Set / ZSet 使用服务端 MATCH 通配符；List / Stream 为子串过滤。 */
const usesGlob = computed(() => !isList.value && !isStream.value)
const hasMore = computed(() => state.cursor !== '0')
const pageSizes = [50, 100, 200, 500, 1000].map(size => ({
  value: String(size),
  label: t('{count} 条/页', { count: size }),
}))
watch(
  () => !!state.draft,
  value => emit('dirty', value),
  { immediate: true }
)

let request = 0
async function load(reset: boolean) {
  if (!props.sessionId) return
  const ticket = ++request
  state.loading = true
  try {
    // 写入后重载时保持已加载的行数，避免列表跳回首页。
    const count = reset
      ? Math.min(1000, Math.max(Number(state.pageSize), state.items.length))
      : Number(state.pageSize)
    const page = await redis.collectionPage(
      props.sessionId,
      props.keyId,
      reset ? '0' : state.cursor,
      state.pattern,
      count
    )
    if (ticket !== request) return
    state.items = reset ? page.items : [...state.items, ...page.items]
    state.cursor = page.cursor
    state.total = page.total
    state.loaded = true
  } catch (error) {
    if (ticket === request) toast.error(redis.errorMessage(error))
  } finally {
    if (ticket === request) state.loading = false
  }
}
watch(
  () => [props.sessionId, props.keyId, props.keyType] as const,
  () => {
    state.items = []
    state.cursor = '0'
    state.loaded = false
    state.draft = null
    state.query = ''
    state.pattern = ''
    void load(true)
  },
  { immediate: true }
)
function search() {
  if (disabled.value) return
  const text = state.query
  state.pattern =
    usesGlob.value && text && !/[*?[]/.test(text) ? `*${text}*` : text
  state.items = []
  void load(true)
}

function startEdit(item: RedisCollectionItem, row: number) {
  state.draft = {
    row,
    field: item.field?.text ?? '',
    value: item.value?.text ?? '',
    score: item.score ?? '0',
    id: '',
    fields: [],
    head: false,
  }
}
function startAdd() {
  state.draft = {
    row: -1,
    field: '',
    value: '',
    score: '0',
    id: '*',
    fields: [{ field: '', value: '' }],
    head: false,
  }
}
function editable(item: RedisCollectionItem) {
  return (
    !isStream.value &&
    !item.value?.binary &&
    !item.value?.truncated &&
    !item.field?.binary &&
    !item.field?.truncated
  )
}
const validDraft = computed(() => {
  const d = state.draft
  if (!d) return false
  if (isZset.value && !Number.isFinite(Number(d.score.trim() || 'x')))
    return false
  if (isStream.value)
    return d.fields.length > 0 && d.fields.every(pair => pair.field !== '')
  return true
})

function draftOp(d: Draft): RedisCollectionOp | null {
  const item = d.row >= 0 ? state.items[d.row] : undefined
  const value = textToBase64(d.value)
  switch (props.keyType) {
    case 'hash':
      return {
        op: 'hashSet',
        field: textToBase64(d.field),
        value,
        oldField: item?.field?.raw,
      }
    case 'list':
      return item && item.index !== undefined && item.value
        ? { op: 'listSet', index: item.index, old: item.value.raw, value }
        : { op: 'listPush', value, head: d.head }
    case 'set':
      return { op: 'setAdd', member: value, old: item?.value?.raw }
    case 'zset':
      return {
        op: 'zsetAdd',
        member: value,
        score: Number(d.score),
        old: item?.value?.raw,
      }
    case 'stream':
      return {
        op: 'streamAdd',
        id: d.id.trim() || '*',
        fields: d.fields.map(pair => [
          textToBase64(pair.field),
          textToBase64(pair.value),
        ]),
      }
  }
  return null
}
async function write(op: RedisCollectionOp) {
  state.loading = true
  try {
    const length = await redis.collectionWrite(props.sessionId, props.keyId, op)
    state.loading = false
    emit('changed', length)
    if (length > 0) await load(true)
    return true
  } catch (error) {
    toast.error(redis.errorMessage(error))
    state.loading = false
    return false
  }
}
async function saveDraft() {
  const d = state.draft
  if (!d || !validDraft.value || disabled.value) return
  const op = draftOp(d)
  if (op && (await write(op))) state.draft = null
}
async function confirmRemove() {
  const item = state.removing
  state.removing = null
  if (!item) return
  const op: RedisCollectionOp | null =
    props.keyType === 'hash' && item.field
      ? { op: 'hashDelete', field: item.field.raw }
      : props.keyType === 'list' && item.value && item.index !== undefined
        ? { op: 'listDelete', index: item.index, old: item.value.raw }
        : props.keyType === 'set' && item.value
          ? { op: 'setDelete', member: item.value.raw }
          : props.keyType === 'zset' && item.value
            ? { op: 'zsetDelete', member: item.value.raw }
            : props.keyType === 'stream' && item.id
              ? { op: 'streamDelete', id: item.id }
              : null
  if (op) await write(op)
}
function view(item: RedisCollectionItem) {
  if (item.fields) {
    const object = Object.fromEntries(
      item.fields.map(([field, value]) => [field.text, value.text])
    )
    const text = JSON.stringify(object, null, 2)
    state.viewing = {
      title: item.id ?? '',
      bytes: {
        text,
        raw: textToBase64(text),
        binary: false,
        size: text.length,
        truncated: false,
      },
    }
  } else if (item.value)
    state.viewing = {
      title: item.field?.text ?? String(item.index ?? item.score ?? ''),
      bytes: item.value,
    }
}
function sizeHint(bytes?: RedisBytes) {
  return bytes?.truncated
    ? t('值过大（{count} 字节），仅显示前 64 KiB', { count: bytes.size })
    : bytes?.binary
      ? t('二进制值，只读')
      : undefined
}
defineExpose({ reload: () => load(true) })
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <form
      class="border-line-soft flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5"
      @submit.prevent="search"
    >
      <div class="relative min-w-40 flex-1">
        <AppInput
          v-model="query"
          size="sm"
          class="pr-8"
          :aria-label="t('搜索成员')"
          :placeholder="
            usesGlob ? t('搜索成员，支持 * ? 通配符') : t('按内容子串过滤')
          "
          :disabled="disabled"
          spellcheck="false"
          maxlength="1024"
        />
        <AppButton
          type="submit"
          variant="bare"
          class="icon-btn text-accent absolute top-0 right-0"
          :title="t('搜索')"
          :aria-label="t('搜索成员')"
          :disabled="disabled"
        >
          <AppIcon
            name="lucide:search"
            :size="13"
          />
        </AppButton>
      </div>
      <AppSelect
        v-model="pageSize"
        class="w-26 shrink-0"
        :label="t('每页条数')"
        :options="pageSizes"
        :disabled="disabled"
        compact
        hide-label
      />
      <IconButton
        icon="lucide:refresh-cw"
        :size="13"
        :title="t('重新加载')"
        :aria-label="t('重新加载')"
        :disabled="disabled || !!draft"
        :class="loading && '[&_svg]:motion-safe:animate-spin'"
        @click="load(true)"
      />
      <AppButton
        size="sm"
        :disabled="disabled || !!draft"
        @click="startAdd"
      >
        <AppIcon
          name="lucide:plus"
          :size="12"
        />{{ isStream ? t('追加条目') : t('新增') }}
      </AppButton>
    </form>
    <div
      v-if="loading && !items.length"
      class="progress-indeterminate h-0.5 shrink-0"
    />
    <div class="scroll-thin min-h-0 flex-1 overflow-auto">
      <table class="w-full table-fixed border-collapse text-[11px]">
        <thead class="bg-panel text-txt-3 sticky top-0 z-10">
          <tr class="border-line-soft border-b text-left">
            <th
              v-if="isList || isZset"
              class="w-16 px-2 py-1.5 font-normal"
            >
              {{ isZset ? t('排名') : t('下标') }}
            </th>
            <th
              v-if="isStream"
              class="w-48 px-2 py-1.5 font-normal"
            >
              ID
            </th>
            <th
              v-if="isHash"
              class="w-[34%] px-2 py-1.5 font-normal"
            >
              {{ t('字段') }}
            </th>
            <th
              v-if="isZset"
              class="w-28 px-2 py-1.5 font-normal"
            >
              {{ t('分数') }}
            </th>
            <th class="px-2 py-1.5 font-normal">
              {{
                isStream
                  ? t('字段与值')
                  : isHash || isList
                    ? t('值')
                    : t('成员')
              }}
            </th>
            <th class="w-20 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody class="font-mono">
          <tr
            v-if="draft && draft.row === -1"
            class="border-line-soft bg-accent/5 border-b align-top"
          >
            <td
              v-if="isList"
              class="px-2 py-1"
            >
              <AppSelect
                :model-value="draft.head ? 'head' : 'tail'"
                :label="t('插入位置')"
                :options="[
                  { value: 'head', label: t('头部') },
                  { value: 'tail', label: t('尾部') },
                ]"
                compact
                hide-label
                @update:model-value="draft.head = $event === 'head'"
              />
            </td>
            <td
              v-if="isZset"
              class="px-2 py-1"
            />
            <td
              v-if="isStream"
              class="px-2 py-1"
            >
              <AppInput
                v-model="draft.id"
                size="sm"
                monospace
                :aria-label="t('条目 ID（* 自动生成）')"
                :placeholder="t('条目 ID（* 自动生成）')"
              />
            </td>
            <td
              v-if="isHash"
              class="px-2 py-1"
            >
              <AppInput
                v-model="draft.field"
                size="sm"
                monospace
                :aria-label="t('字段')"
                :placeholder="t('字段')"
              />
            </td>
            <td
              v-if="isZset"
              class="px-2 py-1"
            >
              <AppInput
                v-model="draft.score"
                size="sm"
                monospace
                inputmode="decimal"
                :aria-label="t('分数')"
              />
            </td>
            <td class="px-2 py-1">
              <div
                v-if="isStream"
                class="flex flex-col gap-1"
              >
                <div
                  v-for="(pair, i) in draft.fields"
                  :key="i"
                  class="flex items-center gap-1"
                >
                  <AppInput
                    v-model="pair.field"
                    size="sm"
                    monospace
                    class="w-1/3"
                    :aria-label="t('字段')"
                    :placeholder="t('字段')"
                  />
                  <AppInput
                    v-model="pair.value"
                    size="sm"
                    monospace
                    class="flex-1"
                    :aria-label="t('值')"
                    :placeholder="t('值')"
                  />
                  <IconButton
                    icon="lucide:minus"
                    :size="12"
                    :title="t('移除字段')"
                    :aria-label="t('移除字段')"
                    :disabled="draft.fields.length <= 1"
                    @click="draft.fields.splice(i, 1)"
                  />
                </div>
                <AppButton
                  size="sm"
                  variant="ghost"
                  class="self-start"
                  @click="draft.fields.push({ field: '', value: '' })"
                  ><AppIcon
                    name="lucide:plus"
                    :size="11"
                  />{{ t('添加字段') }}</AppButton
                >
              </div>
              <textarea
                v-else
                v-model="draft.value"
                rows="2"
                class="field scroll-thin min-h-7 w-full resize-y rounded-md px-1.5 py-1 font-mono text-[11px]"
                :aria-label="isHash || isList ? t('值') : t('成员')"
                :placeholder="isHash || isList ? t('值') : t('成员')"
                spellcheck="false"
                @keydown.ctrl.enter.prevent="saveDraft"
                @keydown.meta.enter.prevent="saveDraft"
              />
            </td>
            <td class="px-2 py-1">
              <div class="flex items-center justify-end gap-0.5">
                <IconButton
                  icon="lucide:check"
                  :size="13"
                  :title="t('保存（Ctrl+Enter）')"
                  :aria-label="t('保存（Ctrl+Enter）')"
                  :disabled="disabled || !validDraft"
                  @click="saveDraft"
                />
                <IconButton
                  icon="lucide:x"
                  :size="13"
                  :title="t('取消')"
                  :aria-label="t('取消')"
                  @click="draft = null"
                />
              </div>
            </td>
          </tr>
          <tr
            v-for="(item, row) in items"
            :key="
              item.id ?? `${item.index}:${item.field?.raw}:${item.value?.raw}`
            "
            class="border-line-soft group hover:bg-raised/60 border-b align-top motion-safe:transition-colors"
          >
            <td
              v-if="isList || isZset"
              class="text-txt-4 px-2 py-1.5"
            >
              {{ item.index ?? '—' }}
            </td>
            <td
              v-if="isStream"
              class="text-txt-3 truncate px-2 py-1.5"
              :title="item.id"
            >
              {{ item.id }}
            </td>
            <template v-if="draft?.row === row">
              <td
                v-if="isHash"
                class="px-2 py-1"
              >
                <AppInput
                  v-model="draft.field"
                  size="sm"
                  monospace
                  :aria-label="t('字段')"
                />
              </td>
              <td
                v-if="isZset"
                class="px-2 py-1"
              >
                <AppInput
                  v-model="draft.score"
                  size="sm"
                  monospace
                  inputmode="decimal"
                  :aria-label="t('分数')"
                />
              </td>
              <td class="px-2 py-1">
                <textarea
                  v-model="draft.value"
                  rows="3"
                  class="field scroll-thin min-h-7 w-full resize-y rounded-md px-1.5 py-1 font-mono text-[11px]"
                  :aria-label="isHash || isList ? t('值') : t('成员')"
                  spellcheck="false"
                  @keydown.ctrl.enter.prevent="saveDraft"
                  @keydown.meta.enter.prevent="saveDraft"
                  @keydown.esc.stop="draft = null"
                />
              </td>
              <td class="px-2 py-1">
                <div class="flex items-center justify-end gap-0.5">
                  <IconButton
                    icon="lucide:check"
                    :size="13"
                    :title="t('保存（Ctrl+Enter）')"
                    :aria-label="t('保存（Ctrl+Enter）')"
                    :disabled="disabled || !validDraft"
                    @click="saveDraft"
                  />
                  <IconButton
                    icon="lucide:x"
                    :size="13"
                    :title="t('取消')"
                    :aria-label="t('取消')"
                    @click="draft = null"
                  />
                </div>
              </td>
            </template>
            <template v-else>
              <td
                v-if="isHash"
                class="text-accent truncate px-2 py-1.5"
                :title="sizeHint(item.field) ?? item.field?.text"
              >
                {{ item.field?.text }}
              </td>
              <td
                v-if="isZset"
                class="text-blue truncate px-2 py-1.5"
                :title="item.score"
              >
                {{ item.score }}
              </td>
              <td
                class="text-txt-2 px-2 py-1.5"
                @dblclick="
                  editable(item) && !disabled && !draft && startEdit(item, row)
                "
              >
                <div
                  v-if="item.fields"
                  class="flex flex-wrap gap-x-3 gap-y-0.5"
                >
                  <span
                    v-for="([field, value], i) in item.fields"
                    :key="i"
                    class="min-w-0 truncate"
                    ><span class="text-accent">{{ field.text }}</span
                    ><span class="text-txt-4">=</span>{{ value.text }}</span
                  >
                </div>
                <span
                  v-else
                  class="line-clamp-3 break-all whitespace-pre-wrap"
                  :title="sizeHint(item.value)"
                  >{{ item.value?.text }}</span
                >
                <span
                  v-if="item.value?.binary || item.value?.truncated"
                  class="text-amber ml-1 text-[9px]"
                  >{{ item.value.truncated ? t('已截断') : 'BIN' }}</span
                >
              </td>
              <td class="px-2 py-1">
                <div
                  class="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 focus-within:opacity-100 motion-safe:transition-opacity"
                >
                  <IconButton
                    icon="lucide:eye"
                    :size="12"
                    :title="t('查看值')"
                    :aria-label="t('查看值')"
                    @click="view(item)"
                  />
                  <IconButton
                    v-if="editable(item)"
                    icon="lucide:pencil"
                    :size="12"
                    :title="t('编辑（双击）')"
                    :aria-label="t('编辑')"
                    :disabled="disabled || !!draft"
                    @click="startEdit(item, row)"
                  />
                  <IconButton
                    icon="lucide:trash-2"
                    :size="12"
                    :title="t('删除')"
                    :aria-label="t('删除')"
                    :disabled="disabled || !!draft"
                    @click="removing = item"
                  />
                </div>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
      <p
        v-if="state.loaded && !items.length && !draft"
        class="text-txt-4 px-3 py-6 text-center text-[11px]"
      >
        {{ state.pattern ? t('没有匹配的成员') : t('集合为空') }}
      </p>
    </div>
    <footer
      class="border-line-soft text-txt-4 flex min-h-8 shrink-0 items-center gap-2 border-t px-3 py-1 text-[10px]"
    >
      <span>{{
        t('已加载 {loaded} / 共 {total}', {
          loaded: items.length,
          total,
        })
      }}</span>
      <AppButton
        v-if="hasMore"
        size="sm"
        variant="ghost"
        class="ml-auto"
        :disabled="disabled"
        @click="load(false)"
        >{{ t('加载更多') }}</AppButton
      >
      <span
        v-else-if="state.loaded"
        class="ml-auto"
        >{{ t('已全部加载') }}</span
      >
    </footer>
    <AppConfirmDialog
      :open="!!removing"
      :title="t('删除该成员？')"
      :description="
        t('删除后无法撤销；删除最后一个成员时 Redis 会同时删除整个键。')
      "
      :confirm-label="t('删除')"
      danger
      @close="removing = null"
      @confirm="confirmRemove"
    />
    <Teleport to="body">
      <div
        v-if="viewing"
        class="fixed inset-0 z-100"
      >
        <AppDialog
          :title="t('查看值')"
          :description="viewing.title"
          wide
          @close="viewing = null"
        >
          <div class="-mx-4 -my-3.5 flex h-[60vh] flex-col">
            <RedisValueViewer
              :text="viewing.bytes.text"
              :raw="viewing.bytes.raw"
              :binary="viewing.bytes.binary"
            />
          </div>
        </AppDialog>
      </div>
    </Teleport>
  </div>
</template>
