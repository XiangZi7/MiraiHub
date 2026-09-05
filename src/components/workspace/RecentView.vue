<script setup lang="ts">
import { computed, reactive, shallowRef, toRefs } from 'vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import { useConnections } from '@/composables/useConnections'
import { settingNumber, useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import { RECENT_BUCKETS, RECENT_FILTERS, SESSION_KIND_META } from '@/constants/recent'
import type { RecentFilter, RecentGroup, SessionKind } from '@/types'
import type { SavedConnection } from '@/types/connection'
import { endpointOf } from '@/types/connection'
import { cn } from '@/utils/cn'
import { formatRelative } from '@/utils/time'

const { settings } = useSettings()

/**
 * 最近会话。
 *
 * 数据来自已保存连接的 lastUsedAt —— 每次成功打开都会刷新它。
 * 独立的会话历史（每次连接的起止时间、结果）要等数据库模块建表，
 * 在那之前"最近用过哪些连接"已经能满足主要用途：快速回到刚才那台机器。
 */

const emit = defineEmits<{
  /** 请求重新打开某条连接 */
  open: [connection: SavedConnection]
}>()

const { connections, update } = useConnections()

// 响应式状态
const state = reactive({
  // 当前类型筛选，取值见 RECENT_FILTERS
  filter: 'all' as RecentFilter['id'],
  // 搜索关键词
  keyword: '',
})

const { filter, keyword } = toRefs(state)
const clearConfirmOpen = shallowRef(false)

/** 连接类型 → 会话类型。数据库的三种协议在这里都归为 database */
function kindOf(connection: SavedConnection): SessionKind {
  if (connection.kind === 'ssh')
    return 'ssh'
  return connection.kind === 'local' ? 'local' : 'database'
}

/** 用过的连接，按最近使用倒序 */
const usedConnections = computed(() =>
  connections
    .filter((item) => {
      if (item.lastUsedAt <= 0)
        return false
      const retentionMs = settingNumber('historyRetention', 30) * 24 * 60 * 60 * 1000
      return Date.now() - item.lastUsedAt < retentionMs
    })
    .slice()
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, settingNumber('maxRecentItems', 50)),
)

/** 按类型 + 关键词过滤后再分时间段，空分组不占位 */
const visibleGroups = computed<RecentGroup[]>(() => {
  const kw = state.keyword.trim().toLowerCase()
  const now = Date.now()

  const matched = usedConnections.value.filter((item) => {
    if (state.filter !== 'all' && kindOf(item) !== state.filter)
      return false

    if (!kw)
      return true

    return item.name.toLowerCase().includes(kw)
      || item.host.toLowerCase().includes(kw)
  })

  return RECENT_BUCKETS
    .map((bucket, index) => {
      // 每个桶只收"比上一个桶更早、但不超过自身边界"的记录，
      // 否则今天的记录会同时落进 Today 和后面所有更宽的桶
      const lower = index === 0 ? 0 : RECENT_BUCKETS[index - 1].within

      const items = matched
        .filter((item) => {
          const age = now - item.lastUsedAt
          return age >= lower && age < bucket.within
        })
        .map(item => ({
          id: item.id,
          label: item.name,
          kind: kindOf(item),
          address: endpointOf(item),
          usedAt: item.lastUsedAt,
        }))

      return { id: bucket.id, label: bucket.label, items }
    })
    .filter(group => group.items.length > 0)
})

/** 过滤后的会话总数，给状态栏 */
const total = computed(() =>
  visibleGroups.value.reduce((sum, group) => sum + group.items.length, 0),
)

/** 一条都没用过 vs 只是被筛掉了，两种空状态的出路不一样 */
const hasHistory = computed(() => usedConnections.value.length > 0)

function reopen(id: string): void {
  const connection = connections.find(item => item.id === id)
  if (connection)
    emit('open', connection)
}

/** 清空记录：把 lastUsedAt 归零，连接本身保留 */
async function clearHistory(): Promise<void> {
  clearConfirmOpen.value = false
  try {
    await Promise.all(
      usedConnections.value.map(item => update(item.id, { lastUsedAt: 0 })),
    )
    toast.success('最近会话记录已清空')
  }
  catch (error) {
    toast.error({ title: '清空最近会话失败', description: error instanceof Error ? error.message : String(error) })
  }
}
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
      <IconButton
        icon="lucide:trash-2"
        :size="14"
        title="清空记录"
        @click="clearConfirmOpen = true"
      />
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

            <span class="w-28 shrink-0 truncate text-right text-[11px] text-txt-4">
              {{ formatRelative(session.usedAt) }}
            </span>

            <!-- 重连：常态隐形，hover 到行上才出现，避免列表被按钮填满 -->
            <button
              type="button"
              class="btn shrink-0 px-2 py-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              title="重新连接"
              @click="reopen(session.id)"
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
            {{ hasHistory ? '没有匹配的会话' : '还没有会话记录' }}
          </p>
          <p class="max-w-70 text-xs text-txt-4">
            {{ hasHistory ? '换个关键词，或把筛选切回 All' : settings.saveSessionHistory ? '打开一个连接后，这里会记下来' : '会话历史已在设置中关闭' }}
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
    <AppConfirmDialog
      :open="clearConfirmOpen"
      title="清空最近会话？"
      description="仅清除最近使用时间，已经保存的连接配置会保留。"
      confirm-label="确认清空"
      danger
      @close="clearConfirmOpen = false"
      @confirm="clearHistory"
    />
  </div>
</template>
