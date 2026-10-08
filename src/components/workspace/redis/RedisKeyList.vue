<script setup lang="ts">
import { computed, reactive, toRefs, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { groupRedisKeys } from '@/utils/redis-browser'
import type { RedisKey } from '@/types/redis'

const props = defineProps<{
  keys: RedisKey[]
  disabled: boolean
  selected?: string
}>()
const emit = defineEmits<{ select: [key: RedisKey] }>()
const { t } = useI18n()
const pageSize = 50
// 响应式状态
const state = reactive({
  // 仅筛选已加载的数据，不发送请求
  filter: '',
  // 两级前缀适合 cache:模块 等键名；零表示平铺
  depth: 2,
  // 当前已展开的前缀
  expanded: new Set<string>(),
  // 当前显示页，从零开始
  page: 0,
})
const { filter, depth, expanded, page } = toRefs(state)
const scroller = useTemplateRef<HTMLElement>('scroller')
const filtered = computed(() => {
  if (!state.filter) return props.keys
  const query = state.filter.toLocaleLowerCase()
  return props.keys.filter(key => key.name.toLocaleLowerCase().includes(query))
})
const groups = computed(() => groupRedisKeys(filtered.value, state.depth))
type Row =
  | { kind: 'group'; prefix: string; count: number }
  | { kind: 'key'; key: RedisKey; prefix: string }
const rows = computed<Row[]>(() => {
  if (!state.depth)
    return filtered.value.map(key => ({ kind: 'key', key, prefix: '' }))
  return groups.value.flatMap(group => {
    if (!group.prefix)
      return group.keys.map(key => ({ kind: 'key' as const, key, prefix: '' }))
    const heading: Row = {
      kind: 'group',
      prefix: group.prefix,
      count: group.keys.length,
    }
    return state.expanded.has(group.prefix) || state.filter
      ? [
          heading,
          ...group.keys.map(key => ({
            kind: 'key' as const,
            key,
            prefix: group.prefix,
          })),
        ]
      : [heading]
  })
})
const pageCount = computed(() =>
  Math.max(1, Math.ceil(rows.value.length / pageSize))
)
const visibleRows = computed(() =>
  rows.value
    .slice(state.page * pageSize, (state.page + 1) * pageSize)
    .map(row => {
      if (row.kind === 'group') return row
      const label = row.key.name.slice(row.prefix.length)
      return {
        ...row,
        head: label.length > 40 ? label.slice(0, -20) : label,
        tail: label.length > 40 ? label.slice(-20) : '',
      }
    })
)
const selectedKey = computed(() =>
  props.keys.find(key => key.id === props.selected)
)
watch([() => state.filter, () => state.depth], () => {
  state.page = 0
})
watch(
  () => props.keys,
  () => {
    state.page = 0
    state.expanded.clear()
  }
)
watch(pageCount, count => {
  state.page = Math.min(state.page, count - 1)
})
watch(
  () => state.page,
  () => {
    if (scroller.value) scroller.value.scrollTop = 0
  },
  { flush: 'post' }
)
function toggle(prefix: string) {
  if (state.expanded.has(prefix)) state.expanded.delete(prefix)
  else state.expanded.add(prefix)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
      <label class="field h-7 min-w-0 flex-1 gap-1 rounded px-1.5">
        <AppIcon
          name="lucide:list-filter"
          :size="12"
          class="text-txt-4 shrink-0"
        />
        <input
          v-model="filter"
          :aria-label="t('筛选已加载的键')"
          :placeholder="t('筛选已加载的键')"
          spellcheck="false"
        />
        <IconButton
          v-if="filter"
          icon="lucide:x"
          :size="11"
          class="size-5"
          :title="t('清除筛选')"
          :aria-label="t('清除筛选')"
          @click="filter = ''"
        />
      </label>
      <select
        v-model.number="depth"
        class="field h-7 max-w-24 rounded px-1 text-[10px]"
        :aria-label="t('前缀分组层级')"
      >
        <option :value="0">{{ t('平铺列表') }}</option>
        <option :value="1">{{ t('一级分组') }}</option>
        <option :value="2">{{ t('二级分组') }}</option>
        <option :value="3">{{ t('三级分组') }}</option>
      </select>
    </div>
    <div
      ref="scroller"
      class="scroll-thin min-h-0 flex-1 overflow-auto px-1.5 pb-1.5"
      :aria-label="t('Redis 键列表')"
    >
      <template
        v-for="row in visibleRows"
        :key="
          row.kind === 'group' ? 'group:' + row.prefix : 'key:' + row.key.id
        "
      >
        <button
          v-if="row.kind === 'group'"
          type="button"
          class="nav-item h-8 w-full gap-1.5 text-xs"
          :aria-expanded="!!filter || expanded.has(row.prefix)"
          :title="row.prefix"
          @click="toggle(row.prefix)"
        >
          <AppIcon
            :name="
              filter || expanded.has(row.prefix)
                ? 'lucide:chevron-down'
                : 'lucide:chevron-right'
            "
            :size="12"
            class="text-txt-4 shrink-0"
          />
          <AppIcon
            name="lucide:folder-key"
            :size="13"
            class="text-blue shrink-0"
          />
          <span class="min-w-0 truncate font-mono text-[11px]">{{
            row.prefix
          }}</span>
          <span class="text-txt-4 ml-auto shrink-0 font-mono text-[10px]">{{
            row.count
          }}</span>
        </button>
        <button
          v-else
          type="button"
          :disabled="disabled"
          :title="row.key.name"
          :aria-label="row.key.name || t('空字符串键')"
          :aria-pressed="selected === row.key.id"
          :class="[
            'nav-item h-8 w-full gap-1.5 text-xs disabled:cursor-wait',
            row.prefix && 'pl-7',
            selected === row.key.id && 'nav-item-active',
          ]"
          @click="emit('select', row.key)"
        >
          <AppIcon
            name="lucide:key-round"
            :size="12"
            class="text-accent shrink-0"
          />
          <span class="flex min-w-0 flex-1 font-mono text-[11px]">
            <span class="min-w-0 truncate">{{
              row.head || t('空字符串键')
            }}</span>
            <span
              v-if="row.tail"
              class="text-txt-3 flex max-w-[60%] shrink-0 justify-end overflow-hidden whitespace-nowrap"
              ><span class="shrink-0">{{ row.tail }}</span></span
            >
          </span>
        </button>
      </template>
      <p
        v-if="filter && !filtered.length"
        class="text-txt-4 px-3 py-5 text-center text-[11px]"
      >
        {{ t('已加载的键中没有匹配项，请使用上方搜索') }}
      </p>
      <slot v-if="!keys.length" />
    </div>
    <div
      v-if="pageCount > 1"
      class="border-line-soft text-txt-4 flex shrink-0 items-center justify-between border-t px-2 py-1 text-[10px]"
    >
      <span>{{ t('每页最多 {count} 行', { count: pageSize }) }}</span>
      <div class="flex items-center gap-1">
        <IconButton
          icon="lucide:chevron-left"
          :size="12"
          :disabled="page === 0"
          :title="t('上一页')"
          :aria-label="t('上一页')"
          @click="page--"
        />
        <span class="font-mono">{{ page + 1 }} / {{ pageCount }}</span>
        <IconButton
          icon="lucide:chevron-right"
          :size="12"
          :disabled="page >= pageCount - 1"
          :title="t('下一页')"
          :aria-label="t('下一页')"
          @click="page++"
        />
      </div>
    </div>
    <p
      v-if="selectedKey"
      class="border-line-soft text-txt-3 scroll-thin max-h-20 shrink-0 overflow-auto border-t px-2 py-1.5 font-mono text-[10px] break-all select-text"
      :title="t('当前键完整名称')"
    >
      {{ selectedKey.name || t('空字符串键') }}
    </p>
  </div>
</template>
