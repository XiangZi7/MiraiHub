<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  ref,
  toRefs,
  watch,
} from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { COMMAND_GROUPS } from '@/constants/workspace'
import type { CommandItem } from '@/types'
import { cn } from '@/utils/cn'

const emit = defineEmits<{
  /** 请求关闭面板 */
  close: []
  /** 执行某条命令 */
  run: [item: CommandItem]
}>()

const inputRef = ref<HTMLInputElement>()

// 响应式状态
const state = reactive({
  // 搜索关键词
  keyword: '',
  // 键盘导航高亮的条目下标，针对扁平后的列表
  cursor: 0,
})

const { keyword, cursor } = toRefs(state)

/** 按关键词过滤分组，空分组自动隐藏 */
const filteredGroups = computed(() => {
  const kw = state.keyword.trim().toLowerCase()
  if (!kw) return COMMAND_GROUPS

  return COMMAND_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => item.label.toLowerCase().includes(kw)),
  })).filter(group => group.items.length > 0)
})

/** 扁平列表，用于上下键定位 */
const flatItems = computed<CommandItem[]>(() =>
  filteredGroups.value.flatMap(group => group.items)
)

/** 关键词变化后把光标收回首项，避免停在已被过滤掉的位置 */
watch(filteredGroups, () => {
  state.cursor = 0
})

onMounted(() => {
  void nextTick(() => inputRef.value?.focus())
})

function run(item: CommandItem): void {
  emit('run', item)
  emit('close')
}

/** 上下键循环移动光标 */
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
  }
}

/** 某条目在扁平列表中的下标，用于判断是否高亮 */
function indexOf(item: CommandItem): number {
  return flatItems.value.indexOf(item)
}
</script>

<template>
  <div
    class="glass rounded-win border-line-strong bg-window h-fit w-[440px] overflow-hidden border"
    :style="{ boxShadow: 'var(--shadow-pop)' }"
    @keydown="onKeydown"
  >
    <!-- 搜索框 -->
    <label class="border-line flex h-12 items-center gap-2.5 border-b px-4">
      <AppIcon
        name="lucide:search"
        :size="15"
        class="text-txt-4"
      />
      <input
        ref="inputRef"
        v-model="keyword"
        type="text"
        placeholder="输入命令…"
        class="text-txt placeholder:text-txt-4 w-full bg-transparent text-[13px] outline-none"
      />
      <button
        type="button"
        class="icon-btn size-6"
        title="关闭 (Esc)"
        @click="emit('close')"
      >
        <AppIcon
          name="lucide:x"
          :size="13"
        />
      </button>
    </label>

    <!-- 命令列表 -->
    <div class="scroll-thin max-h-[360px] overflow-y-auto p-1.5">
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
          :key="item.id"
          type="button"
          :class="
            cn('row-item w-full', indexOf(item) === cursor && 'bg-raised')
          "
          @click="run(item)"
          @mouseenter="cursor = indexOf(item)"
        >
          <AppIcon
            :name="item.icon"
            :size="14"
            class="text-txt-3"
          />
          <span class="text-txt-2 flex-1 truncate text-left text-xs">{{
            item.label
          }}</span>
          <span class="kbd">{{ item.shortcut }}</span>
        </button>
      </div>

      <p
        v-if="!flatItems.length"
        class="text-txt-4 py-8 text-center text-xs"
      >
        没有匹配的命令
      </p>
    </div>

    <!-- 底部提示 -->
    <footer
      class="border-line text-txt-4 flex items-center gap-3 border-t px-4 py-2 text-[10.5px]"
    >
      <span class="flex items-center gap-1">
        <AppIcon
          name="lucide:corner-down-left"
          :size="11"
        />
        执行
      </span>
      <span class="flex items-center gap-1">
        <AppIcon
          name="lucide:arrow-up-down"
          :size="11"
        />
        切换
      </span>
      <div class="flex-1" />
      <span>Esc 关闭</span>
    </footer>
  </div>
</template>
