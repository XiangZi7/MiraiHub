<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { BREADCRUMBS, FILE_ENTRIES, FILE_KIND_META, FILE_TREE } from '@/constants/files'
import { cn } from '@/utils/cn'

// 响应式状态
const state = reactive({
  // 当前选中的文件行 id
  selectedFile: '',
  // 缩放滑块值，0 ~ 100
  zoom: 42,
})

const { selectedFile, zoom } = toRefs(state)

function selectFile(id: string): void {
  state.selectedFile = id
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- 路径工具条 -->
    <div class="flex h-10 shrink-0 items-center gap-1.5 border-b border-line-soft px-3">
      <IconButton icon="lucide:arrow-left" :size="14" title="后退" />
      <IconButton icon="lucide:arrow-right" :size="14" title="前进" />

      <!-- 面包屑 -->
      <nav class="flex items-center gap-1 pl-1 text-xs">
        <span class="text-txt-4">/</span>
        <template v-for="(crumb, index) in BREADCRUMBS" :key="crumb">
          <button
            type="button"
            :class="cn(
              'rounded px-1.5 py-0.5 transition-colors',
              index === BREADCRUMBS.length - 1
                ? 'bg-raised text-txt'
                : 'text-txt-2 hover:bg-hover hover:text-txt',
            )"
          >
            {{ crumb }}
          </button>
          <span v-if="index < BREADCRUMBS.length - 1" class="text-txt-4">/</span>
        </template>
      </nav>

      <div class="flex-1" />

      <IconButton icon="lucide:copy" :size="14" title="复制路径" />
      <IconButton icon="lucide:rotate-cw" :size="14" title="刷新" />
      <IconButton icon="lucide:ellipsis" :size="14" title="更多" />
    </div>

    <!-- 主体：目录树 + 文件表 -->
    <div class="flex min-h-0 flex-1">
      <!-- 目录树 -->
      <nav class="w-[180px] shrink-0 overflow-y-auto border-r border-line-soft bg-panel p-1.5 scroll-thin">
        <button
          v-for="node in FILE_TREE"
          :key="node.id"
          type="button"
          :class="cn('nav-item h-7 w-full text-xs', node.active && 'nav-item-active')"
          :style="{ paddingLeft: `${node.depth * 12 + 8}px` }"
        >
          <AppIcon
            v-if="!node.leaf"
            name="lucide:chevron-right"
            :size="12"
            :class="cn('text-txt-4 transition-transform', node.expanded && 'rotate-90')"
          />
          <span v-else class="w-3 shrink-0" />
          <AppIcon name="lucide:folder" :size="13" class="text-blue" />
          <span class="truncate">{{ node.label }}</span>
        </button>
      </nav>

      <!-- 文件列表 -->
      <div class="flex min-w-0 flex-1 flex-col">
        <!-- 表头 -->
        <div class="grid shrink-0 grid-cols-[1fr_100px_170px] gap-3 border-b border-line-soft px-4 py-2 text-[11px] font-medium text-txt-3">
          <span>Name</span>
          <span>Size</span>
          <span>Modified</span>
        </div>

        <!-- 表体 -->
        <div class="min-h-0 flex-1 overflow-y-auto py-1 scroll-thin">
          <button
            v-for="file in FILE_ENTRIES"
            :key="file.id"
            type="button"
            :class="cn(
              'grid w-full grid-cols-[1fr_100px_170px] items-center gap-3 px-4 py-[7px] text-left text-xs transition-colors',
              selectedFile === file.id ? 'bg-raised' : 'hover:bg-hover',
            )"
            @click="selectFile(file.id)"
          >
            <span class="flex min-w-0 items-center gap-2">
              <AppIcon
                :name="FILE_KIND_META[file.kind].icon"
                :size="14"
                :class="FILE_KIND_META[file.kind].tone"
              />
              <span class="truncate text-txt">{{ file.name }}</span>
            </span>
            <span class="text-txt-3">{{ file.size }}</span>
            <span class="text-txt-3">{{ file.modified }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 状态栏 -->
    <footer class="flex h-8 shrink-0 items-center gap-3 border-t border-line-soft px-4 text-[11px] text-txt-3">
      <span>7 items, 16.8 GB available</span>
      <div class="flex-1" />
      <input
        v-model.number="zoom"
        type="range"
        min="0"
        max="100"
        class="h-1 w-[104px] cursor-pointer appearance-none rounded-full bg-line-strong accent-txt-2"
        aria-label="缩放"
      >
    </footer>
  </div>
</template>
