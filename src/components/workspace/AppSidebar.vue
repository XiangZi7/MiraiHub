<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { FAVORITES, NAV_ITEMS, PROJECT_GROUPS } from '@/constants/workspace'
import { cn } from '@/utils/cn'

// 当前选中的主视图，由 MainWindow 通过 v-model:active 控制
const active = defineModel<string>('active', { required: true })

// 响应式状态
const state = reactive({
  // 项目分组展开状态，key 为分组 id
  expanded: Object.fromEntries(
    PROJECT_GROUPS.map(group => [group.id, group.expanded]),
  ) as Record<string, boolean>,
})

const { expanded } = toRefs(state)

function toggleGroup(id: string): void {
  state.expanded[id] = !state.expanded[id]
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

      <!-- 收藏夹 -->
      <p class="group-label mb-1.5 mt-5">
        Favorites
      </p>
      <nav class="space-y-0.5">
        <button
          v-for="fav in FAVORITES"
          :key="fav.id"
          type="button"
          class="nav-item w-full"
        >
          <AppIcon name="lucide:star" :size="15" class="text-amber" />
          <span>{{ fav.label }}</span>
        </button>
      </nav>

      <!-- 项目 -->
      <div class="mb-1.5 mt-5 flex items-center justify-between pr-1">
        <p class="group-label">
          Projects
        </p>
        <IconButton icon="lucide:plus" :size="13" title="新建项目" />
      </div>

      <div class="space-y-0.5">
        <div v-for="group in PROJECT_GROUPS" :key="group.id">
          <button
            type="button"
            class="nav-item w-full"
            @click="toggleGroup(group.id)"
          >
            <AppIcon
              name="lucide:chevron-right"
              :size="13"
              :class="cn('text-txt-4 transition-transform duration-150', expanded[group.id] && 'rotate-90')"
            />
            <span>{{ group.label }}</span>
          </button>

          <div v-show="expanded[group.id]" class="space-y-0.5">
            <button
              v-for="node in group.children"
              :key="node.id"
              type="button"
              class="nav-item w-full pl-7"
            >
              <StatusDot
                :tone="node.status === 'online' ? 'accent' : 'txt-3'"
                :size="6"
                :glow="node.status === 'online'"
              />
              <span class="flex-1 truncate text-left">{{ node.label }}</span>
              <StatusDot
                :tone="node.status === 'online' ? 'accent' : 'txt-3'"
                :size="6"
                :glow="node.status === 'online'"
              />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="flex shrink-0 items-center gap-2 border-t border-line-soft p-2.5">
      <button type="button" class="btn flex-1">
        <AppIcon name="lucide:plus" :size="14" />
        <span>Add Connection</span>
      </button>
      <IconButton icon="lucide:settings" title="设置" />
    </div>
  </aside>
</template>
