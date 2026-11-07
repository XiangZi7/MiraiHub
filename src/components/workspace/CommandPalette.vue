<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  ref,
  toRefs,
  watch,
} from 'vue'
import { useStorage } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import { COMMAND_GROUPS } from '@/constants/workspace'
import type { CommandItem } from '@/types'
import { cn } from '@/utils/cn'
import { translateLabel } from '@/i18n'
import { useConnectionsStore } from '@/stores/connections'
import { useDatabaseCommandSource } from '@/composables/useDatabaseCommandSource'
import { fuzzyScore } from '@/utils/fuzzy'

const { t } = useI18n()

const emit = defineEmits<{
  /** 请求关闭面板 */
  close: []
  /** 执行某条全局命令 */
  run: [item: CommandItem]
  /** 切换到某个数据库连接 */
  openConnection: [id: string]
}>()

/** 面板里的一行。全局命令、数据库动作、对象与已保存查询统一成这一种 */
interface PaletteEntry {
  key: string
  label: string
  icon: string
  hint?: string
  shortcut?: string
  disabled?: boolean
  /** 返回 true 表示面板保持打开（例如切换到挑表模式） */
  exec: () => boolean | void
}

interface PaletteGroup {
  id: string
  label: string
  items: PaletteEntry[]
}

type Mode = 'all' | 'object' | 'query' | 'action'

/** 前缀 → 模式 */
const PREFIXES: Record<string, Mode> = { '#': 'object', '@': 'query', '>': 'action' }
const MAX_RECENT = 20
const MAX_OBJECTS = 80

const inputRef = ref<HTMLInputElement>()
const listRef = ref<HTMLElement>()
const source = useDatabaseCommandSource()
const connections = useConnectionsStore()
// 最近使用的条目 key，越靠前越新
const recent = useStorage<string[]>('miraihub:palette-recent', [])

const state = reactive({
  keyword: '',
  cursor: 0,
  // "#" 模式下选中对象是打开数据还是进入表设计
  objectIntent: 'open' as 'open' | 'design',
})

const { keyword, cursor } = toRefs(state)

const mode = computed<Mode>(() => PREFIXES[state.keyword[0] ?? ''] ?? 'all')
const query = computed(() =>
  (mode.value === 'all' ? state.keyword : state.keyword.slice(1)).trim()
)

function pickObjects(intent: 'open' | 'design'): boolean {
  state.objectIntent = intent
  state.keyword = '#'
  void nextTick(() => inputRef.value?.focus())
  return true
}

const globalEntries = computed<PaletteGroup[]>(() =>
  COMMAND_GROUPS.map(group => ({
    id: group.id,
    label: translateLabel(group.label),
    items: group.items.map(item => ({
      key: `cmd:${item.id}`,
      label: translateLabel(item.label),
      icon: item.icon,
      shortcut: item.shortcut,
      exec: () => emit('run', item),
    })),
  }))
)

const actionEntries = computed<PaletteEntry[]>(() => {
  const current = source.value
  if (!current) return []
  return current.actions.map(action => ({
    key: `db:${action.id}`,
    label: translateLabel(action.label),
    icon: action.icon,
    hint: current.connectionName,
    disabled: action.enabled ? !action.enabled() : false,
    exec: () => {
      if (action.run === 'pick-object') return pickObjects('open')
      if (action.run === 'pick-design') return pickObjects('design')
      action.run()
    },
  }))
})

const connectionEntries = computed<PaletteEntry[]>(() =>
  connections.databaseConnections
    .filter(item => item.id !== source.value?.connectionId)
    .map(item => ({
      key: `conn:${item.id}`,
      label: item.name,
      icon: item.kind === 'redis' ? 'lucide:layers' : 'lucide:database',
      hint: item.kind,
      exec: () => emit('openConnection', item.id),
    }))
)

const objectEntries = computed<PaletteEntry[]>(() => {
  const current = source.value
  if (!current) return []
  const design = state.objectIntent === 'design'
  return current.objects.value
    .filter(object => !design || object.kind === 'table')
    .map(object => ({
      key: `obj:${current.connectionId}:${object.schema}.${object.name}`,
      label: object.name,
      icon: object.kind === 'view' ? 'lucide:eye' : 'lucide:table',
      hint: object.schema,
      exec: () =>
        design ? current.designObject(object) : current.openObject(object),
    }))
})

const queryEntries = computed<PaletteEntry[]>(() => {
  const current = source.value
  if (!current) return []
  return current.savedQueries.value
    .filter(item => item.connectionId === current.connectionId)
    .map(item => ({
      key: `sq:${item.id}`,
      label: item.name,
      icon: 'lucide:file-code',
      hint: item.database,
      exec: () => current.openSavedQuery(item),
    }))
})

/** 模糊匹配并按分数排序；无关键词时最近使用置顶，其余保持原序 */
function rank(items: PaletteEntry[], limit = Infinity): PaletteEntry[] {
  const kw = query.value
  if (!kw) {
    const order = new Map(recent.value.map((key, index) => [key, index]))
    return [...items]
      .sort(
        (a, b) =>
          (order.get(a.key) ?? MAX_RECENT) - (order.get(b.key) ?? MAX_RECENT)
      )
      .slice(0, limit)
  }
  return items
    .map(item => ({
      item,
      score: Math.max(
        fuzzyScore(kw, item.label),
        item.hint ? fuzzyScore(kw, `${item.hint}.${item.label}`) - 5 : -1
      ),
    }))
    .filter(entry => entry.score >= 0)
    .map(entry => {
      // 最近使用的条目在分数上给一点加成
      const index = recent.value.indexOf(entry.item.key)
      return index < 0 ? entry : { ...entry, score: entry.score + 20 - index }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item)
}

const filteredGroups = computed<PaletteGroup[]>(() => {
  const groups: PaletteGroup[] = []
  const push = (id: string, label: string, items: PaletteEntry[]): void => {
    if (items.length) groups.push({ id, label, items })
  }
  const name = source.value?.connectionName ?? ''

  if (mode.value === 'object')
    push(
      'objects',
      state.objectIntent === 'design' ? t('设计表') : t('表与视图'),
      rank(objectEntries.value, MAX_OBJECTS)
    )
  else if (mode.value === 'query')
    push('saved-queries', t('已保存查询'), rank(queryEntries.value))
  else if (mode.value === 'action') {
    push('db-actions', name || t('数据库'), rank(actionEntries.value))
    push('db-connections', t('切换连接'), rank(connectionEntries.value))
  } else {
    const all = [
      ...actionEntries.value,
      ...globalEntries.value.flatMap(group => group.items),
    ]
    // 无关键词时单独列出最近使用
    if (!query.value) {
      const byKey = new Map(all.map(item => [item.key, item]))
      const recentItems = recent.value
        .map(key => byKey.get(key))
        .filter((item): item is PaletteEntry => !!item)
        .slice(0, 5)
      push('recent', t('最近使用'), recentItems)
      push('db-actions', name || t('数据库'), actionEntries.value)
      for (const group of globalEntries.value)
        push(group.id, group.label, group.items)
    } else {
      push('db-actions', name || t('数据库'), rank(actionEntries.value))
      for (const group of globalEntries.value)
        push(group.id, group.label, rank(group.items))
      push('db-connections', t('切换连接'), rank(connectionEntries.value, 6))
      // 普通模式也顺带搜表，少打一个前缀
      push('objects', t('表与视图'), rank(objectEntries.value, 8))
    }
  }
  return groups
})

/** 扁平列表，用于上下键定位 */
const flatItems = computed<PaletteEntry[]>(() =>
  filteredGroups.value.flatMap(group => group.items)
)

watch(filteredGroups, () => {
  state.cursor = 0
})

// 离开 "#" 模式后恢复默认意图
watch(mode, next => {
  if (next !== 'object') state.objectIntent = 'open'
})

watch(cursor, index => {
  void nextTick(() =>
    listRef.value
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  )
})

const placeholder = computed(() => {
  if (mode.value === 'object') return t('搜索表或视图…')
  if (mode.value === 'query') return t('搜索已保存查询…')
  if (mode.value === 'action') return t('搜索数据库动作或连接…')
  return t('输入命令…（# 表 · @ 已保存查询 · > 数据库动作）')
})

onMounted(() => {
  void nextTick(() => inputRef.value?.focus())
})

function remember(key: string): void {
  recent.value = [key, ...recent.value.filter(item => item !== key)].slice(
    0,
    MAX_RECENT
  )
}

function run(item: PaletteEntry): void {
  if (item.disabled) return
  remember(item.key)
  if (item.exec() === true) return
  emit('close')
}

function move(step: number): void {
  const total = flatItems.value.length
  if (!total) return
  state.cursor = (state.cursor + step + total) % total
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const item = flatItems.value[state.cursor]
    if (item) run(item)
  } else if (
    event.key === 'Backspace' &&
    mode.value !== 'all' &&
    state.keyword.length === 1
  ) {
    // 删掉前缀时回到普通模式
    state.objectIntent = 'open'
  }
}

function indexOf(item: PaletteEntry): number {
  return flatItems.value.indexOf(item)
}
</script>

<template>
  <div
    class="overlay-surface flex h-fit max-h-full w-130 max-w-full flex-col overflow-hidden"
    @keydown="onKeydown"
  >
    <!-- 搜索框 -->
    <label
      class="border-line flex h-12 shrink-0 items-center gap-2.5 border-b px-4"
    >
      <AppIcon
        name="lucide:search"
        :size="15"
        class="text-txt-4"
      />
      <input
        ref="inputRef"
        v-model="keyword"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="command-palette-list"
        :aria-expanded="true"
        :placeholder="placeholder"
        class="text-txt placeholder:text-txt-4 w-full bg-transparent text-[13px] outline-none"
      />
      <button
        type="button"
        class="icon-btn size-6"
        :title="t('关闭 (Esc)')"
        @click="emit('close')"
      >
        <AppIcon
          name="lucide:x"
          :size="13"
        />
      </button>
    </label>

    <!-- 命令列表 -->
    <div
      id="command-palette-list"
      ref="listRef"
      role="listbox"
      class="scroll-thin max-h-100 min-h-0 overflow-y-auto p-1.5"
    >
      <div
        v-for="group in filteredGroups"
        :key="group.id"
        class="mb-1 last:mb-0"
      >
        <p class="group-label py-1.5">
          {{ group.label }}
        </p>

        <button
          v-for="item in group.items"
          :key="`${group.id}-${item.key}`"
          type="button"
          role="option"
          :data-index="indexOf(item)"
          :aria-selected="indexOf(item) === cursor"
          :aria-disabled="item.disabled"
          :class="
            cn(
              'row-item w-full motion-safe:transition-colors',
              indexOf(item) === cursor && 'bg-raised',
              item.disabled && 'opacity-45'
            )
          "
          @click="run(item)"
          @mouseenter="cursor = indexOf(item)"
        >
          <AppIcon
            :name="item.icon"
            :size="14"
            class="text-txt-3 shrink-0"
          />
          <span class="text-txt-2 min-w-0 flex-1 truncate text-left text-xs">{{
            item.label
          }}</span>
          <span
            v-if="item.hint"
            class="text-txt-4 max-w-40 shrink-0 truncate text-[10.5px]"
            >{{ item.hint }}</span
          >
          <span
            v-if="item.shortcut"
            class="kbd"
            >{{ item.shortcut }}</span
          >
        </button>
      </div>

      <p
        v-if="!flatItems.length"
        class="text-txt-4 py-8 text-center text-xs"
      >
        {{
          mode !== 'all' && !source
            ? t('请先打开并连接一个数据库')
            : t('没有匹配的命令')
        }}
      </p>
    </div>

    <!-- 底部提示 -->
    <footer
      class="border-line text-txt-4 flex shrink-0 items-center gap-3 border-t px-4 py-2 text-[10.5px]"
    >
      <span class="flex items-center gap-1">
        <AppIcon
          name="lucide:corner-down-left"
          :size="11"
        />
        {{ t('执行') }}
      </span>
      <span class="flex items-center gap-1">
        <AppIcon
          name="lucide:arrow-up-down"
          :size="11"
        />
        {{ t('切换') }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="kbd">#</span>{{ t('表') }}
        <span class="kbd">@</span>{{ t('查询') }}
        <span class="kbd">&gt;</span>{{ t('动作') }}
      </span>
      <div class="flex-1" />
      <span>{{ t('Esc 关闭') }}</span>
    </footer>
  </div>
</template>
