<script setup lang="ts">
import { computed, reactive, toRefs } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { RECENT_FILTERS, RECENT_GROUPS, SESSION_KIND_META } from '@/constants/recent'
import type { RecentFilter, RecentGroup, RecentSession } from '@/types'
import { cn } from '@/utils/cn'

/**
 * 最近会话。
 * 唯一的真实动作是"再连一次"，所以每行右侧留出重连入口，
 * 其余信息（地址、时长、结果）只做辨识用。
 */

const emit = defineEmits<{
  /** 请求重新打开某条会话 */
  open: [session: RecentSession]
}>()

// 响应式状态
const state = reactive({
  // 当前类型筛选，取值见 RECENT_FILTERS
  filter: 'all' as RecentFilter['id'],
  // 搜索关键词
  keyword: '',
})

const { filter, keyword } = toRefs(state)

/** 按类型 + 关键词过滤，空分组不占位 */
const visibleGroups = computed<RecentGroup[]>(() => {
  const kw = state.keyword.trim().toLowerCase()

  return RECENT_GROUPS
    .map(group => ({
      ...group,
      items: group.items.filter(item =>
        (state.filter === 'all' || item.kind === state.filter)
        && (!kw
          || item.label.toLowerCase().includes(kw)
          || item.address.toLowerCase().includes(kw)),
      ),
    }))
    .filter(group => group.items.length > 0)
})

/** 过滤后的会话总数，给状态栏 */
const total = computed(() =>
  visibleGroups.value.reduce((sum, group) => sum + group.items.length, 0),
)
</script>

<template>
  <div class="pane flex-1">
    <!-- 工具条 -->
    <header class="flex h-10 shrink-0 items-center gap-1 border-b border-line-soft pl-2 pr-2">
      <button
        v-for="item in RECENT_FILTERS"
        :key="item.id"
        type="button"
        :class="cn('seg', filter === item.id && 'seg-active')"
        @click="filter = item.id"
      >
        {{ item.label }}
      </button>

      <div class="flex-1" />

      <SearchField
        v-model="keyword"
        icon="lucide:search"
        placeholder="搜索会话…"
        class="h-7 w-56"
      />
      <IconButton icon="lucide:trash-2" :size="14" title="清空记录" />
    </header>

    <!-- 会话列表 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-2.5 py-2 scroll-thin">
      <section v-for="group in visibleGroups" :key="group.id" class="mb-3 last:mb-0">
        <p class="group-label mb-1.5 px-1">
          {{ group.label }}
        </p>

        <div class="card divide-y divide-line-soft overflow-hidden">
          <div
            v-for="session in group.items"
            :key="session.id"
            class="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-raised"
          >
            <div class="grid size-8 shrink-0 place-items-center rounded-lg border border-line-soft bg-panel">
              <AppIcon
                :name="SESSION_KIND_META[session.kind].icon"
                :size="15"
                :class="SESSION_KIND_META[session.kind].tone"
              />
            </div>

            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-1.5">
                <span class="truncate text-xs text-txt">{{ session.label }}</span>
                <span class="shrink-0 rounded border border-line bg-card px-1.5 text-[10px] font-medium text-txt-3">
                  {{ SESSION_KIND_META[session.kind].label }}
                </span>
              </p>
              <p class="mt-0.5 truncate font-mono text-[10.5px] text-txt-4">
                {{ session.address }}
              </p>
            </div>

            <!-- 结果：失败的会话没有时长，用红点 + Failed 顶上，不留空 -->
            <span
              v-if="session.status === 'failed'"
              class="flex shrink-0 items-center gap-1.5 text-[11px] text-danger"
            >
              <StatusDot tone="danger" :size="6" />
              <span>Failed</span>
            </span>
            <span v-else class="shrink-0 text-[11px] text-txt-3">
              {{ session.duration }}
            </span>

            <span class="w-28 shrink-0 truncate text-right text-[11px] text-txt-4">
              {{ session.time }}
            </span>

            <!-- 重连：常态隐形，hover 到行上才出现，避免列表被按钮填满 -->
            <button
              type="button"
              class="btn shrink-0 px-2 py-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              title="重新连接"
              @click="emit('open', session)"
            >
              <AppIcon name="lucide:rotate-cw" :size="12" />
              <span>Reconnect</span>
            </button>
          </div>
        </div>
      </section>

      <div v-if="!visibleGroups.length" class="flex h-full items-center justify-center">
        <div class="flex flex-col items-center gap-3 text-center">
          <div class="grid size-14 place-items-center rounded-2xl border border-line bg-card text-txt-3">
            <AppIcon name="lucide:clock" :size="26" />
          </div>
          <p class="text-sm text-txt-2">
            没有匹配的会话
          </p>
          <p class="max-w-70 text-xs text-txt-4">
            换个关键词，或把筛选切回 All
          </p>
        </div>
      </div>
    </div>

    <!-- 状态栏 -->
    <footer class="flex h-7 shrink-0 items-center border-t border-line-soft px-3 text-[10.5px] text-txt-3">
      <span>{{ total }} sessions</span>
      <div class="flex-1" />
      <span>点击 Reconnect 回到该连接</span>
    </footer>
  </div>
</template>
