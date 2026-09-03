<script setup lang="ts">
import { computed, reactive } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useConnections } from '@/composables/useConnections'
import { useWorkspaceTabs } from '@/composables/useWorkspaceTabs'
import { NAV_ITEMS } from '@/constants/workspace'
import type { SavedConnection } from '@/types/connection'
import type { NavId } from '@/types'
import { cn } from '@/utils/cn'
import { endpointOf } from '@/types/connection'
import { openConnectionWindow } from '@/utils/window'

// 当前选中的主视图，由 MainWindow 通过 v-model:active 控制
const active = defineModel<NavId>('active', { required: true })

const emit = defineEmits<{
  /** 请求打开某条连接 */
  open: [connection: SavedConnection]
}>()

const { groupsFor, loaded } = useConnections()
const { tabs, activeId } = useWorkspaceTabs()

// 响应式状态
const state = reactive({
  // 分组折叠状态，key 为分组名。默认展开，只记录被手动折叠的
  collapsed: {} as Record<string, boolean>,
})

/**
 * 项目树跟随主视图切换。
 *
 * 侧栏上半区选的是"看哪一类连接"，下半区就该只列这一类 ——
 * 停在 Databases 却看到一堆 SSH 服务器，点下去还跳回终端，是自相矛盾的。
 * SSH Keys / Recent 不是连接列表，此时沿用 servers 的树，
 * 让用户从密钥页直接点服务器打开终端。
 */
const projectGroups = computed(() =>
  groupsFor(active.value === 'databases' ? 'database' : 'ssh'),
)

/** 分组标题：Databases 视图下叫 Connections 更贴切 */
const groupsLabel = computed(() =>
  active.value === 'databases' ? 'Databases' : 'Projects',
)

/** 已打开且连上的连接 id，用来给节点点亮绿点 */
const connectedIds = computed(
  () => new Set(tabs.filter(tab => tab.status === 'connected').map(tab => tab.id)),
)

function toggleGroup(name: string): void {
  state.collapsed[name] = !state.collapsed[name]
}

function isExpanded(name: string): boolean {
  return !state.collapsed[name]
}

/** 节点状态：连上是 accent，仅打开未连上是 amber，其余灰 */
function toneOf(connection: SavedConnection): 'accent' | 'amber' | 'txt-3' {
  if (connectedIds.value.has(connection.id))
    return 'accent'

  return tabs.some(tab => tab.id === connection.id) ? 'amber' : 'txt-3'
}

/** 新建连接时带上当前视图对应的类型，省一次手动切换 */
function addConnection(): void {
  openConnectionWindow(active.value === 'databases' ? 'database' : 'ssh')
}
</script>

<template>
  <aside class="flex w-56 shrink-0 flex-col border-r border-line-soft bg-panel">
    <!-- 顶部工具条 -->
    <div class="flex h-11 shrink-0 items-center gap-1 border-b border-line-soft px-2.5">
      <IconButton icon="lucide:panel-left" title="折叠侧栏" />
      <IconButton icon="lucide:layout-grid" title="布局" />
      <div class="flex-1" />
      <IconButton icon="lucide:chevrons-left" title="收起" />
    </div>

    <div class="flex-1 overflow-y-auto px-2 py-3 scroll-thin">
      <!-- 工作区 -->
      <p class="group-label mb-1.5">
        Workspace
      </p>
      <nav class="space-y-0.5">
        <button
          v-for="item in NAV_ITEMS"
          :key="item.id"
          type="button"
          :class="cn('nav-item w-full', active === item.id && 'nav-item-active')"
          @click="active = item.id"
        >
          <AppIcon :name="item.icon" :size="15" class="text-txt-3" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <!-- 连接树 -->
      <div class="mb-1.5 mt-5 flex items-center justify-between pr-1">
        <p class="group-label">
          {{ groupsLabel }}
        </p>
        <IconButton icon="lucide:plus" :size="13" title="新建连接" @click="addConnection" />
      </div>

      <div class="space-y-0.5">
        <div v-for="group in projectGroups" :key="group.name">
          <button
            type="button"
            class="nav-item w-full"
            @click="toggleGroup(group.name)"
          >
            <AppIcon
              name="lucide:chevron-right"
              :size="13"
              :class="cn('text-txt-4 transition-transform duration-150', isExpanded(group.name) && 'rotate-90')"
            />
            <span class="flex-1 truncate text-left">{{ group.name }}</span>
            <span class="shrink-0 text-[10px] text-txt-4">{{ group.items.length }}</span>
          </button>

          <div v-show="isExpanded(group.name)" class="space-y-0.5">
            <button
              v-for="node in group.items"
              :key="node.id"
              type="button"
              :class="cn('nav-item w-full pl-7', activeId === node.id && 'nav-item-active')"
              :title="endpointOf(node)"
              @click="emit('open', node)"
            >
              <StatusDot
                :tone="toneOf(node)"
                :size="6"
                :glow="toneOf(node) !== 'txt-3'"
              />
              <span class="flex-1 truncate text-left">{{ node.name }}</span>
            </button>
          </div>
        </div>

        <!-- 一条连接都没有：直接给出口，而不是留一片空白 -->
        <button
          v-if="loaded && !projectGroups.length"
          type="button"
          class="w-full rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-txt-4 transition-colors hover:border-line-strong hover:text-txt-3"
          @click="addConnection"
        >
          还没有连接，点这里新建
        </button>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="flex shrink-0 items-center gap-2 border-t border-line-soft p-2.5">
      <button type="button" class="btn flex-1" @click="addConnection">
        <AppIcon name="lucide:plus" :size="14" />
        <span>Add Connection</span>
      </button>
      <IconButton icon="lucide:settings" title="设置" />
    </div>
  </aside>
</template>
