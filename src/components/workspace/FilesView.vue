<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useClipboard } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useRemoteFiles } from '@/composables/useRemoteFiles'
import { FILE_KIND_META, extensionOf } from '@/constants/files'
import type { SshRemoteFile } from '@/types/ssh'
import { cn } from '@/utils/cn'
import { formatBytes } from '@/utils/format'
import { formatDateTime } from '@/utils/time'
import RemotePathInput from './RemotePathInput.vue'

/**
 * 远端文件浏览。
 * 列目录走 SSH exec 解析 `ls -lA`（见 Rust 侧 ssh/files.rs），
 * 上传下载要等 SFTP 接上才能做，所以工具条上暂时只有导航与刷新。
 */

const props = defineProps<{
  /** 后端 SSH 会话 id，未连上时为空串 */
  sessionId: string
}>()

const {
  path,
  sortedEntries,
  loading,
  error,
  selected,
  canGoBack,
  canGoForward,
  load,
  enter,
  goUp,
  goBack,
  goForward,
  refresh,
} = useRemoteFiles(toRef(props, 'sessionId'))

const connected = computed(() => Boolean(props.sessionId))

const pathClip = useClipboard({ copiedDuring: 1600 })

/** 目录项 → 图标与配色。目录/软链有专属样式，普通文件按扩展名分色 */
function metaOf(file: SshRemoteFile): { icon: string, tone: string } {
  if (file.kind === 'directory')
    return FILE_KIND_META.folder

  if (file.kind === 'symlink')
    return { icon: 'lucide:link', tone: 'text-violet' }

  return FILE_KIND_META[extensionOf(file.name)]
}

/** 目录不显示字节数：`ls` 给的是目录项本身占的块大小，不是内容总量，显示出来会误导 */
function sizeOf(file: SshRemoteFile): string {
  return file.kind === 'directory' ? '–' : formatBytes(file.size)
}

/** 短日期格式解析不出时间戳，此时留空而不是显示 1970 */
function modifiedOf(file: SshRemoteFile): string {
  return file.modifiedAt ? formatDateTime(file.modifiedAt) : '—'
}

const summary = computed(() => {
  const dirs = sortedEntries.value.filter(item => item.kind === 'directory').length
  const files = sortedEntries.value.length - dirs

  return `${dirs} 个目录，${files} 个文件`
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 路径工具条 -->
    <div class="flex h-9 shrink-0 items-center gap-0.5 border-b border-line-soft px-2">
      <IconButton
        icon="lucide:house"
        :size="14"
        title="主目录"
        :disabled="!connected"
        @click="load('')"
      />
      <IconButton
        icon="lucide:arrow-left"
        :size="14"
        title="后退"
        :disabled="!canGoBack"
        @click="goBack"
      />
      <IconButton
        icon="lucide:arrow-right"
        :size="14"
        title="前进"
        :disabled="!canGoForward"
        @click="goForward"
      />
      <IconButton
        icon="lucide:arrow-up"
        :size="14"
        title="上一级"
        :disabled="!connected || path === '/'"
        @click="goUp"
      />

      <RemotePathInput
        :path="path"
        :entries="sortedEntries"
        :connected="connected"
        :loading="loading"
        @navigate="load"
      />

      <IconButton
        :icon="pathClip.copied.value ? 'lucide:check' : 'lucide:copy'"
        :size="14"
        title="复制路径"
        :disabled="!path"
        @click="pathClip.copy(path)"
      />
      <IconButton
        icon="lucide:rotate-cw"
        :size="14"
        title="刷新"
        :disabled="!connected"
        @click="refresh"
      />
      <IconButton icon="lucide:ellipsis" :size="14" title="更多" />
    </div>

    <!-- 列目录失败：进不去的目录要说清楚原因（多半是权限） -->
    <p
      v-if="error"
      class="shrink-0 border-b border-line-soft bg-danger/10 px-3 py-1.5 text-[11px] text-danger"
    >
      {{ error }}
    </p>

    <!-- 表头 -->
    <div class="grid shrink-0 grid-cols-[1fr_80px_130px] gap-3 border-b border-line-soft px-3 py-1.5 text-[11px] font-medium text-txt-3">
      <span>Name</span>
      <span class="text-right">Size</span>
      <span>Modified</span>
    </div>

    <!-- 表体 -->
    <div class="min-h-0 flex-1 overflow-y-auto py-1 scroll-thin">
      <button
        v-for="file in sortedEntries"
        :key="file.path"
        type="button"
        :class="cn(
          'grid w-full grid-cols-[1fr_80px_130px] items-center gap-3 px-3 py-1.75 text-left text-xs transition-colors',
          selected === file.path ? 'bg-raised' : 'hover:bg-hover',
        )"
        :title="`${file.permissions}  ${file.owner}:${file.group}`"
        @click="selected = file.path"
        @dblclick="enter(file)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <AppIcon :name="metaOf(file).icon" :size="15" :class="metaOf(file).tone" />
          <span class="truncate text-txt">{{ file.name }}</span>
          <!-- 软链目标跟在名字后面，弱化显示 -->
          <span v-if="file.linkTarget" class="shrink-0 truncate text-[10.5px] text-txt-4">
            → {{ file.linkTarget }}
          </span>
        </span>
        <span class="text-right text-txt-3">{{ sizeOf(file) }}</span>
        <span class="truncate text-txt-3">{{ modifiedOf(file) }}</span>
      </button>

      <p v-if="loading" class="py-8 text-center text-xs text-txt-4">
        正在读取目录…
      </p>
      <p v-else-if="!connected" class="py-8 text-center text-xs text-txt-4">
        连上服务器后可以浏览远端文件
      </p>
      <p v-else-if="!sortedEntries.length && !error" class="py-8 text-center text-xs text-txt-4">
        这个目录是空的
      </p>
    </div>

    <!-- 状态栏 -->
    <footer class="flex h-7 shrink-0 items-center gap-3 border-t border-line-soft px-3 text-[11px] text-txt-3">
      <span class="truncate">{{ connected ? summary : '未连接' }}</span>
      <div class="flex-1" />
      <span class="shrink-0 text-txt-4">双击进入目录</span>
    </footer>
  </div>
</template>
