<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { BREADCRUMBS, FILE_ENTRIES, FILE_KIND_META } from '@/constants/files'
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
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 路径工具条 -->
    <div class="flex h-9 shrink-0 items-center gap-0.5 border-b border-line-soft px-2">
      <IconButton icon="lucide:arrow-left" :size="14" title="后退" />
      <IconButton icon="lucide:arrow-right" :size="14" title="前进" />

      <!-- 面包屑：机器面板宽度有限，去掉目录树后它就是唯一的目录导航 -->
      <nav class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pl-1 text-xs scroll-none">
        <span class="shrink-0 text-txt-4">/</span>
        <template v-for="(crumb, index) in BREADCRUMBS" :key="crumb">
          <button
            type="button"
            :class="cn(
              'shrink-0 rounded px-1.5 py-0.5 transition-colors',
              index === BREADCRUMBS.length - 1
                ? 'bg-raised text-txt'
                : 'text-txt-2 hover:bg-hover hover:text-txt',
            )"
          >
            {{ crumb }}
          </button>
          <span v-if="index < BREADCRUMBS.length - 1" class="shrink-0 text-txt-4">/</span>
        </template>
      </nav>

      <IconButton icon="lucide:copy" :size="14" title="复制路径" />
      <IconButton icon="lucide:rotate-cw" :size="14" title="刷新" />
      <IconButton icon="lucide:ellipsis" :size="14" title="更多" />
    </div>

    <!-- 表头 -->
    <div class="grid shrink-0 grid-cols-[1fr_72px_124px] gap-3 border-b border-line-soft px-3 py-1.5 text-[11px] font-medium text-txt-3">
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
          'grid w-full grid-cols-[1fr_72px_124px] items-center gap-3 px-3 py-1.75 text-left text-xs transition-colors',
          selectedFile === file.id ? 'bg-raised' : 'hover:bg-hover',
        )"
        @click="selectFile(file.id)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <AppIcon
            :name="FILE_KIND_META[file.kind].icon"
            :size="15"
            :class="FILE_KIND_META[file.kind].tone"
          />
          <span class="truncate text-txt">{{ file.name }}</span>
        </span>
        <span class="text-txt-3">{{ file.size }}</span>
        <span class="truncate text-txt-3">{{ file.modified }}</span>
      </button>
    </div>

    <!-- 状态栏 -->
    <footer class="flex h-7 shrink-0 items-center gap-3 border-t border-line-soft px-3 text-[11px] text-txt-3">
      <span class="truncate">7 items, 16.8 GB available</span>
      <div class="flex-1" />
      <input
        v-model.number="zoom"
        type="range"
        min="0"
        max="100"
        class="h-1 w-22 shrink-0 cursor-pointer appearance-none rounded-full bg-line-strong accent-txt-2"
        aria-label="缩放"
      >
    </footer>
  </div>
</template>
